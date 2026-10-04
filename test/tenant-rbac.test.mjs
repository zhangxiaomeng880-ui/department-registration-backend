import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3500';
const platformToken=process.env.RUNTIME_API_TOKEN||'rbac-ci-platform-token';
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const suffix=randomUUID().slice(0,8);

let r=await request('GET','/ready',undefined,null);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.components.runtimeAuth.required,true);

r=await request('GET','/api/runtime/tenants',undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`rbac-a-${suffix}`,name:'RBAC Tenant A'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantA=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId:tenantA,workspaceKey:`rbac-a1-${suffix}`,name:'RBAC Workspace A1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceA1=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId:tenantA,workspaceKey:`rbac-a2-${suffix}`,name:'RBAC Workspace A2'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceA2=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`rbac-b-${suffix}`,name:'RBAC Tenant B'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantB=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId:tenantB,workspaceKey:`rbac-b1-${suffix}`,name:'RBAC Workspace B1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceB1=r.body.data.id;

r=await request('POST','/api/runtime/identities',{
  identityKey:`operator-${suffix}`,displayName:'Workspace Operator'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const operatorId=r.body.data.id;

r=await request('POST','/api/runtime/workspace-memberships',{
  workspaceId:workspaceA1,identityId:operatorId,roleKey:'OPERATOR'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:operatorId,tenantId:tenantA,workspaceId:workspaceA1,name:'Operator Scoped Key',
  allowedPermissions:['workspace:read','project:read','project:write','run:read','run:write','agent:execute','usage:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const operatorCredentialId=r.body.data.id;
const operatorToken=r.body.data.token;
assert.ok(/^rtk_[a-f0-9]{12}_/.test(operatorToken));

r=await request('GET','/api/runtime/workspaces',undefined,operatorToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,workspaceA1);

r=await request('POST','/api/runtime/projects',{
  workspaceId:workspaceA1,projectKey:`rbac-project-a1-${suffix}`,name:'Scoped Project',projectType:'AIGC_CONTENT'
},operatorToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const projectA1=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId:projectA1,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'
},operatorToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const runA1=r.body.data.id;

r=await request('GET',`/api/runtime/runs/${runA1}/observability`,undefined,operatorToken);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  workspaceId:workspaceA2,projectKey:`forbidden-a2-${suffix}`,name:'Forbidden A2',projectType:'AIGC_CONTENT'
},operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_FORBIDDEN');
assert.equal(r.body.details.reasonCode,'CROSS_WORKSPACE_DENIED');

r=await request('POST','/api/runtime/projects',{
  workspaceId:workspaceB1,projectKey:`forbidden-b1-${suffix}`,name:'Forbidden B1',projectType:'AIGC_CONTENT'
},operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

r=await request('GET',`/api/runtime/tenants/${tenantB}/usage-meter`,undefined,operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

r=await request('GET','/api/runtime/provider-registry',undefined,operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/context-packets',{
  query:'should be platform only',items:[]
},operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/api-credentials',{
  identityId:operatorId,tenantId:tenantA,workspaceId:workspaceA1,name:'Operator Child Key',
  allowedPermissions:['project:read']
},operatorToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_FORBIDDEN');

r=await request('POST','/api/runtime/identities',{
  identityKey:`viewer-${suffix}`,displayName:'Workspace Viewer'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const viewerId=r.body.data.id;

r=await request('POST','/api/runtime/workspace-memberships',{
  workspaceId:workspaceA1,identityId:viewerId,roleKey:'VIEWER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:viewerId,tenantId:tenantA,workspaceId:workspaceA1,name:'Viewer Key'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const viewerToken=r.body.data.token;

r=await request('GET','/api/runtime/workspaces',undefined,viewerToken);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  workspaceId:workspaceA1,projectKey:`viewer-write-${suffix}`,name:'Viewer Write',projectType:'AIGC_CONTENT'
},viewerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'PERMISSION_DENIED');

r=await request('POST','/api/runtime/identities',{
  identityKey:`owner-${suffix}`,displayName:'Tenant Owner'
});
assert.equal(r.status,201);
const ownerId=r.body.data.id;
r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId:tenantA,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201);
r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId:tenantA,name:'Tenant Owner Key',
  allowedPermissions:['tenant:read','workspace:read','workspace:write','membership:write','credential:write']
});
assert.equal(r.status,201);
const ownerToken=r.body.data.token;

r=await request('POST','/api/runtime/api-credentials',{
  identityId:operatorId,tenantId:tenantA,workspaceId:workspaceA1,name:'Escalation Attempt'
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'CREDENTIAL_IDENTITY_ESCALATION');

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[storedCredential]]=await db.execute(
  'SELECT token_hash,credential_prefix FROM api_credentials WHERE id=?',[operatorCredentialId]
);
assert.equal(String(storedCredential.token_hash).length,64);
assert.notEqual(storedCredential.token_hash,operatorToken);
assert.ok(!JSON.stringify(storedCredential).includes(operatorToken));

const [[denyAudit]]=await db.execute(
  `SELECT COUNT(*) AS count FROM authorization_decisions
   WHERE credential_id=? AND decision='DENY'`,[operatorCredentialId]
);
assert.ok(Number(denyAudit.count)>=3);

const [[adminMembershipPermission]]=await db.execute(
  `SELECT COUNT(*) AS count FROM rbac_role_permissions
   WHERE role_key='TENANT_ADMIN' AND permission_key='membership:write'`
);
assert.equal(Number(adminMembershipPermission.count),0);
await db.end();

r=await request('POST',`/api/runtime/api-credentials/${operatorCredentialId}/revoke`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('GET','/api/runtime/workspaces',undefined,operatorToken);
assert.equal(r.status,401,JSON.stringify(r.body));
assert.equal(r.body.error,'RUNTIME_CREDENTIAL_INACTIVE');

console.log('G22_4_TENANT_RBAC_PASS');
