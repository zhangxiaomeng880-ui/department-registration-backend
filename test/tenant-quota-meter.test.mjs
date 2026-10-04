import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3300';
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

let r=await request('POST','/api/runtime/tenants',{
  tenantKey:`tenant-${suffix}`,
  name:'Tenant Quota Test'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,
  workspaceKey:`workspace-${suffix}`,
  name:'Workspace Quota Test'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;
assert.equal(r.body.data.tenantId,tenantId);

r=await request('POST','/api/runtime/projects',{
  workspaceId,
  projectKey:`tenant-project-${suffix}`,
  name:'Tenant Project',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.tenantId,tenantId);
assert.equal(r.body.data.workspaceId,workspaceId);

r=await request('POST','/api/runtime/projects',{
  projectKey:`legacy-project-${suffix}`,
  name:'Legacy Compatibility Project',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.tenantId,'00000000-0000-4000-8000-000000000101');
assert.equal(r.body.data.workspaceId,'00000000-0000-4000-8000-000000000102');

r=await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CI',
  workflowVersion:'v2.2-m22.2',
  routerVersion:'policy-router-v2',
  status:'RUNNING'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;
assert.equal(r.body.data.tenantId,tenantId);
assert.equal(r.body.data.workspaceId,workspaceId);

r=await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'QUOTA',
  taskKey:'quota-meter',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;

const providerKey=`quota-provider-${suffix}`;
const modelKey=`quota-model-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'TEST',displayName:'Quota Provider',adapterKey:'openai-responses',
  healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'Quota Model',qualityTier:'STANDARD',latencyTier:'BALANCED',
  costTier:'LOW',priority:1,capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey,serviceTier:'STANDARD',currency:'USD',
  inputRatePerMillion:1,outputRatePerMillion:5,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M22_2_TEST'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tool-executions',{
  runId,taskId,toolType:'MODEL_PROVIDER',toolKey:'quota.test',
  providerKey,modelKey,status:'PASS',tokenInput:400,tokenOutput:200,durationMs:10
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.estimatedCost,0.0014);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/usage-meter?periodType=MONTH`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.tenantId,tenantId);
assert.equal(r.body.data.workspaceId,workspaceId);
assert.equal(r.body.data.usageCount,1);
assert.equal(r.body.data.runCount,1);
assert.equal(r.body.data.tokenInput,400);
assert.equal(r.body.data.tokenOutput,200);
assert.equal(r.body.data.tokenTotal,600);
assert.equal(r.body.data.estimatedCost,0.0014);
assert.equal(r.body.data.costStatus,'CALCULATED');

r=await request('GET',`/api/runtime/tenants/${tenantId}/usage-meter?periodType=DAY`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.workspaceId,null);
assert.equal(r.body.data.runCount,1);
assert.equal(r.body.data.tokenTotal,600);

r=await request('POST','/api/runtime/quota-policies',{
  subjectType:'WORKSPACE',subjectId:workspaceId,policyKey:'workspace-soft-tokens',
  metricKey:'TOKEN_TOTAL',periodType:'MONTH',softLimit:500,hardLimit:1000,
  actionOnSoft:'HOLD',actionOnHard:'BLOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/runs/${runId}/quota-evaluate`,{source:'CI'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'HOLD');
assert.ok(r.body.data.evaluations.some(x=>x.policyKey==='workspace-soft-tokens'&&x.reasonCode==='SOFT_LIMIT_REACHED'));

r=await request('POST','/api/runtime/quota-policies',{
  subjectType:'TENANT',subjectId:tenantId,policyKey:'tenant-hard-tokens',
  metricKey:'TOKEN_TOTAL',periodType:'MONTH',hardLimit:600,actionOnHard:'BLOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/runs/${runId}/quota-evaluate`,{source:'CI'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'BLOCK');
assert.equal(r.body.data.policyCount,2);

r=await request('POST','/api/runtime/agent-executions',{
  runId,taskId,routeExecutionId:randomUUID(),query:'quota must block before provider execution',
  selectedProviderKey:providerKey,selectedModelKey:modelKey,selectedAdapterKey:'openai-responses',
  contextPacket:{items:[{sourceFileId:'quota-source',sourceText:'CURRENT source content'}]}
});
assert.equal(r.status,429,JSON.stringify(r.body));
assert.equal(r.body.error,'QUOTA_BLOCKED');
assert.equal(r.body.details.decision,'BLOCK');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`unknown-cost-tenant-${suffix}`,name:'Unknown Cost Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const unknownTenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{
  tenantId:unknownTenantId,workspaceKey:`unknown-cost-${suffix}`,name:'Unknown Cost Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const unknownWorkspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{
  workspaceId:unknownWorkspaceId,projectKey:`unknown-cost-project-${suffix}`,
  name:'Unknown Cost Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const unknownProjectId=r.body.data.id;
r=await request('POST','/api/runtime/runs',{
  projectId:unknownProjectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'
});
assert.equal(r.status,201);
const unknownRunId=r.body.data.id;
r=await request('POST','/api/runtime/tasks',{
  runId:unknownRunId,stageKey:'QUOTA',taskKey:'unknown-cost',taskType:'SCRIPT_CONTINUITY',sequenceNo:1
});
assert.equal(r.status,201);
const unknownTaskId=r.body.data.id;
r=await request('POST','/api/runtime/tool-executions',{
  runId:unknownRunId,taskId:unknownTaskId,toolType:'MODEL_PROVIDER',toolKey:'unknown.cost',
  providerKey:'unpriced-provider',modelKey:'unpriced-model',status:'PASS',tokenInput:100,tokenOutput:50
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.costStatus,'UNKNOWN');

r=await request('POST','/api/runtime/quota-policies',{
  subjectType:'WORKSPACE',subjectId:unknownWorkspaceId,policyKey:'cost-fail-closed',
  metricKey:'COST_AMOUNT',periodType:'MONTH',hardLimit:10,actionOnHard:'BLOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/runs/${unknownRunId}/quota-evaluate`,{source:'CI'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'HOLD');
assert.equal(r.body.data.evaluations[0].reasonCode,'QUOTA_COST_UNKNOWN');

r=await request('GET',`/api/runtime/tenants/${tenantId}/usage-meter?periodType=MONTH`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.tokenTotal,600);
assert.equal(r.body.data.runCount,1);

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[usageScope]]=await db.execute(
  'SELECT tenant_id,workspace_id FROM usage_ledger WHERE run_id=? LIMIT 1',[runId]
);
assert.equal(usageScope.tenant_id,tenantId);
assert.equal(usageScope.workspace_id,workspaceId);
const [[runScope]]=await db.execute(
  'SELECT tenant_id,workspace_id FROM runs WHERE id=?',[runId]
);
assert.equal(runScope.tenant_id,tenantId);
assert.equal(runScope.workspace_id,workspaceId);
const [[evaluationCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM quota_evaluations WHERE run_id=?',[runId]
);
assert.ok(Number(evaluationCount.count)>=4);
await db.end();

console.log('G22_2_TENANT_QUOTA_METER_PASS');
