import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m256-platform-token';
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const suffix=randomUUID().slice(0,8);

let r=await request('GET','/api/runtime/domain-presets',undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/domain-presets/sync',{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,2);

r=await request('GET','/api/runtime/domain-presets');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,2);
assert.ok(r.body.data.some(x=>x.presetKey==='PRODUCT_DEVELOPMENT_STANDARD'));
assert.ok(r.body.data.some(x=>x.presetKey==='AIGC_CONTENT_STANDARD'));

r=await request('GET','/api/runtime/project-subtypes?projectTypeKey=PRODUCT_DEVELOPMENT');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,9);
assert.ok(r.body.data.some(x=>x.subtypeKey==='AI_APPLICATION'));

r=await request('GET','/api/runtime/project-subtypes?projectTypeKey=AIGC_CONTENT');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,7);
assert.ok(r.body.data.some(x=>x.subtypeKey==='SHORT_DRAMA'));

r=await request('GET','/api/runtime/domain-presets/PRODUCT_DEVELOPMENT_STANDARD/readiness');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.ready,false);
assert.ok(r.body.data.missingRequiredCount>0);

r=await request('POST','/api/runtime/domain-presets/PRODUCT_DEVELOPMENT_STANDARD/compile',{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCKED');
assert.equal(r.body.data.workflowTemplateId,null);

// Register one policy-routable model that supports every cognitive task used by both standard domain presets.
const providerKey=`m256-provider-${suffix}`;
const modelKey='test-model';
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M25.6 Standard Model Provider',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',supportsStructuredOutput:true,priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
const taskTypes=[
  'PROJECT_INITIALIZATION','PRODUCT_DISCOVERY','PRODUCT_PRIORITIZATION','PRODUCT_GOAL_DEFINITION',
  'PRODUCT_DEFINITION','TECHNICAL_FEASIBILITY','DELIVERY_PLANNING','PRODUCT_DESIGN',
  'TECHNICAL_CONTRACT','PRODUCT_ACCEPTANCE','RELEASE_READINESS','PROJECT_REVIEW',
  'KNOWLEDGE_SYNTHESIS','AIGC_PROJECT_INITIALIZATION','AIGC_DISCOVERY','AIGC_PLANNING',
  'SCRIPT_CONTINUITY','SHOT_BREAKDOWN','AIGC_FORMAT_STRATEGY','CONTENT_DERIVATION','AIGC_REVIEW'
];
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M25.6 Standard Model',qualityTier:'HIGH',latencyTier:'FAST',
  costTier:'LOW',priority:1,capabilities:{taskTypes,structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey,currency:'USD',inputRatePerMillion:10,outputRatePerMillion:10,
  effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M25_6_MOCK'
});
assert.equal(r.status,201,JSON.stringify(r.body));

const taggedCapabilities=[
  ['TOOL',`TOOL:M256:DESIGN:${suffix}`,'DESIGN'],
  ['TOOL',`TOOL:M256:CODE:${suffix}`,'CODE_EXECUTION'],
  ['MCP',`MCP:M256:SOURCE:${suffix}`,'SOURCE_CONTROL'],
  ['TOOL',`TOOL:M256:BUILD:${suffix}`,'BUILD_DEPLOY'],
  ['TOOL',`TOOL:M256:TEST:${suffix}`,'TESTING'],
  ['TOOL',`TOOL:M256:DEPLOY:${suffix}`,'DEPLOYMENT'],
  ['TOOL',`TOOL:M256:OBS:${suffix}`,'OBSERVABILITY'],
  ['TOOL',`TOOL:M256:DATA:${suffix}`,'DATA_ANALYTICS'],
  ['TOOL',`TOOL:M256:ASSET:${suffix}`,'ASSET_GENERATION'],
  ['TOOL',`TOOL:M256:IMAGE:${suffix}`,'IMAGE_GENERATION'],
  ['TOOL',`TOOL:M256:VIDEO:${suffix}`,'VIDEO_GENERATION'],
  ['TOOL',`TOOL:M256:AUDIO:${suffix}`,'AUDIO_GENERATION'],
  ['TOOL',`TOOL:M256:EDIT:${suffix}`,'MEDIA_EDITING'],
  ['TOOL',`TOOL:M256:QA:${suffix}`,'MEDIA_QA'],
  ['MCP',`MCP:M256:PUBLISH:${suffix}`,'PUBLISHING']
];
for(const [capabilityType,capabilityKey,domainCapability] of taggedCapabilities){
  r=await request('POST','/api/runtime/capabilities',{
    capabilityKey,capabilityType,displayName:`M25.6 ${domainCapability}`,
    adapterKey:'internal-test',policyTags:{domainCapability}
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

for(const presetKey of ['PRODUCT_DEVELOPMENT_STANDARD','AIGC_CONTENT_STANDARD']){
  r=await request('GET',`/api/runtime/domain-presets/${presetKey}/readiness`);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.data.ready,true,JSON.stringify(r.body.data));
  assert.equal(r.body.data.missingRequiredCount,0);

  r=await request('POST',`/api/runtime/domain-presets/${presetKey}/compile`,{});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.data.status,'FROZEN',JSON.stringify(r.body.data));
  assert.ok(r.body.data.workflowTemplateId);
  assert.match(r.body.data.definitionSha256,/^[a-f0-9]{64}$/);
}

const productCompiled=(await request(
  'POST','/api/runtime/domain-presets/PRODUCT_DEVELOPMENT_STANDARD/compile',{}
)).body.data;
assert.equal(productCompiled.idempotent,true);
const productWorkflowId=productCompiled.workflowTemplateId;

const aigcCompiled=(await request(
  'POST','/api/runtime/domain-presets/AIGC_CONTENT_STANDARD/compile',{}
)).body.data;
assert.equal(aigcCompiled.idempotent,true);
const aigcWorkflowId=aigcCompiled.workflowTemplateId;

r=await request('GET',`/api/runtime/workflow-templates/${productWorkflowId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
const pd=r.body.data;
assert.equal(pd.status,'FROZEN');
assert.equal(pd.milestones.length,9);
assert.equal(pd.stages.length,19);
assert.equal(pd.stages[0].stageKey,'PD_00_INIT');
assert.equal(pd.stages[18].stageKey,'PD_18_KNOWLEDGE');
assert.equal(pd.stages[0].gatePolicyKey,'G-PD-INIT');
assert.equal(pd.stages[11].gatePolicyKey,'G-PD-ACCEPTANCE');
assert.equal(pd.stages[12].gatePolicyKey,'G-PD-QA');
assert.equal(pd.stages[14].gatePolicyKey,'G-PD-RELEASE');
assert.equal(pd.stages[0].config.humanGateRequired,true);
assert.equal(pd.stages[8].stageKey,'PD_08_CONTRACT');
assert.equal(pd.stages[9].stageKey,'PD_09_ENGINEERING');
assert.equal(pd.stages[9].requirements.some(x=>x.capabilityType==='MCP'),true);
assert.equal(pd.stages[18].knowledgePolicies.some(x=>x.writebackMode==='PROPOSE'),true);

r=await request('GET',`/api/runtime/workflow-templates/${aigcWorkflowId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
const aigc=r.body.data;
assert.equal(aigc.status,'FROZEN');
assert.equal(aigc.milestones.length,10);
assert.equal(aigc.stages.length,15);
assert.equal(aigc.stages[0].stageKey,'AIGC_00_INIT');
assert.equal(aigc.stages[14].stageKey,'AIGC_14_REVIEW');
assert.equal(aigc.stages[3].gatePolicyKey,'G-AIGC-SCRIPT');
assert.equal(aigc.stages[10].gatePolicyKey,'G-AIGC-MASTER');
assert.deepEqual(
  aigc.stages[10].config.subGates,
  ['G-AIGC-CREATIVE-ACCEPTANCE','G-AIGC-PRODUCTION-QA','G-AIGC-TECHNICAL-QA','G-AIGC-COMPLIANCE','G-AIGC-LOCALIZATION-QA']
);
assert.equal(aigc.stages[12].config.humanGateRequired,true);
assert.equal(aigc.stages[7].requirements[0].constraints.requiredPolicyTags.domainCapability,'IMAGE_GENERATION');
assert.ok(aigc.stages[14].knowledgePolicies.some(x=>x.writebackMode==='PROPOSE'));

// Create projects directly from standard presets + validated subtypes.
r=await request('POST','/api/runtime/projects',{
  projectKey:`m256-pd-${suffix}`,name:'M25.6 Product Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'AI_APPLICATION',
  domainPresetKey:'PRODUCT_DEVELOPMENT_STANDARD'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productProjectId=r.body.data.id;
assert.equal(r.body.data.projectSubtypeKey,'AI_APPLICATION');
assert.equal(r.body.data.lifecycle.template.id,productWorkflowId);
assert.equal(r.body.data.lifecycle.project.projectSubtypeKey,'AI_APPLICATION');
assert.equal(r.body.data.lifecycle.project.currentStageKey,'PD_00_INIT');
assert.equal(r.body.data.lifecycle.stages.length,19);

r=await request('POST','/api/runtime/projects',{
  projectKey:`m256-aigc-${suffix}`,name:'M25.6 AIGC Project',
  projectType:'AIGC_CONTENT',projectSubtypeKey:'SHORT_DRAMA',
  domainPresetKey:'AIGC_CONTENT_STANDARD'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const aigcProjectId=r.body.data.id;
assert.equal(r.body.data.projectSubtypeKey,'SHORT_DRAMA');
assert.equal(r.body.data.lifecycle.template.id,aigcWorkflowId);
assert.equal(r.body.data.lifecycle.stages.length,15);

r=await request('POST','/api/runtime/projects',{
  projectKey:`m256-bad-subtype-${suffix}`,name:'Bad subtype',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SHORT_DRAMA'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_SUBTYPE_MISMATCH');

// Bind a project-specific Library source to the reusable PROJECT_CURRENT logical domain.
const sourceKey=`m256-library-${suffix}`;
r=await request('POST','/api/runtime/knowledge/sources',{
  sourceKey,provider:'chatgpt_library',sourceType:'LIBRARY',transportMode:'CHATGPT_TOOL',
  rootScope:`/M25.6/${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/projects/${productProjectId}/knowledge-bindings`,{
  bindingKey:'PROJECT_CURRENT',sourceKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.bindingKey,'PROJECT_CURRENT');
assert.equal(r.body.data.sourceKey,sourceKey);
r=await request('GET',`/api/runtime/projects/${productProjectId}/knowledge-bindings`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);

// Stage 00 is executable but must stop at the declared human gate.
const sourceSentinel='M256_PRIVATE_PROJECT_SOURCE';
const outputSchema={
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
r=await request('POST',`/api/runtime/projects/${productProjectId}/orchestrations`,{
  idempotencyKey:`m256-human-gate-${suffix}`,
  maxStageTransitions:5,
  stageInputs:{
    PD_00_INIT:{
      PRIMARY_MODEL:{
        instructions:'Validate project initialization readiness from the supplied context.',
        input:'Validate readiness.',
        schema:outputSchema,
        schemaName:'project_initialization_readiness'
      }
    }
  },
  knowledgePackets:{
    PD_00_INIT:{
      PROJECT_CURRENT:{
        items:[{
          sourceFileId:`file-${suffix}`,
          sourceLibraryFileId:`lib-${suffix}`,
          sourceVersion:'v1',
          sourcePath:`/M25.6/${suffix}/project.md`,
          sourceStatus:'CURRENT',lineStart:1,lineEnd:2,
          sourceText:`Current project baseline. ${sourceSentinel}`
        }]
      }
    }
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));
const session=r.body.data;
assert.equal(session.status,'BLOCKED');
assert.equal(session.stageAttempts,1);
assert.equal(session.capabilityInvocationCount,1);
assert.equal(session.attempts[0].transitionType,'ESCALATE');
assert.equal(session.attempts[0].gateStatus,'HOLD');
assert.equal(session.attempts[0].decision.humanGateRequired,true);
assert.equal(session.attempts[0].knowledgeContextCount,1);
assert.ok(!JSON.stringify(session).includes(sourceSentinel));

r=await request('POST',`/api/runtime/projects/${productProjectId}/stage-transitions`,{
  runId:session.runId,
  taskId:session.attempts[0].taskId,
  stageKey:'PD_00_INIT',
  transitionType:'PASS',
  gateKey:'G-PD-INIT',
  gateStatus:'PASS',
  idempotencyKey:`m256-human-approved-${suffix}`,
  evidence:{humanApproval:true,approverRole:'PRODUCT_OWNER'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.toStageKey,'PD_01_DISCOVERY');

r=await request('GET',`/api/runtime/projects/${productProjectId}/lifecycle`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.currentStageKey,'PD_01_DISCOVERY');
assert.equal(r.body.data.milestones[0].status,'COMPLETED');
assert.equal(r.body.data.milestones[1].status,'ACTIVE');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[presetCount]]=await db.execute(
  "SELECT COUNT(*) AS count FROM domain_workflow_presets WHERE status='ACTIVE'"
);
assert.equal(Number(presetCount.count),2);
const [[releaseCount]]=await db.execute(
  "SELECT COUNT(*) AS count FROM domain_workflow_releases WHERE status='FROZEN'"
);
assert.equal(Number(releaseCount.count),2);
const [[standardAgents]]=await db.execute(
  "SELECT COUNT(*) AS count FROM capability_registry WHERE capability_type='AGENT' AND JSON_EXTRACT(metadata_json,'$.standardDomainAgent')=true"
);
assert.ok(Number(standardAgents.count)>=20);
const [[bindingCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM project_knowledge_bindings WHERE project_id=? AND binding_key=?',
  [productProjectId,'PROJECT_CURRENT']
);
assert.equal(Number(bindingCount.count),1);
const [[sourceLeak]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM knowledge_contexts WHERE run_id=? AND CAST(context_role AS CHAR) LIKE ?) +
    (SELECT COUNT(*) FROM capability_invocations WHERE run_id=? AND (
      CAST(decision_json AS CHAR) LIKE ? OR CAST(output_evidence_json AS CHAR) LIKE ?
    )) AS count`,
  [session.runId,`%${sourceSentinel}%`,session.runId,`%${sourceSentinel}%`,`%${sourceSentinel}%`]
);
assert.equal(Number(sourceLeak.count),0);
await db.end();

console.log('G25_6_DOMAIN_WORKFLOW_TEMPLATES_PASS');
