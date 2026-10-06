import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m251-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
let r=await request('GET','/api/runtime/project-types',undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('GET','/api/runtime/project-types');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.projectTypeKey==='PRODUCT_DEVELOPMENT'));
assert.ok(r.body.data.some(x=>x.projectTypeKey==='AIGC_CONTENT'));

const providerKey=`m251-provider-${suffix}`;
const modelKey=`m251-model-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M25.1 Provider',adapterKey:'openai-responses',
  healthStatus:'HEALTHY',supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M25.1 Model',qualityTier:'HIGH',latencyTier:'FAST',costTier:'LOW',
  capabilities:{taskTypes:['PRODUCT_DISCOVERY','PRODUCT_DESIGN'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const modelCapabilityKey=`MODEL:${providerKey}:${modelKey}`;

const agentKey=`AGENT:PRODUCT_PM:${suffix}`;
const toolKey=`TOOL:FIGMA:${suffix}`;
const skillKey=`SKILL:PRD:${suffix}`;
const mcpKey=`MCP:GITHUB:${suffix}`;
for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'Product PM Agent',adapterKey:'agent-runtime'},
  {capabilityKey:toolKey,capabilityType:'TOOL',displayName:'Figma Tool',adapterKey:'figma'},
  {capabilityKey:skillKey,capabilityType:'SKILL',displayName:'PRD Skill',adapterKey:'skill-runtime'},
  {capabilityKey:mcpKey,capabilityType:'MCP',displayName:'GitHub MCP',adapterKey:'mcp-runtime'}
]){
  r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/capabilities',{
  capabilityKey:`TOOL:BAD:${suffix}`,capabilityType:'TOOL',displayName:'Bad',
  metadata:{apiKey:'must-not-persist'}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'CORE_META_SECRET_NOT_ALLOWED');

r=await request('GET','/api/runtime/capabilities?capabilityType=MODEL');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.capabilityKey===modelCapabilityKey),JSON.stringify(r.body.data));

r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'PRODUCT_MANAGER',policyMode:'QUALITY_FIRST',
  knowledgeScope:{domains:['PRODUCT_RND']}
});
assert.equal(r.status,201,JSON.stringify(r.body));

for(const childCapabilityKey of [modelCapabilityKey,toolKey,skillKey,mcpKey]){
  r=await request('POST','/api/runtime/agent-capability-grants',{
    agentCapabilityKey:agentKey,childCapabilityKey,requirementMode:'ALLOWED'
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

for(const [capabilityKey,bindingMode,priority] of [
  [agentKey,'DEFAULT',10],[modelCapabilityKey,'DEFAULT',20],[toolKey,'ALLOWED',30],
  [skillKey,'ALLOWED',40],[mcpKey,'ALLOWED',50]
]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey,bindingMode,priority
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',
  templateKey:`product-rnd-${suffix}`,version:'1.0.0',displayName:'Product R&D Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M1_DISCOVERY',displayName:'Discovery',sequenceNo:1,acceptance:{gate:'DISCOVERY_PASS'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestone1=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M2_BUILD',displayName:'Build',sequenceNo:2,acceptance:{gate:'BUILD_PASS'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestone2=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestone1,stageKey:'DISCOVERY',displayName:'Discovery',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-DISCOVERY'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const discoveryStageId=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-stages/${discoveryStageId}/requirements`,{
  requirementKey:'PRIMARY_MODEL',capabilityType:'MODEL',routingMode:'POLICY',
  requirementMode:'REQUIRED',priority:10,constraints:{structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/workflow-stages/${discoveryStageId}/requirements`,{
  requirementKey:'PRD_SKILL',capabilityType:'SKILL',capabilityKey:skillKey,
  routingMode:'FIXED',requirementMode:'REQUIRED',priority:20
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/workflow-stages/${discoveryStageId}/requirements`,{
  requirementKey:'TYPE_MISMATCH',capabilityType:'MODEL',capabilityKey:skillKey,
  routingMode:'FIXED',requirementMode:'REQUIRED'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'CAPABILITY_TYPE_MISMATCH');

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestone2,stageKey:'DESIGN_BUILD',displayName:'Design & Build',sequenceNo:2,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-BUILD'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const buildStageId=r.body.data.id;

for(const req of [
  {requirementKey:'DESIGN_TOOL',capabilityType:'TOOL',capabilityKey:toolKey,routingMode:'FIXED',requirementMode:'REQUIRED'},
  {requirementKey:'CODE_MCP',capabilityType:'MCP',capabilityKey:mcpKey,routingMode:'FIXED',requirementMode:'OPTIONAL'}
]){
  r=await request('POST',`/api/runtime/workflow-stages/${buildStageId}/requirements`,req);
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.match(r.body.data.definitionSha256,/^[a-f0-9]{64}$/);
const frozenHash=r.body.data.definitionSha256;
assert.equal(r.body.data.stages.length,2);
assert.equal(r.body.data.milestones.length,2);

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  stageKey:'SHOULD_FAIL',displayName:'Should Fail',sequenceNo:3
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'WORKFLOW_TEMPLATE_IMMUTABLE');

r=await request('GET',`/api/runtime/workflow-templates/${templateId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.definitionSha256,frozenHash);

r=await request('POST','/api/runtime/projects',{
  projectKey:`m251-product-${suffix}`,name:'M25.1 Product Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.lifecycle.project.currentStageKey,'DISCOVERY');
assert.equal(r.body.data.lifecycle.project.metaModelVersion,'core-meta-v1');
assert.equal(r.body.data.lifecycle.template.definitionSha256,frozenHash);
assert.equal(r.body.data.lifecycle.milestones.length,2);
assert.equal(r.body.data.lifecycle.milestones[0].status,'ACTIVE');
assert.equal(r.body.data.lifecycle.milestones[1].status,'PENDING');
assert.equal(r.body.data.lifecycle.stages.length,2);
assert.equal(r.body.data.lifecycle.stages[0].status,'ACTIVE');
assert.equal(r.body.data.lifecycle.stages[0].agentCapabilityKey,agentKey);
assert.equal(r.body.data.lifecycle.stages[1].status,'PENDING');

r=await request('GET',`/api/runtime/projects/${projectId}/lifecycle`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.workflowTemplateId,templateId);
assert.equal(r.body.data.template.definitionSha256,frozenHash);

r=await request('GET',`/api/runtime/projects/${projectId}/lifecycle`,undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  projectKey:`m251-aigc-${suffix}`,name:'M25.1 AIGC Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const mismatchProjectId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${mismatchProjectId}/workflow-bind`,{
  workflowTemplateId:templateId
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_WORKFLOW_TYPE_MISMATCH');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[capabilityCount]]=await db.execute(
  `SELECT COUNT(*) AS count FROM capability_registry
    WHERE capability_key IN (?,?,?,?,?)`,
  [modelCapabilityKey,agentKey,toolKey,skillKey,mcpKey]
);
assert.equal(Number(capabilityCount.count),5);
const [[modelBinding]]=await db.execute(
  'SELECT COUNT(*) AS count FROM model_capability_bindings WHERE capability_key=? AND provider_key=? AND model_key=?',
  [modelCapabilityKey,providerKey,modelKey]
);
assert.equal(Number(modelBinding.count),1);
const [[milestoneCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM project_milestones WHERE project_id=?',[projectId]
);
assert.equal(Number(milestoneCount.count),2);
const [[stageCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM project_stage_instances WHERE project_id=?',[projectId]
);
assert.equal(Number(stageCount.count),2);
await db.end();

console.log('G25_1_CORE_META_REGISTRY_PASS');
