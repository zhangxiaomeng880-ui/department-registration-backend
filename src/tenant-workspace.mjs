import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const secretPattern=/(api[_-]?key|secret|token|password|credential|authorization)/i;
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Tenant/workspace metadata must not persist secrets','TENANT_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const normalizeTenant=row=>({
  id:row.id,tenantKey:row.tenant_key,name:row.name,planKey:row.plan_key,
  status:row.status,metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at,
});
const normalizeWorkspace=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceKey:row.workspace_key,name:row.name,
  status:row.status,metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at,
});

export const createTenant=async input=>{
  if(!input?.tenantKey||!input?.name) throw errorOf('tenantKey and name are required','INVALID_TENANT');
  rejectSecrets(input);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  const planKey=input.planKey||'LEGACY';
  const [plans]=await db.execute('SELECT plan_key,status FROM plans WHERE plan_key=?',[planKey]);
  if(!plans.length) throw errorOf('Plan not found','PLAN_NOT_FOUND',404);
  if(plans[0].status!=='ACTIVE') throw errorOf('Plan is not active','PLAN_NOT_ACTIVE',409);
  try{
    await db.execute(
      `INSERT INTO tenants (id,tenant_key,name,plan_key,status,metadata_json)
       VALUES (?,?,?,?,?,?)`,
      [id,input.tenantKey,input.name,planKey,input.status||'ACTIVE',asJson(input.metadata||null)]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('tenantKey already exists','TENANT_KEY_EXISTS',409);
    throw error;
  }
  const [rows]=await db.execute('SELECT * FROM tenants WHERE id=?',[id]);
  return normalizeTenant(rows[0]);
};

export const listTenants=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM tenants ORDER BY created_at,id');
  return rows.map(normalizeTenant);
};

export const createWorkspace=async input=>{
  if(!input?.tenantId||!input?.workspaceKey||!input?.name) throw errorOf('tenantId, workspaceKey and name are required','INVALID_WORKSPACE');
  rejectSecrets(input);
  const db=getRuntimePool();
  const [tenants]=await db.execute('SELECT id,status FROM tenants WHERE id=?',[input.tenantId]);
  if(!tenants.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
  if(tenants[0].status!=='ACTIVE') throw errorOf('Tenant is not active','TENANT_NOT_ACTIVE',409);
  const id=input.id||randomUUID();
  try{
    await db.execute(
      `INSERT INTO workspaces (id,tenant_id,workspace_key,name,status,metadata_json)
       VALUES (?,?,?,?,?,?)`,
      [id,input.tenantId,input.workspaceKey,input.name,input.status||'ACTIVE',asJson(input.metadata||null)]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('workspaceKey already exists for tenant','WORKSPACE_KEY_EXISTS',409);
    throw error;
  }
  const [rows]=await db.execute('SELECT * FROM workspaces WHERE id=?',[id]);
  return normalizeWorkspace(rows[0]);
};

export const listWorkspaces=async({tenantId=null}={})=>{
  const db=getRuntimePool();
  const [rows]=tenantId
    ? await db.execute('SELECT * FROM workspaces WHERE tenant_id=? ORDER BY created_at,id',[tenantId])
    : await db.execute('SELECT * FROM workspaces ORDER BY tenant_id,created_at,id');
  return rows.map(normalizeWorkspace);
};
