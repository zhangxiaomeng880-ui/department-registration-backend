import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3501';
const platformToken=process.env.RUNTIME_API_TOKEN;
assert.ok(platformToken,'RUNTIME_API_TOKEN is required');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{
    method,headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};
  try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);

let r=await request('GET','/api/runtime/iam/me',undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('GET','/api/runtime/iam/me');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.platformAdmin,true);
assert.equal(r.body.data.authType,'PLATFORM_TOKEN');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`iam-tenant-${suffix}`,name:'IAM Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:`iam-workspace-${suffix}`,name:'IAM Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`other-tenant-${suffix}`,name:'Other Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherTenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId:otherTenantId,workspaceKey:`other-workspace-${suffix}`,name:'Other Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherWorkspaceId=r.body.data.id;

r=await request('POST','/api/runtime/identities',{
  identityKey:`svc-${suffix}`,identityType:'SERVICE',displayName:'Scoped Runtime Service'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const identityId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId,roleKey:'TENANT_OPERATOR'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'ACTIVE');

r=await request('POST','/api/runtime/api-credentials',{
  identityId,tenantId,
  permissions:['project.write','run.execute','run.read','usage.read'],
  metadata:{purpose:'M22.4 CI'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const credentialId=r.body.data.credential.id;
const scopedToken=r.body.data.token;
assert.match(scopedToken,/^rtv2_[a-f0-9]{12}_[A-Za-z0-9_-]+$/);
assert.equal(r.body.data.credential.permissions.includes('project.write'),true);

r=await request('GET','/api/runtime/api-credentials?tenantId='+encodeURIComponent(tenantId));
assert.equal(r.status,200,JSON.stringify(r.body));
const listed=r.body.data.find(x=>x.id===credentialId);
assert.ok(listed);
assert.equal(Object.hasOwn(listed,'secretHash'),false);
assert.equal(Object.hasOwn(listed,'token'),false);

r=await request('GET','/api/runtime/iam/me',undefined,scopedToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.platformAdmin,false);
assert.equal(r.body.data.tenantId,tenantId);
assert.equal(r.body.data.workspaceId,null);
assert.ok(r.body.data.permissions.includes('project.write'));

r=await request('GET','/api/runtime/plans',undefined,scopedToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_FORBIDDEN');
assert.equal(r.body.details.reasonCode,'SCOPED_ROUTE_NOT_ALLOWLISTED');

r=await request('POST','/api/runtime/projects',{
  workspaceId,
  projectKey:`iam-project-${suffix}`,name:'IAM Project',projectType:'AIGC_CONTENT'
},scopedToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.tenantId,tenantId);

r=await request('POST','/api/runtime/projects',{
  workspaceId:otherWorkspaceId,
  projectKey:`cross-project-${suffix}`,name:'Cross Project',projectType:'AIGC_CONTENT'
},scopedToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_SCOPE_FORBIDDEN');

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'
},scopedToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'IAM',taskKey:'scoped-task',taskType:'SCRIPT_CONTINUITY',sequenceNo:1
},scopedToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;

r=await request('GET',`/api/runtime/runs/${runId}/observability`,undefined,scopedToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.run.tenantId,tenantId);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/usage-meter?periodType=MONTH`,undefined,scopedToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.tenantId,tenantId);

r=await request('GET',`/api/runtime/workspaces/${otherWorkspaceId}/usage-meter?periodType=MONTH`,undefined,scopedToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_SCOPE_FORBIDDEN');

r=await request('POST','/api/runtime/api-credentials',{
  identityId,tenantId,workspaceId,
  permissions:['run.read','usage.read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const readOnlyCredentialId=r.body.data.credential.id;
const readOnlyToken=r.body.data.token;

r=await request('GET',`/api/runtime/runs/${runId}/observability`,undefined,readOnlyToken);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'IAM',taskKey:'should-deny',taskType:'SCRIPT_CONTINUITY',sequenceNo:2
},readOnlyToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_FORBIDDEN');
assert.equal(r.body.details.reasonCode,'PERMISSION_MISSING');

r=await request('GET',`/api/runtime/tenants/${tenantId}/usage-meter?periodType=MONTH`,undefined,readOnlyToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'WORKSPACE_CREDENTIAL_CANNOT_READ_TENANT_AGGREGATE');

r=await request('POST',`/api/runtime/api-credentials/${readOnlyCredentialId}/revoke`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'REVOKED');

r=await request('GET','/api/runtime/iam/me',undefined,readOnlyToken);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId,roleKey:'TENANT_OPERATOR',status:'REVOKED'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET','/api/runtime/iam/me',undefined,scopedToken);
assert.equal(r.status,401,JSON.stringify(r.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

const [[storedCredential]]=await db.execute(
  'SELECT secret_hash,credential_prefix FROM api_credentials WHERE id=?',[credentialId]
);
assert.match(storedCredential.secret_hash,/^[a-f0-9]{64}$/);
assert.notEqual(storedCredential.secret_hash,scopedToken);
assert.ok(scopedToken.includes(storedCredential.credential_prefix));

const [[rawTokenMatches]]=await db.execute(
  'SELECT COUNT(*) AS count FROM api_credentials WHERE secret_hash=?',[scopedToken]
);
assert.equal(Number(rawTokenMatches.count),0);

const [[denyAudits]]=await db.execute(
  `SELECT COUNT(*) AS count FROM runtime_authz_decisions
   WHERE identity_id=? AND decision='DENY'`,[identityId]
);
assert.ok(Number(denyAudits.count)>=3);

const [[allowAudits]]=await db.execute(
  `SELECT COUNT(*) AS count FROM runtime_authz_decisions
   WHERE identity_id=? AND decision='ALLOW'`,[identityId]
);
assert.ok(Number(allowAudits.count)>=4);

await db.end();
console.log('G22_4_IAM_RBAC_SCOPED_CREDENTIAL_PASS');
