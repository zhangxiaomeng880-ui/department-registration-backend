import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3400';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};
  try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const planKey=`PRO_TEST_${suffix}`;

let r=await request('POST','/api/runtime/plans',{
  planKey,name:'Pro Test Plan',metadata:{purpose:'M22.3 gate'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.planKey,planKey);

r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'MODEL_EXECUTION',enabled:true,config:{maxContextTokens:500000}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.enabled,true);

r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'PREMIUM_FEATURE',enabled:false
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`commercial-tenant-${suffix}`,name:'Commercial Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
assert.equal(r.body.data.planKey,planKey);

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:`commercial-workspace-${suffix}`,name:'Commercial Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`commercial-project-${suffix}`,name:'Commercial Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',triggerSource:'CI',workflowVersion:'v2.2-m22.3',status:'RUNNING'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;

r=await request('POST',`/api/runtime/runs/${runId}/entitlement-evaluate`,{
  entitlementKey:'PREMIUM_FEATURE',source:'CI'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'DENY');
assert.equal(r.body.data.reasonCode,'ENTITLEMENT_DISABLED');

r=await request('POST',`/api/runtime/runs/${runId}/entitlement-evaluate`,{
  entitlementKey:'MODEL_EXECUTION',source:'CI'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'ALLOW');
assert.equal(r.body.data.planKey,planKey);

r=await request('POST','/api/runtime/quota-policies',{
  subjectType:'WORKSPACE',subjectId:workspaceId,policyKey:'preauth-tool-hard-2',
  metricKey:'TOOL_EXECUTION_COUNT',periodType:'MONTH',hardLimit:2,actionOnHard:'BLOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

const authorize=body=>request('POST',`/api/runtime/runs/${runId}/commercial-authorize`,{
  entitlementKey:'MODEL_EXECUTION',
  reservationMetric:'TOOL_EXECUTION_COUNT',
  reservationAmount:1,
  reservationTtlSeconds:300,
  source:'CI',
  ...body
});

r=await authorize({operationKey:'QUOTA_PREAUTH'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'ALLOW');
const reservation1=r.body.data.reservationId;

r=await authorize({operationKey:'QUOTA_PREAUTH'});
assert.equal(r.status,200,JSON.stringify(r.body));
const reservation2=r.body.data.reservationId;

r=await authorize({operationKey:'QUOTA_PREAUTH'});
assert.equal(r.status,429,JSON.stringify(r.body));
assert.equal(r.body.error,'QUOTA_BLOCKED');

r=await request('POST',`/api/runtime/usage-reservations/${reservation2}/release`,{reasonCode:'CI_RELEASE'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RELEASED');

r=await authorize({operationKey:'QUOTA_PREAUTH'});
assert.equal(r.status,200,JSON.stringify(r.body));
const reservation3=r.body.data.reservationId;

r=await request('POST',`/api/runtime/usage-reservations/${reservation3}/release`,{reasonCode:'CI_RELEASE'});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/usage-reservations/${reservation1}/commit`,{actualAmount:1});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'COMMITTED');
assert.equal(r.body.data.actualAmount,1);

r=await request('POST','/api/runtime/rate-limit-policies',{
  scopeType:'PLAN',planKey,policyKey:'plan-rate-one',operationKey:'RATE_TEST',
  windowSeconds:3600,maxRequests:1,actionOnExceed:'BLOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await authorize({operationKey:'RATE_TEST'});
assert.equal(r.status,200,JSON.stringify(r.body));
const rateReservation=r.body.data.reservationId;
r=await request('POST',`/api/runtime/usage-reservations/${rateReservation}/release`,{reasonCode:'CI_RELEASE'});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await authorize({operationKey:'RATE_TEST'});
assert.equal(r.status,429,JSON.stringify(r.body));
assert.equal(r.body.error,'RATE_LIMIT_BLOCKED');

r=await request('GET',`/api/runtime/usage-reservations?runId=${runId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.reasonCode==='RATE_LIMIT_REJECTED'&&x.status==='RELEASED'));

const deniedPlanKey=`DENY_TEST_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey:deniedPlanKey,name:'Deny Test Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{
  planKey:deniedPlanKey,entitlementKey:'MODEL_EXECUTION',enabled:false
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`denied-tenant-${suffix}`,name:'Denied Tenant',planKey:deniedPlanKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const deniedTenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{
  tenantId:deniedTenantId,workspaceKey:`denied-workspace-${suffix}`,name:'Denied Workspace'
});
assert.equal(r.status,201);
const deniedWorkspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{
  workspaceId:deniedWorkspaceId,projectKey:`denied-project-${suffix}`,name:'Denied Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const deniedProjectId=r.body.data.id;
r=await request('POST','/api/runtime/runs',{projectId:deniedProjectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'});
assert.equal(r.status,201);
const deniedRunId=r.body.data.id;
r=await request('POST','/api/runtime/tasks',{
  runId:deniedRunId,stageKey:'COMMERCIAL',taskKey:'denied-model',taskType:'SCRIPT_CONTINUITY',sequenceNo:1
});
assert.equal(r.status,201);
const deniedTaskId=r.body.data.id;

r=await request('POST','/api/runtime/agent-executions',{
  runId:deniedRunId,taskId:deniedTaskId,routeExecutionId:randomUUID(),
  query:'entitlement must deny before provider',
  contextPacket:{items:[{sourceFileId:'denied-source',sourceText:'CURRENT source content'}]}
});
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'ENTITLEMENT_DENIED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`bad-plan-${suffix}`,name:'Bad Plan Tenant',planKey:`MISSING_${suffix}`
});
assert.equal(r.status,404,JSON.stringify(r.body));
assert.equal(r.body.error,'PLAN_NOT_FOUND');

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

const [[legacyEntitlement]]=await db.execute(
  `SELECT COUNT(*) AS count FROM plan_entitlements
   WHERE plan_key='LEGACY' AND entitlement_key='MODEL_EXECUTION' AND enabled=TRUE`
);
assert.equal(Number(legacyEntitlement.count),1);

const [[entitlementAudit]]=await db.execute(
  'SELECT COUNT(*) AS count FROM entitlement_evaluations WHERE run_id=?',[runId]
);
assert.ok(Number(entitlementAudit.count)>=2);

const [[rateDecisionCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM rate_limit_decisions WHERE run_id=?',[runId]
);
assert.ok(Number(rateDecisionCount.count)>=2);

const [[reservedActive]]=await db.execute(
  `SELECT COUNT(*) AS count FROM usage_reservations
   WHERE run_id=? AND status='RESERVED' AND expires_at>CURRENT_TIMESTAMP(6)`,[runId]
);
assert.equal(Number(reservedActive.count),0);

await db.end();
console.log('G22_3_COMMERCIAL_CONTROL_PASS');
