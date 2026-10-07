import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5016';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body,token=platformToken)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body.data;};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});
const suffix=randomUUID().slice(0,8);

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_ENVIRONMENT_REGISTRY,'环境注册表');
assert.equal(modules.M30_CONNECTION_REGISTRY,'连接注册表');
assert.equal(modules.M30_CONNECTION_HEALTH,'连接健康');
assert.equal(modules.M30_OPERATIONS_WORKBENCH,'运维工作台');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-OPS-FOUNDATION').displayName,'私有工作台 / 环境 / 连接健康门禁');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m301-${suffix}`,name:'M30.1 Private Tenant'
});
const tenant=expect(r,201);
r=await request('POST','/api/runtime/workspaces',{
  tenantId:tenant.id,workspaceKey:'main',name:'M30.1 私有工作区'
});
const workspace=expect(r,201);
r=await request('POST','/api/runtime/workspaces',{
  tenantId:tenant.id,workspaceKey:'isolated',name:'M30.1 隔离工作区'
});
const otherWorkspace=expect(r,201);

r=await request('POST','/api/runtime/identities',{
  identityKey:`m301-viewer-${suffix}`,displayName:'M30.1 Viewer'
});
const identity=expect(r,201);
r=await request('POST','/api/runtime/workspace-memberships',{
  workspaceId:workspace.id,identityId:identity.id,roleKey:'VIEWER'
});
expect(r,201);

r=await request('POST','/api/runtime/api-credentials',{
  identityId:identity.id,tenantId:tenant.id,workspaceId:workspace.id,
  name:'M30.1 scoped workbench read',allowedPermissions:['workspace:read']
});
const credential=expect(r,201);
assert.ok(credential.token);

const providerKey=`m301-provider-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M30.1 Provider',adapterKey:'openai-responses',
  healthStatus:'HEALTHY',supportsStructuredOutput:true
});
expect(r,201);

// Raw secrets cannot enter Environment / Connection metadata.
r=await request('POST',`/api/runtime/workspaces/${workspace.id}/platform-environments`,{
  environmentKey:'bad-secret',displayName:'bad',environmentType:'STAGING',
  externalRef:{apiKey:'sk-should-never-persist'},evidence:{test:true}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_RAW_SECRET_NOT_ALLOWED');

r=await request('POST',`/api/runtime/workspaces/${workspace.id}/platform-connections`,{
  connectionKey:'bad-secret',displayName:'bad',connectionType:'MODEL_PROVIDER',
  providerKey,adapterKey:'openai-responses',credentialRef:'sk-raw-secret-should-fail',
  endpointRef:{base:'provider-registry'},capabilityScope:{models:true},evidence:{test:true}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_RAW_SECRET_NOT_ALLOWED');

r=await request('POST',`/api/runtime/workspaces/${workspace.id}/platform-environments`,{
  environmentKey:'staging',displayName:'预发环境',environmentType:'STAGING',releaseChannel:'candidate',
  providerKey:null,externalRef:{platform:'RAILWAY',projectRef:'staging-project',serviceRef:'runtime-staging'},
  healthStatus:'UNKNOWN',metadata:{privateNetwork:true},evidence:{test:true,source:'M30.1'}
});
const env=expect(r,201);

r=await request('POST',`/api/runtime/workspaces/${workspace.id}/platform-connections`,{
  connectionKey:'openai-primary',displayName:'OpenAI 主连接',connectionType:'MODEL_PROVIDER',
  providerKey,adapterKey:'openai-responses',credentialRef:'ENV:OPENAI_API_KEY',
  endpointRef:{source:'PROVIDER_REGISTRY'},capabilityScope:{MODEL:true,EVAL:true},
  healthStatus:'UNKNOWN',metadata:{managedExternally:true},evidence:{test:true,source:'M30.1'}
});
const connection=expect(r,201);
assert.equal(connection.credentialRef,'ENV:OPENAI_API_KEY');

r=await request('POST',`/api/runtime/platform-environments/${env.id}/health`,{
  healthStatus:'HEALTHY',reasonCode:'STAGING_READY',latencyMs:35,
  observedAt:'2026-10-07T08:10:00Z',source:'M30_CI',evidence:{test:true,ready:true}
});
const envHealth=expect(r,200);
assert.equal(envHealth.healthStatus,'HEALTHY');

r=await request('POST',`/api/runtime/platform-connections/${connection.id}/health`,{
  healthStatus:'HEALTHY',reasonCode:'PROVIDER_REACHABLE',latencyMs:120,
  observedAt:'2026-10-07T08:10:30Z',source:'M30_CI',evidence:{test:true,reachable:true}
});
const connHealth=expect(r,200);
assert.equal(connHealth.healthStatus,'HEALTHY');

r=await request('GET',`/api/runtime/workspaces/${workspace.id}/operations-workbench`);
const workbench=expect(r,200);
assert.equal(workbench.frontend.language,'zh-CN');
assert.equal(workbench.frontend.title,'私有工作台');
assert.equal(workbench.workspace.id,workspace.id);
assert.equal(workbench.healthSummary.environments.healthy,1);
assert.equal(workbench.healthSummary.connections.healthy,1);
assert.ok(workbench.healthSummary.providers.healthy>=1);
assert.equal(workbench.upstream.m29ImplementationStatus,'PASS');
assert.equal(workbench.upstream.m29BlueprintExitStatus,'HOLD');

// Existing RBAC is reused: a workspace-scoped credential can read its workbench, not another workspace.
r=await request('GET',`/api/runtime/workspaces/${workspace.id}/operations-workbench`,undefined,credential.token);
expect(r,200);
r=await request('GET',`/api/runtime/workspaces/${otherWorkspace.id}/operations-workbench`,undefined,credential.token);
assert.equal(r.status,403,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/workspaces/${workspace.id}/m30-gates/G-M30-OPS-FOUNDATION/evaluate`,{
  asOf:'2026-10-07T08:11:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.m29ImplementationStatus,'PASS');
assert.equal(gate.evidenceSnapshot.secretPersistencePolicy,'REFERENCE_ONLY');
assert.ok(gate.evidenceSnapshot.healthEventCount>=2);

r=await request('GET',`/api/runtime/workspaces/${workspace.id}/m30-ops-foundation`);
const state=expect(r,200);
assert.equal(state.latestGate.status,'PASS');
assert.equal(state.workbench.healthSummary.environments.healthy,1);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM platform_environments WHERE workspace_id=? AND health_status='HEALTHY') healthy_env,
    (SELECT COUNT(*) FROM platform_connections WHERE workspace_id=? AND health_status='HEALTHY') healthy_conn,
    (SELECT COUNT(*) FROM platform_health_events WHERE workspace_id=? AND health_status='HEALTHY') health_events,
    (SELECT COUNT(*) FROM m30_ops_foundation_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-OPS-FOUNDATION' AND status='PASS') gate_pass`,
  [workspace.id,workspace.id,workspace.id,workspace.id]
);
assert.equal(Number(truth.healthy_env),1);
assert.equal(Number(truth.healthy_conn),1);
assert.ok(Number(truth.health_events)>=2);
assert.ok(Number(truth.gate_pass)>=1);

await db.end();
console.log('M30_1_PRIVATE_WORKSPACE_OPS_FOUNDATION_PASS');
