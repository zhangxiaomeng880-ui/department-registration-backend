import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrapBuiltinDomainWorkflowSpecs } from '../src/domain-workflow-specs.mjs';
import { getRuntimePool } from '../src/runtime-db.mjs';

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

let r=await request('GET','/api/runtime/workflow-templates?templateClass=DOMAIN_STANDARD');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,2);
const pdSummary=r.body.data.find(x=>x.projectTypeKey==='PRODUCT_DEVELOPMENT');
const agSummary=r.body.data.find(x=>x.projectTypeKey==='AIGC_CONTENT');
for(const item of [pdSummary,agSummary]){
  assert.ok(item);
  assert.equal(item.status,'SPEC_FROZEN');
  assert.equal(item.executionReadiness,'SPEC_ONLY');
  assert.equal(item.templateClass,'DOMAIN_STANDARD');
  assert.match(item.definitionSha256,/^[a-f0-9]{64}$/);
}

r=await request('GET',`/api/runtime/workflow-templates/${pdSummary.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
const pd=r.body.data;
assert.equal(pd.version,'1.2.0');
assert.equal(pd.sourceSpecVersion,'V1.2_CURRENT');
assert.equal(pd.milestones.length,9);
assert.equal(pd.stages.length,19);
assert.deepEqual(pd.milestones.map(x=>x.milestoneKey),
  ['PD-M0','PD-M1','PD-M2','PD-M3','PD-M4','PD-M5','PD-M6','PD-M7','PD-M8']);
assert.deepEqual(pd.stages.map(x=>x.stageKey),[
  'PD-00-INIT','PD-01-DISCOVERY','PD-02-PRIORITY','PD-03-GOAL','PD-04-PRODUCT',
  'PD-05-FEASIBILITY','PD-06-PLAN','PD-07-DESIGN','PD-08-CONTRACT','PD-09-ENGINEERING',
  'PD-10-PREVIEW','PD-11-ACCEPTANCE','PD-12-QA','PD-13-RELEASE-READY','PD-14-RELEASE',
  'PD-15-POST-RELEASE','PD-16-OUTCOME','PD-17-REVIEW','PD-18-KNOWLEDGE'
]);
assert.ok(pd.stages.every(x=>x.milestoneTemplateId===null));
assert.ok(pd.stages.every(x=>x.agentAssignments.some(a=>a.assignmentRole==='PRIMARY')));
assert.ok(pd.stages.flatMap(x=>x.requirements).every(x=>x.routingMode==='DEFERRED'&&x.capabilityKey===null));
assert.ok(pd.stages.flatMap(x=>x.knowledgePolicies).length>=19);
const pdContract=pd.stages.find(x=>x.stageKey==='PD-08-CONTRACT');
const aiGate=pdContract.gateContracts.find(x=>x.gateKey==='G-PD-AI-CONTRACT');
assert.deepEqual(aiGate.appliesWhen,{subtype:'AI_APPLICATION'});
assert.ok(pdContract.agentAssignments.some(x=>x.conditional?.subtype==='AI_APPLICATION'));
assert.ok(pd.stages.find(x=>x.stageKey==='PD-14-RELEASE').requirements.some(x=>x.capabilityType==='CONNECTOR'));

r=await request('GET',`/api/runtime/workflow-templates/${agSummary.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
const ag=r.body.data;
assert.equal(ag.version,'2.4.0');
assert.equal(ag.sourceSpecVersion,'V2.4_CURRENT');
assert.equal(ag.milestones.length,10);
assert.equal(ag.stages.length,15);
assert.deepEqual(ag.milestones.map(x=>x.milestoneKey),
  ['AG-M0','AG-M1','AG-M2','AG-M3','AG-M4','AG-M5','AG-M6','AG-M7','AG-M8','AG-M9']);
assert.deepEqual(ag.stages.map(x=>x.stageKey),[
  'AG-00-INIT','AG-01-DISCOVERY','AG-02-PLAN','AG-03-SCRIPT','AG-04-BREAKDOWN',
  'AG-05-FORMAT','AG-06-ASSET','AG-07-IMAGE','AG-08-PRODUCTION','AG-09-EDIT',
  'AG-10-MASTER','AG-11-DERIVATION','AG-12-PUBLISH','AG-13-PERFORMANCE','AG-14-REVIEW'
]);
assert.ok(ag.stages.every(x=>x.milestoneTemplateId===null));
assert.ok(ag.stages.flatMap(x=>x.requirements).every(x=>x.routingMode==='DEFERRED'));
const master=ag.stages.find(x=>x.stageKey==='AG-10-MASTER');
assert.equal(master.gatePolicyKey,'G-AIGC-MASTER');
assert.deepEqual(master.gateContracts.map(x=>x.gateKey),[
  'G-AIGC-CREATIVE-ACCEPTANCE','G-AIGC-PRODUCTION-QA','G-AIGC-TECHNICAL-QA',
  'G-AIGC-COMPLIANCE','G-AIGC-LOCALIZATION-QA','G-AIGC-MASTER'
]);
assert.equal(master.gateContracts.find(x=>x.gateKey==='G-AIGC-MASTER').gateRole,'AGGREGATE');
assert.deepEqual(master.gateContracts.find(x=>x.gateKey==='G-AIGC-LOCALIZATION-QA').appliesWhen,{localizationEnabled:true});
assert.ok(ag.stages.find(x=>x.stageKey==='AG-07-IMAGE').requirements.some(x=>x.capabilityType==='MODEL'));
assert.ok(ag.stages.find(x=>x.stageKey==='AG-12-PUBLISH').requirements.some(x=>x.capabilityType==='CONNECTOR'));
assert.ok(ag.stages.find(x=>x.stageKey==='AG-14-REVIEW').knowledgePolicies.some(x=>x.writebackMode==='PROPOSE'));

const boot=await bootstrapBuiltinDomainWorkflowSpecs();
assert.ok(boot.every(x=>x.created===false));

const suffix=randomUUID().slice(0,8);
r=await request('POST','/api/runtime/projects',{
  projectKey:`m256-spec-${suffix}`,name:'M25.6 Spec',projectType:'PRODUCT_DEVELOPMENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/projects/${r.body.data.id}/workflow-bind`,{
  workflowTemplateId:pd.id
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'WORKFLOW_TEMPLATE_NOT_EXECUTION_READY');

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`illegal-${suffix}`,
  version:'1.0.0',displayName:'Illegal',status:'SPEC_FROZEN'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'WORKFLOW_TEMPLATE_DIRECT_FREEZE_NOT_ALLOWED');

const agentKey=`AGENT:M256:${suffix}`;
r=await request('POST','/api/runtime/capabilities',{
  capabilityKey:agentKey,capabilityType:'AGENT',displayName:'M25.6 Agent',adapterKey:'agent-runtime',routable:false
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/project-type-capabilities',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey:agentKey,bindingMode:'ALLOWED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`deferred-${suffix}`,
  version:'1.0.0',displayName:'Deferred'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  stageKey:'S1',displayName:'S1',sequenceNo:1,defaultAgentCapabilityKey:agentKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const stageId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,{
  requirementKey:'FUTURE',capabilityType:'SKILL',routingMode:'DEFERRED',requirementMode:'REQUIRED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'WORKFLOW_DEFERRED_REQUIREMENTS');

await getRuntimePool().end();
console.log('G25_6_DOMAIN_WORKFLOW_SPECS_PASS');
