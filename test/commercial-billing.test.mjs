import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3100';
const request=async(method,path,body)=>{const response=await fetch(baseUrl+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});let payload={};try{payload=await response.json()}catch{}return {status:response.status,body:payload}};
const suffix=randomUUID().slice(0,8),providerKey=`openai-commercial-${suffix}`;

let r=await request('POST','/api/runtime/providers',{providerKey,providerType:'OPENAI',displayName:'OpenAI Commercial Billing',adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{providerKey,modelKey:'gpt-6-luna',displayName:'GPT-6 Luna',qualityTier:'STANDARD',latencyTier:'BALANCED',costTier:'LOW',priority:1,capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}});
assert.equal(r.status,201,JSON.stringify(r.body));

execFileSync(process.execPath,['scripts/import-pricing-catalog.mjs'],{stdio:'inherit',env:process.env});
execFileSync(process.execPath,['scripts/import-pricing-catalog.mjs'],{stdio:'inherit',env:process.env});

r=await request('GET',`/api/runtime/pricing-versions?providerKey=${encodeURIComponent(providerKey)}&modelKey=gpt-6-luna`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,4);
assert.deepEqual(r.body.data.map(x=>x.serviceTier).sort(),['BATCH','FAST','FLEX','STANDARD']);

r=await request('POST','/api/runtime/projects',{projectKey:`commercial-billing-${suffix}`,name:'Commercial Billing',projectType:'AIGC_CONTENT'});
assert.equal(r.status,201);const projectId=r.body.data.id;
r=await request('POST','/api/runtime/runs',{projectId,runType:'WORKFLOW',triggerSource:'CI',workflowVersion:'v2.2-m22.1',routerVersion:'policy-router-v2',status:'RUNNING'});
assert.equal(r.status,201);const runId=r.body.data.id;
r=await request('POST','/api/runtime/tasks',{runId,stageKey:'BILLING',taskKey:'commercial-billing',taskType:'SCRIPT_CONTINUITY',sequenceNo:1});
assert.equal(r.status,201);const taskId=r.body.data.id;

const execute=payload=>request('POST','/api/runtime/tool-executions',{runId,taskId,toolType:'MODEL_PROVIDER',toolKey:'openai.responses',providerKey,modelKey:'gpt-6-luna',status:'PASS',input:{queryHash:randomUUID()},output:{result:'pass'},durationMs:50,...payload});

r=await execute({tokenInput:1000,cachedInputTokens:200,cacheWriteTokens:100,tokenOutput:500,serviceTier:'default'});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.costStatus,'CALCULATED');assert.equal(r.body.data.serviceTier,'STANDARD');assert.equal(r.body.data.contextBand,'SHORT');assert.equal(r.body.data.costFormulaVersion,'TOKEN_COST_V2');assert.equal(r.body.data.estimatedCost,0.0003345);
const shortToolId=r.body.data.id;

r=await execute({tokenInput:300000,tokenOutput:100000,serviceTier:'default'});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.contextBand,'LONG');assert.equal(r.body.data.estimatedCost,0.135);

r=await execute({tokenInput:100000,tokenOutput:100000,serviceTier:'flex'});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.serviceTier,'FLEX');assert.equal(r.body.data.estimatedCost,0.03);

r=await execute({tokenInput:100000,tokenOutput:100000,serviceTier:'priority'});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.serviceTier,'FAST');assert.equal(r.body.data.estimatedCost,0.12);

r=await execute({tokenInput:100000,tokenOutput:100000,serviceTier:'default',regionalUpliftBps:1000});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.regionalUpliftBps,1000);assert.equal(r.body.data.estimatedCost,0.066);

r=await execute({tokenInput:100000,tokenOutput:100000,serviceTier:'ultrafast'});
assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.data.costStatus,'UNKNOWN');assert.equal(r.body.data.pricingVersionId,null);assert.equal(r.body.data.estimatedCost,null);

r=await request('GET',`/api/runtime/runs/${runId}/observability`);
assert.equal(r.status,200,JSON.stringify(r.body));
const observed=r.body.data.tools.find(x=>x.id===shortToolId);
assert.equal(observed.cachedInputTokens,200);assert.equal(observed.cacheWriteTokens,100);assert.equal(observed.serviceTier,'STANDARD');assert.equal(observed.contextBand,'SHORT');assert.equal(observed.costFormulaVersion,'TOKEN_COST_V2');

const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const [[catalogCount]]=await db.execute('SELECT COUNT(*) AS count FROM pricing_versions WHERE provider_key=? AND model_key=?',[providerKey,'gpt-6-luna']);
assert.equal(Number(catalogCount.count),4);
const [[stored]]=await db.execute(`SELECT cached_input_tokens,cache_write_tokens,service_tier,context_band,regional_uplift_bps,cost_formula_version FROM usage_ledger WHERE tool_execution_id=?`,[shortToolId]);
assert.equal(Number(stored.cached_input_tokens),200);assert.equal(Number(stored.cache_write_tokens),100);assert.equal(stored.service_tier,'STANDARD');assert.equal(stored.context_band,'SHORT');assert.equal(Number(stored.regional_uplift_bps),0);assert.equal(stored.cost_formula_version,'TOKEN_COST_V2');
await db.end();
console.log('G22_1_COMMERCIAL_BILLING_PASS');
