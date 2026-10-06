import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m256-token';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const agentKey=`AGENT:M256-CONNECT:${suffix}`;
const connectorKey=`CONNECTOR:INTERNAL:${suffix}`;

for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'Connector Agent',adapterKey:'agent-runtime',routable:false},
  {capabilityKey:connectorKey,capabilityType:'CONNECTOR',displayName:'Internal Connector',adapterKey:'internal-test'}
]){
  let r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
let r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'CONNECTOR_OWNER',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/agent-capability-grants',{
  agentCapabilityKey:agentKey,childCapabilityKey:connectorKey,requirementMode:'ALLOWED',priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
for(const [capabilityKey,bindingMode] of [[agentKey,'ALLOWED'],[connectorKey,'DEFAULT']]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey,bindingMode,priority:1
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`connector-${suffix}`,
  version:'1.0.0',displayName:'Connector Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  stageKey:'CONNECT',displayName:'Connect',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-CONNECT',config:{maxRetries:0}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const stageId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/agents`,{
  agentCapabilityKey:agentKey,assignmentRole:'PRIMARY',priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/gate-contracts`,{
  gateKey:'G-CONNECT',gateRole:'PRIMARY',required:true,sequenceNo:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,{
  requirementKey:'CONNECTOR_CALL',capabilityType:'CONNECTOR',capabilityKey:connectorKey,
  routingMode:'FIXED',requirementMode:'REQUIRED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.executionReadiness,'EXECUTION_READY');

r=await request('POST','/api/runtime/projects',{
  projectKey:`connector-project-${suffix}`,name:'Connector Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',status:'RUNNING',triggerSource:'USER',
  workflowVersion:'1.0.0',routerVersion:'capability-router-v1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;
r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'CONNECT',taskKey:'connector-call',taskType:'CONNECTOR_TEST',
  sequenceNo:1,input:{purpose:'M25.6'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;
r=await request('POST','/api/runtime/capability-invocations',{
  projectId,runId,taskId,stageKey:'CONNECT',requirementKey:'CONNECTOR_CALL',
  input:{payload:{connected:true}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invocation.status,'PASS');
assert.equal(r.body.data.invocation.capabilityType,'CONNECTOR');
assert.equal(r.body.data.output.payload.connected,true);

console.log('G25_6_CONNECTOR_INVOCATION_PASS');
