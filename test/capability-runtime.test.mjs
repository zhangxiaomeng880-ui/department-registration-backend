import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m252-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const providerKey=`m252-provider-${suffix}`;
const modelKey='test-model';
const modelCapabilityKey=`MODEL:${providerKey}:${modelKey}`;
const agentKey=`AGENT:SCRIPT:${suffix}`;
const toolKey=`TOOL:INTERNAL:${suffix}`;
const skillKey=`SKILL:INTERNAL:${suffix}`;
const mcpKey=`MCP:INTERNAL:${suffix}`;
const badToolKey=`TOOL:UNIMPLEMENTED:${suffix}`;

let r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M25.2 Mock Provider',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',supportsStructuredOutput:true,priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M25.2 Mock Model',qualityTier:'HIGH',latencyTier:'FAST',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey,currency:'USD',inputRatePerMillion:10,outputRatePerMillion:10,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M25_2_MOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'Script Agent',adapterKey:'agent-runtime'},
  {capabilityKey:toolKey,capabilityType:'TOOL',displayName:'Internal Tool',adapterKey:'internal-test'},
  {capabilityKey:skillKey,capabilityType:'SKILL',displayName:'Internal Skill',adapterKey:'internal-test'},
  {capabilityKey:mcpKey,capabilityType:'MCP',displayName:'Internal MCP',adapterKey:'internal-test'},
  {capabilityKey:badToolKey,capabilityType:'TOOL',displayName:'Missing Adapter Tool',adapterKey:'missing-adapter'}
]){
  r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'SCRIPT_AGENT',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));
for(const childCapabilityKey of [modelCapabilityKey,toolKey,skillKey,mcpKey,badToolKey]){
  r=await request('POST','/api/runtime/agent-capability-grants',{
    agentCapabilityKey:agentKey,childCapabilityKey,requirementMode:'ALLOWED',priority:10
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}
for(const [capabilityKey,bindingMode,priority] of [
  [agentKey,'DEFAULT',1],[modelCapabilityKey,'DEFAULT',2],[toolKey,'DEFAULT',3],
  [skillKey,'DEFAULT',4],[mcpKey,'DEFAULT',5],[badToolKey,'ALLOWED',99]
]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'AIGC_CONTENT',capabilityKey,bindingMode,priority
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'AIGC_CONTENT',templateKey:`aigc-invoke-${suffix}`,version:'1.0.0',
  displayName:'AIGC Unified Invocation'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M1_SCRIPT',displayName:'Script',sequenceNo:1,acceptance:{gate:'SCRIPT_PASS'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestoneId,stageKey:'SCRIPT',displayName:'Script',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-SCRIPT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const stageId=r.body.data.id;
for(const requirement of [
  {requirementKey:'PRIMARY_MODEL',capabilityType:'MODEL',routingMode:'POLICY',requirementMode:'REQUIRED',
   constraints:{taskType:'SCRIPT_CONTINUITY',structuredOutput:true}},
  {requirementKey:'FIXED_TOOL',capabilityType:'TOOL',capabilityKey:toolKey,routingMode:'FIXED',requirementMode:'REQUIRED'},
  {requirementKey:'POLICY_SKILL',capabilityType:'SKILL',routingMode:'POLICY',requirementMode:'REQUIRED',
   constraints:{allowedCapabilityKeys:[skillKey]}},
  {requirementKey:'FIXED_MCP',capabilityType:'MCP',capabilityKey:mcpKey,routingMode:'FIXED',requirementMode:'OPTIONAL'},
  {requirementKey:'FAIL_TOOL',capabilityType:'TOOL',capabilityKey:badToolKey,routingMode:'FIXED',requirementMode:'OPTIONAL'}
]){
  r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,requirement);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');

const planKey=`M252_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey,name:'M25.2 Invocation Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'MODEL_EXECUTION',enabled:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m252-${suffix}`,name:'M25.2 Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'Main'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m252-project-${suffix}`,name:'M25.2 AIGC Project',
  projectType:'AIGC_CONTENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.lifecycle.project.currentStageKey,'SCRIPT');

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',status:'RUNNING',triggerSource:'USER',
  workflowVersion:'1.0.0',routerVersion:'capability-router-v1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;
r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'SCRIPT',taskKey:'unified-capability-test',taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,input:{purpose:'M25.2'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;

r=await request('POST','/api/runtime/capability-invocations',{
  projectId,runId,taskId,stageKey:'SCRIPT',requirementKey:'FIXED_TOOL',
  input:{payload:{kind:'tool',value:1}}
},null);
assert.equal(r.status,401,JSON.stringify(r.body));

const outputs={};
for(const [requirementKey,kind] of [
  ['FIXED_TOOL','tool'],['POLICY_SKILL','skill'],['FIXED_MCP','mcp']
]){
  r=await request('POST','/api/runtime/capability-invocations',{
    projectId,runId,taskId,stageKey:'SCRIPT',requirementKey,
    input:{payload:{kind,value:requirementKey}}
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.data.invocation.status,'PASS');
  assert.equal(r.body.data.outputPersisted,false);
  assert.equal(r.body.data.output.payload.kind,kind);
  assert.match(r.body.data.invocation.inputSha256,/^[a-f0-9]{64}$/);
  assert.match(r.body.data.invocation.outputSha256,/^[a-f0-9]{64}$/);
  outputs[requirementKey]=r.body.data;
}
assert.equal(outputs.FIXED_TOOL.resolution.routingMode,'FIXED');
assert.equal(outputs.FIXED_TOOL.invocation.selectedCapabilityKey,toolKey);
assert.equal(outputs.POLICY_SKILL.resolution.routingMode,'POLICY');
assert.equal(outputs.POLICY_SKILL.invocation.selectedCapabilityKey,skillKey);
assert.equal(outputs.FIXED_MCP.invocation.selectedCapabilityKey,mcpKey);

const continuitySchema={
  type:'object',
  properties:{
    scope:{type:'string'},
    findingCount:{type:'integer',minimum:0},
    findings:{type:'array',items:{type:'object',properties:{
      code:{type:'string'},severity:{type:'string'},scene:{type:'string'},summary:{type:'string'},
      evidence:{type:'array',items:{type:'object',properties:{
        sourceFileId:{type:'string'},sourceVersion:{type:['string','null']},
        lineStart:{type:['integer','null']},lineEnd:{type:['integer','null']}
      },required:['sourceFileId','sourceVersion','lineStart','lineEnd'],additionalProperties:false}}
    },required:['code','severity','scene','summary','evidence'],additionalProperties:false}},
    noOtherHardConflicts:{type:'boolean'}
  },
  required:['scope','findingCount','findings','noOtherHardConflicts'],
  additionalProperties:false
};
r=await request('POST','/api/runtime/capability-invocations',{
  projectId,runId,taskId,stageKey:'SCRIPT',requirementKey:'PRIMARY_MODEL',
  input:{
    instructions:'Perform continuity analysis from supplied context.',
    input:'SC049 LIBRARY_SENTINEL_SOURCE_TEXT SC049 hard lock',
    schema:continuitySchema,schemaName:'script_continuity_analysis'
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));
const modelInvocation=r.body.data;
assert.equal(modelInvocation.invocation.status,'PASS');
assert.equal(modelInvocation.resolution.routingMode,'POLICY');
assert.equal(modelInvocation.invocation.selectedCapabilityKey,modelCapabilityKey);
assert.equal(modelInvocation.resolution.selected.providerKey,providerKey);
assert.equal(modelInvocation.resolution.selected.modelKey,modelKey);
assert.equal(modelInvocation.output.findingCount,1);
assert.ok(modelInvocation.invocation.toolExecutionId);
assert.ok(modelInvocation.invocation.usageLedgerId);
assert.equal(modelInvocation.invocation.outputEvidence.outputPersisted,false);

r=await request('GET',`/api/runtime/capability-invocations/${modelInvocation.invocation.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.selectedCapabilityKey,modelCapabilityKey);
assert.equal(r.body.data.status,'PASS');

r=await request('POST','/api/runtime/capability-invocations',{
  projectId,runId,taskId,stageKey:'SCRIPT',requirementKey:'FAIL_TOOL',
  input:{payload:{must:'fail'}}
});
assert.equal(r.status,503,JSON.stringify(r.body));
assert.equal(r.body.error,'CAPABILITY_ADAPTER_NOT_IMPLEMENTED');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[counts]]=await db.execute(
  `SELECT
     SUM(status='PASS') AS passed,
     SUM(status='FAIL') AS failed,
     COUNT(*) AS total
   FROM capability_invocations WHERE project_id=?`,
  [projectId]
);
assert.equal(Number(counts.passed),4);
assert.equal(Number(counts.failed),1);
assert.equal(Number(counts.total),5);
const [[failed]]=await db.execute(
  `SELECT error_code,adapter_key,output_evidence_json
     FROM capability_invocations
    WHERE project_id=? AND selected_capability_key=? ORDER BY created_at DESC LIMIT 1`,
  [projectId,badToolKey]
);
assert.equal(failed.error_code,'CAPABILITY_ADAPTER_NOT_IMPLEMENTED');
assert.equal(failed.adapter_key,'missing-adapter');
const [[usage]]=await db.execute(
  `SELECT COUNT(*) AS count,MIN(provider_key) AS provider_key,MIN(model_key) AS model_key
     FROM usage_ledger WHERE run_id=? AND tool_execution_id=?`,
  [runId,modelInvocation.invocation.toolExecutionId]
);
assert.equal(Number(usage.count),1);
assert.equal(usage.provider_key,providerKey);
assert.equal(usage.model_key,modelKey);
const [[bodyLeak]]=await db.execute(
  `SELECT COUNT(*) AS count FROM capability_invocations
    WHERE project_id=? AND (
      CAST(decision_json AS CHAR) LIKE '%LIBRARY_SENTINEL_SOURCE_TEXT%'
      OR CAST(output_evidence_json AS CHAR) LIKE '%LIBRARY_SENTINEL_SOURCE_TEXT%'
    )`,
  [projectId]
);
assert.equal(Number(bodyLeak.count),0);
await db.end();

console.log('G25_2_UNIFIED_CAPABILITY_INVOCATION_PASS');
