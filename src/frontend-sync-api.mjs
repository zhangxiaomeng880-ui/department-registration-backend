// M31 Frontend Sync — database-backed project list; no client-side catalogue.
import { getRuntimePool } from './runtime-db.mjs';
import { assertAccess, resolveWorkspaceScope } from './runtime-rbac.mjs';

const fail = (code, statusCode=400) => Object.assign(new Error(code),{code,statusCode});

export const listWorkbenchProjects = async ({workspaceId,projectType=null,limit=50,offset=0}={}) => {
  if(!workspaceId || !/^[a-zA-Z0-9-]{1,64}$/.test(workspaceId)) throw fail('WORKSPACE_ID_REQUIRED');
  const max = Number(limit), skip = Number(offset);
  if(!Number.isInteger(max) || max<1 || max>100 || !Number.isInteger(skip) || skip<0 || skip>100000) {
    throw fail('INVALID_PROJECT_PAGE');
  }
  if(projectType && !['PRODUCT_DEVELOPMENT','AIGC_CONTENT'].includes(projectType)) throw fail('INVALID_PROJECT_TYPE');
  const where=['workspace_id=?'], args=[workspaceId];
  if(projectType){where.push('project_type=?');args.push(projectType);}
  const pool=getRuntimePool();
  const predicate=where.join(' AND ');
  const [totals]=await pool.execute('SELECT COUNT(*) AS total FROM projects WHERE '+predicate,args);
  const [rows]=await pool.query(
    'SELECT id,tenant_id,workspace_id,project_key,name,project_type,project_subtype_key,status,current_stage_key,current_workflow_version,workflow_template_id,updated_at FROM projects WHERE '+predicate+
    ' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?',[...args,max,skip]
  );
  return {workspaceId,total:Number(totals[0].total),limit:max,offset:skip,items:rows.map(r=>({
    id:r.id,tenantId:r.tenant_id,workspaceId:r.workspace_id,projectKey:r.project_key,
    name:r.name,projectType:r.project_type,projectSubtypeKey:r.project_subtype_key,
    status:r.status,currentStageKey:r.current_stage_key,
    currentWorkflowVersion:r.current_workflow_version,workflowTemplateId:r.workflow_template_id,
    updatedAt:r.updated_at
  }))};
};

export const handleFrontendSyncRoute=async(req,res,url,{json,principal})=>{
  if(url.pathname!=='/api/runtime/projects' || req.method!=='GET')return false;
  const workspaceId=url.searchParams.get('workspaceId');
  if(!workspaceId)throw fail('WORKSPACE_ID_REQUIRED');
  const scope=await resolveWorkspaceScope(workspaceId);
  if(!principal?.platformAdmin)await assertAccess({
    principal,permission:'project:read',...scope,method:req.method,path:url.pathname
  });
  json(res,200,{data:await listWorkbenchProjects({
    workspaceId,projectType:url.searchParams.get('projectType')||null,
    limit:url.searchParams.get('limit')||50,offset:url.searchParams.get('offset')||0
  })});
  return true;
};
