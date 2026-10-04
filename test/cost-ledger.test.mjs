import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const request = async (method,path,body) => {
  const response = await fetch(baseUrl + path,{
    method,
    headers:{'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  let payload={};
  try { payload=await response.json(); } catch {}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);

let r=await request('POST','/api/runtime/providers',{
  providerKey:`cost-openai-${suffix}`,
  providerType:'OPENAI',
  displayName:'Cost Ledger OpenAI',
  adapterKey:'openai-responses',
  healthStatus:'HEALTHY',
  priority:10,
  supportsStructuredOutput:true
});
assert.equal(r.status,201);
const providerKey=r.body.data.providerKey;

r=await request('POST','/api/runtime/models',{
  providerKey,
  modelKey:'cost-model',
  displayName:'Cost Model',
  qualityTier:'HIGH',
  latencyTier:'BALANCED',
  costTier:'MEDIUM',
  priority:10,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201);

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,
  modelKey:'cost-model',
  currency:'USD',
  inputRatePerMillion:1,
  outputRatePerMillion:1,
  effectiveFrom:'2019-01-01T00:00:00.000Z',
  sourceLabel:'SECRET_REJECTION_TEST',
  metadata:{apiKey:'must-not-persist'}
});
assert.equal(r.status,400);

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,
  modelKey:'cost-model',
  currency:'USD',
  inputRatePerMillion:2,
  outputRatePerMillion:6,
  effectiveFrom:'2020-01-01T00:00:00.000Z',
  sourceLabel:'SYNTHETIC_V1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const priceV1=r.body.data;
assert.equal(priceV1.inputRatePerMillion,2);
assert.equal(priceV1.outputRatePerMillion,6);

r=await request('POST','/api/runtime/projects',{
  projectKey:`cost-ledger-a-${suffix}`,
  name:'Cost Ledger A',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const projectA=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId:projectA,
  runType:'WORKFLOW',
  triggerSource:'CI',
  workflowVersion:'cost-ledger-v1',
  routerVersion:'policy-router-v2',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runA=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId:runA,
  stageKey:'SCRIPT',
  taskKey:'cost-ledger-task-a',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1
});
assert.equal(r.status,201);
const taskA=r.body.data.id;

r=await request('POST','/api/runtime/tool-executions',{
  runId:runA,
  taskId:taskA,
  toolType:'MODEL_PROVIDER',
  toolKey:'openai.responses',
  providerKey,
  modelKey:'cost-model',
  status:'PASS',
  input:{queryHash:'synthetic-v1'},
  output:{result:'pass'},
  tokenInput:1000000,
  tokenOutput:500000,
  durationMs:100
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.pricingVersionId,priceV1.id);
assert.equal(r.body.data.estimatedCost,5);
assert.equal(r.body.data.costCurrency,'USD');
const toolV1=r.body.data.id;

r=await request('GET',`/api/runtime/runs/${runA}/cost-summary`);
assert.equal(r.status,200);
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.unknownCount,0);
assert.equal(r.body.data.estimatedCost,5);
assert.equal(r.body.data.byProviderModel[0].providerKey,providerKey);
assert.equal(r.body.data.byProviderModel[0].estimatedCost,5);

r=await request('GET',`/api/runtime/runs/${runA}/observability`);
assert.equal(r.status,200);
assert.equal(r.body.data.summary.costStatus,'CALCULATED');
assert.equal(r.body.data.summary.estimatedCost,5);
assert.equal(r.body.data.tools[0].pricingVersionId,priceV1.id);
assert.equal(r.body.data.tools[0].costAmount,5);
assert.equal(r.body.data.usage[0].estimatedCost,5);

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,
  modelKey:'cost-model',
  currency:'USD',
  inputRatePerMillion:4,
  outputRatePerMillion:8,
  effectiveFrom:'2020-02-01T00:00:00.000Z',
  sourceLabel:'SYNTHETIC_V2'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const priceV2=r.body.data;
assert.notEqual(priceV2.id,priceV1.id);

r=await request('POST','/api/runtime/tool-executions',{
  runId:runA,
  taskId:taskA,
  toolType:'MODEL_PROVIDER',
  toolKey:'openai.responses',
  providerKey,
  modelKey:'cost-model',
  status:'PASS',
  input:{queryHash:'synthetic-v2'},
  output:{result:'pass'},
  tokenInput:1000000,
  tokenOutput:500000,
  durationMs:120
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.pricingVersionId,priceV2.id);
assert.equal(r.body.data.estimatedCost,8);
const toolV2=r.body.data.id;

r=await request('GET',`/api/runtime/pricing-versions?providerKey=${encodeURIComponent(providerKey)}&modelKey=cost-model`);
assert.equal(r.status,200);
assert.equal(r.body.data.length,2);

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,
  modelKey:'cost-model',
  currency:'USD',
  inputRatePerMillion:999,
  outputRatePerMillion:999,
  effectiveFrom:'2020-02-01T00:00:00.000Z',
  sourceLabel:'ILLEGAL_OVERWRITE'
});
assert.equal(r.status,409);

const unpricedProvider=`unpriced-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey:unpricedProvider,
  providerType:'SYNTHETIC',
  displayName:'Unpriced Provider',
  adapterKey:'synthetic-unpriced',
  healthStatus:'HEALTHY',
  supportsStructuredOutput:true
});
assert.equal(r.status,201);

r=await request('POST','/api/runtime/models',{
  providerKey:unpricedProvider,
  modelKey:'unpriced-model',
  displayName:'Unpriced Model',
  qualityTier:'STANDARD',
  latencyTier:'BALANCED',
  costTier:'LOW'
});
assert.equal(r.status,201);

r=await request('POST','/api/runtime/tool-executions',{
  runId:runA,
  taskId:taskA,
  toolType:'MODEL_PROVIDER',
  toolKey:'synthetic.unpriced',
  providerKey:unpricedProvider,
  modelKey:'unpriced-model',
  status:'PASS',
  input:{queryHash:'unpriced-synthetic'},
  output:{result:'pass'},
  tokenInput:1000,
  tokenOutput:1000,
  durationMs:50
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.costStatus,'UNKNOWN');
assert.equal(r.body.data.pricingVersionId,null);
assert.equal(r.body.data.estimatedCost,null);
assert.equal(r.body.data.costCurrency,null);
const unpricedTool=r.body.data.id;

r=await request('GET',`/api/runtime/runs/${runA}/cost-summary`);
assert.equal(r.status,200);
assert.equal(r.body.data.costStatus,'UNKNOWN');
assert.equal(r.body.data.unknownCount,1);
assert.equal(r.body.data.estimatedCost,13);

r=await request('POST','/api/runtime/budget-policies',{
  projectId:projectA,
  policyKey:'default-budget',
  currency:'USD',
  runLimitAmount:10,
  actionOnExceed:'HOLD'
});
assert.equal(r.status,201);

r=await request('POST',`/api/runtime/projects/${projectA}/budget-evaluate`,{runId:runA});
assert.equal(r.status,200);
assert.equal(r.body.data.decision,'HOLD');
assert.equal(r.body.data.reason,'COST_UNKNOWN_MISSING_PRICING');

r=await request('POST','/api/runtime/projects',{
  projectKey:`cost-ledger-b-${suffix}`,
  name:'Cost Ledger B',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const projectB=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId:projectB,
  runType:'WORKFLOW',
  triggerSource:'CI',
  workflowVersion:'cost-ledger-v1',
  routerVersion:'policy-router-v2',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runB=r.body.data.id;

r=await request('POST','/api/runtime/tool-executions',{
  runId:runB,
  toolType:'MODEL_PROVIDER',
  toolKey:'openai.responses',
  providerKey,
  modelKey:'cost-model',
  status:'PASS',
  input:{queryHash:'budget-exceed'},
  output:{result:'pass'},
  tokenInput:1000000,
  tokenOutput:2000000,
  durationMs:130
});
assert.equal(r.status,201);
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.pricingVersionId,priceV2.id);
assert.equal(r.body.data.estimatedCost,20);

r=await request('POST','/api/runtime/budget-policies',{
  projectId:projectB,
  policyKey:'hard-run-budget',
  currency:'USD',
  runLimitAmount:10,
  actionOnExceed:'BLOCK'
});
assert.equal(r.status,201);

r=await request('POST',`/api/runtime/projects/${projectB}/budget-evaluate`,{runId:runB});
assert.equal(r.status,200);
assert.equal(r.body.data.decision,'BLOCK');
assert.equal(r.body.data.reason,'RUN_BUDGET_EXCEEDED');
assert.equal(r.body.data.runSummary.estimatedCost,20);

r=await request('POST','/api/runtime/budget-policies',{
  projectId:projectB,
  policyKey:'hard-run-budget',
  currency:'EUR',
  runLimitAmount:10,
  actionOnExceed:'BLOCK'
});
assert.equal(r.status,201);

r=await request('POST',`/api/runtime/projects/${projectB}/budget-evaluate`,{runId:runB});
assert.equal(r.status,200);
assert.equal(r.body.data.decision,'HOLD');
assert.equal(r.body.data.reason,'BUDGET_CURRENCY_MISMATCH');
assert.equal(r.body.data.policyCurrency,'EUR');
assert.equal(r.body.data.costCurrency,'USD');

r=await request('GET',`/api/runtime/projects/${projectB}/cost-summary`);
assert.equal(r.status,200);
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.estimatedCost,20);
assert.equal(r.body.data.byRun[0].runId,runB);
assert.equal(r.body.data.byProviderModel.length,1);
assert.equal(r.body.data.byProviderModel[0].providerKey,providerKey);
assert.equal(r.body.data.byProviderModel[0].modelKey,'cost-model');
assert.equal(r.body.data.byProviderModel[0].estimatedCost,20);
assert.ok(Array.isArray(r.body.data.byStage));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

const [history]=await db.execute(
  `SELECT tool_execution_id, pricing_version_id, cost_status, estimated_cost, cost_currency
   FROM usage_ledger
   WHERE tool_execution_id IN (?,?)
   ORDER BY recorded_at`,
  [toolV1,toolV2]
);
assert.equal(history.length,2);
assert.equal(history[0].pricing_version_id,priceV1.id);
assert.equal(Number(history[0].estimated_cost),5);
assert.equal(history[1].pricing_version_id,priceV2.id);
assert.equal(Number(history[1].estimated_cost),8);

const [[unknownToolRow]]=await db.execute(
  `SELECT cost_amount, cost_currency, cost_status, pricing_version_id
   FROM tool_executions WHERE id=?`,
  [unpricedTool]
);
assert.equal(unknownToolRow.cost_amount,null);
assert.equal(unknownToolRow.cost_currency,null);
assert.equal(unknownToolRow.cost_status,'UNKNOWN');
assert.equal(unknownToolRow.pricing_version_id,null);

const [[unknownUsageRow]]=await db.execute(
  `SELECT estimated_cost, cost_currency, cost_status, pricing_version_id
   FROM usage_ledger WHERE tool_execution_id=?`,
  [unpricedTool]
);
assert.equal(unknownUsageRow.estimated_cost,null);
assert.equal(unknownUsageRow.cost_currency,null);
assert.equal(unknownUsageRow.cost_status,'UNKNOWN');
assert.equal(unknownUsageRow.pricing_version_id,null);

const [[priceCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM pricing_versions WHERE provider_key=? AND model_key=?',
  [providerKey,'cost-model']
);
assert.equal(Number(priceCount.count),2);

// M22.5 intentionally introduces subscriptions; payment-provider tables remain out of scope.
const [[forbiddenCommercialTables]]=await db.execute(
  `SELECT COUNT(*) AS count
   FROM information_schema.tables
   WHERE table_schema=DATABASE()
     AND table_name IN ('payments','charges','checkout_sessions')`
);
assert.equal(Number(forbiddenCommercialTables.count),0);

await db.end();
console.log('G21_COST_ACCOUNTING_PASS');
