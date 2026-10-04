import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const errorOf=(message,code,statusCode=403,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const hasPermission=(auth,key)=>Boolean(auth?.platformAdmin)||auth?.permissions?.includes('*')||auth?.permissions?.includes(key);
const assertScope=(auth,{tenantId,workspaceId=null})=>{
  if(auth.platformAdmin) return;
  if(!tenantId||auth.tenantId!==tenantId) throw errorOf('Resource is outside credential tenant scope','RUNTIME_SCOPE_FORBIDDEN',403);
  if(auth.workspaceId&&auth.workspaceId!==workspaceId) throw errorOf('Resource is outside credential workspace scope','RUNTIME_SCOPE_FORBIDDEN',403);
};
const audit=async(auth,{permission=null,resourceType=null,resourceId=null,decision,reasonCode=null,method,routePattern})=>{
  if(auth?.authType!=='SCOPED_CREDENTIAL') return;
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO runtime_authz_decisions (
      id,credential_id,identity_id,tenant_id,workspace_id,permission_key,
      resource_type,resource_id,decision,reason_code,method,route_pattern
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),auth.credentialId,auth.identityId,auth.tenantId,auth.workspaceId,permission,
     resourceType,resourceId,decision,reasonCode,method,routePattern]
  );
};
const allow=async(auth,ctx)=>{
  await audit(auth,{...ctx,decision:'ALLOW'});
};
const deny=async(auth,ctx,reasonCode='PERMISSION_DENIED')=>{
  await audit(auth,{...ctx,decision:'DENY',reasonCode});
  throw errorOf('Scoped credential is not allowed to access this Runtime resource','RUNTIME_FORBIDDEN',403,{
    permission:ctx.permission||null,reasonCode
  });
};
const requirePermission=async(auth,key,ctx)=>{
  if(hasPermission(auth,key)) return;
  await deny(auth,{...ctx,permission:key},'PERMISSION_MISSING');
};

const runScope=async runId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,tenant_id,workspace_id FROM runs WHERE id=?',[runId]);
  if(!rows.length) throw errorOf('Run not found','RUN_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};
const projectScope=async projectId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,tenant_id,workspace_id FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};
const taskScope=async taskId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT r.tenant_id,r.workspace_id FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.id=?',
    [taskId]
  );
  if(!rows.length) throw errorOf('Task not found','TASK_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};
const reservationScope=async reservationId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id,workspace_id FROM usage_reservations WHERE id=?',[reservationId]);
  if(!rows.length) throw errorOf('Usage reservation not found','RESERVATION_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};
const workspaceScope=async workspaceId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id,id FROM workspaces WHERE id=?',[workspaceId]);
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].id};
};

export const authorizeRuntimeApiAccess=async({req,url,readBody,auth})=>{
  if(auth?.platformAdmin) return;
  const method=req.method;
  const path=url.pathname;
  const routeContext={method,routePattern:path};

  if(method==='GET'&&path==='/api/runtime/iam/me'){
    await allow(auth,routeContext);return;
  }

  let m;
  if(method==='POST'&&path==='/api/runtime/projects'){
    const body=await readBody(req);
    if(!body.workspaceId) return deny(auth,{...routeContext,permission:'project.write'},'SCOPED_PROJECT_REQUIRES_WORKSPACE');
    await requirePermission(auth,'project.write',routeContext);
    const scope=await workspaceScope(body.workspaceId);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'project.write',resourceType:'WORKSPACE',resourceId:body.workspaceId});return;
  }
  if(method==='POST'&&path==='/api/runtime/runs'){
    const body=await readBody(req);await requirePermission(auth,'run.execute',routeContext);
    const scope=await projectScope(body.projectId);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.execute',resourceType:'PROJECT',resourceId:body.projectId});return;
  }
  if(method==='POST'&&['/api/runtime/tasks','/api/runtime/routes','/api/runtime/tool-executions','/api/runtime/gate-results','/api/runtime/qa-evidence','/api/runtime/agent-executions'].includes(path)){
    const body=await readBody(req);await requirePermission(auth,'run.execute',routeContext);
    const scope=await runScope(body.runId);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.execute',resourceType:'RUN',resourceId:body.runId});return;
  }
  if(method==='PATCH'&&(m=path.match(/^\/api\/runtime\/tasks\/([^/]+)$/))){
    await requirePermission(auth,'run.execute',routeContext);
    const scope=await taskScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.execute',resourceType:'TASK',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/runs\/([^/]+)\/(observability|cost-summary|knowledge-contexts|checkpoints\/latest)$/))&&method==='GET'){
    const permission=m[2]==='cost-summary'?'usage.read':'run.read';
    await requirePermission(auth,permission,routeContext);
    const scope=await runScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission,resourceType:'RUN',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/runs\/([^/]+)\/(knowledge-contexts|checkpoints|resume|commercial-authorize)$/))&&method==='POST'){
    await requirePermission(auth,'run.execute',routeContext);
    const scope=await runScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.execute',resourceType:'RUN',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/projects\/([^/]+)\/cost-summary$/))&&method==='GET'){
    await requirePermission(auth,'usage.read',routeContext);
    const scope=await projectScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'usage.read',resourceType:'PROJECT',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/workspaces\/([^/]+)\/usage-meter$/))&&method==='GET'){
    await requirePermission(auth,'usage.read',routeContext);
    const scope=await workspaceScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'usage.read',resourceType:'WORKSPACE',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/tenants\/([^/]+)\/usage-meter$/))&&method==='GET'){
    await requirePermission(auth,'usage.read',routeContext);
    assertScope(auth,{tenantId:m[1],workspaceId:auth.workspaceId||null});
    if(auth.workspaceId) return deny(auth,{...routeContext,permission:'usage.read',resourceType:'TENANT',resourceId:m[1]},'WORKSPACE_CREDENTIAL_CANNOT_READ_TENANT_AGGREGATE');
    await allow(auth,{...routeContext,permission:'usage.read',resourceType:'TENANT',resourceId:m[1]});return;
  }
  if((m=path.match(/^\/api\/runtime\/usage-reservations\/([^/]+)\/(commit|release)$/))&&method==='POST'){
    await requirePermission(auth,'run.execute',routeContext);
    const scope=await reservationScope(m[1]);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.execute',resourceType:'USAGE_RESERVATION',resourceId:m[1]});return;
  }
  if(method==='GET'&&path==='/api/runtime/usage-reservations'){
    await requirePermission(auth,'run.read',routeContext);
    const runId=url.searchParams.get('runId');
    if(!runId) return deny(auth,{...routeContext,permission:'run.read'},'SCOPED_RESERVATION_LIST_REQUIRES_RUN');
    const scope=await runScope(runId);assertScope(auth,scope);
    await allow(auth,{...routeContext,permission:'run.read',resourceType:'RUN',resourceId:runId});return;
  }

  await deny(auth,routeContext,'SCOPED_ROUTE_NOT_ALLOWLISTED');
};
