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
assert.equal(pd.displayName,'产品研发标准工作流');
assert.equal(pd.milestones.length,9);
assert.equal(pd.stages.length,19);
assert.equal(pd.milestones[0].displayName,'项目就绪完成');
assert.equal(pd.milestones[2].displayName,'产品基线已批准');
assert.equal(pd.stages[0].displayName,'项目初始化 / 系统就绪');
assert.equal(pd.stages[1].displayName,'用户发现 / 证据 / 洞察 / 竞品情报');
assert.equal(pd.stages[7].displayName,'产品设计 / 原型 / 设计契约');
assert.equal(pd.stages[8].displayName,'技术 / API / 数据 / 集成 / 埋点契约');
assert.equal(pd.stages[0].stageKey,'PD_00_INIT');
assert.equal(pd.stages[18].stageKey,'PD_18_KNOWLEDGE');
assert.equal(pd.stages[0].gatePolicyKey,'G-PD-INIT');
assert.equal(pd.stages[11].gatePolicyKey,'G-PD-ACCEPTANCE');
assert.equal(pd.stages[12].gatePolicyKey,'G-PD-QA');
assert.equal(pd.stages[14].gatePolicyKey,'G-PD-RELEASE');
assert.equal(pd.stages[0].config.humanGateRequired,true);
assert.equal(pd.stages[8].stageKey,'PD_08_CONTRACT');
assert.deepEqual(pd.stages[8].config.specializedGates,[{
  gateKey:'G-PD-AI-CONTRACT',displayName:'AI 应用专项契约门禁',requiredForSubtypes:['AI_APPLICATION']
}]);
assert.equal(pd.stages[9].stageKey,'PD_09_ENGINEERING');
assert.equal(pd.stages[9].requirements.some(x=>x.capabilityType==='MCP'),true);
assert.equal(pd.stages[18].knowledgePolicies.some(x=>x.writebackMode==='PROPOSE'),true);

r=await request('GET','/api/runtime/project-types');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.projectTypeKey==='PRODUCT_DEVELOPMENT').displayName,'产品研发');

r=await request('GET','/api/runtime/project-subtypes?projectTypeKey=PRODUCT_DEVELOPMENT');
assert.equal(r.status,200,JSON.stringify(r.body));
const productSubtypeNames=Object.fromEntries(r.body.data.map(x=>[x.subtypeKey,x.displayName]));
assert.equal(productSubtypeNames.FRONTEND_PROTOTYPE,'前端原型');
assert.equal(productSubtypeNames.FULL_STACK_WEB,'全栈 Web 应用');
assert.equal(productSubtypeNames.MOBILE_APP,'移动应用');
assert.equal(productSubtypeNames.BACKEND_API_SERVICE,'后端 API 服务');
assert.equal(productSubtypeNames.SAAS_PLATFORM,'SaaS 平台');
assert.equal(productSubtypeNames.AI_APPLICATION,'AI 应用');
assert.equal(productSubtypeNames.DATA_PRODUCT,'数据产品');
assert.equal(productSubtypeNames.INTEGRATION_SDK,'集成 / SDK');
assert.equal(productSubtypeNames.INTERNAL_TOOL,'内部工具');

r=await request('GET','/api/runtime/capabilities?capabilityType=AGENT&status=ACTIVE');
assert.equal(r.status,200,JSON.stringify(r.body));
const productAgentNames=Object.fromEntries(
  r.body.data
    .filter(x=>x.capabilityKey.startsWith('AGENT:STANDARD:PRODUCT_DEVELOPMENT:'))
    .map(x=>[x.capabilityKey,x.displayName])
);
assert.equal(productAgentNames['AGENT:STANDARD:PRODUCT_DEVELOPMENT:PRODUCT'],'产品经理智能体');
assert.equal(productAgentNames['AGENT:STANDARD:PRODUCT_DEVELOPMENT:DESIGN'],'产品设计智能体');
assert.equal(productAgentNames['AGENT:STANDARD:PRODUCT_DEVELOPMENT:QA'],'质量验证智能体');

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

// Create an entitled tenant/workspace so MODEL stages pass through the existing commercial control plane.
const planKey=`M256_PLAN_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey,name:'M25.6 Domain Template Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'MODEL_EXECUTION',enabled:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m256-${suffix}`,name:'M25.6 Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'Main'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

// Create projects directly from standard presets + validated subtypes.
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m256-pd-${suffix}`,name:'M25.6 Product Project',
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
  workspaceId,projectKey:`m256-aigc-${suffix}`,name:'你好，那年夏天',
  projectType:'AIGC_CONTENT',projectSubtypeKey:'SHORT_DRAMA',
  domainPresetKey:'AIGC_CONTENT_STANDARD'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const aigcProjectId=r.body.data.id;
assert.equal(r.body.data.projectSubtypeKey,'SHORT_DRAMA');
assert.equal(r.body.data.lifecycle.template.id,aigcWorkflowId);
assert.equal(r.body.data.lifecycle.stages.length,15);

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m256-bad-subtype-${suffix}`,name:'Bad subtype',
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
        input:'SC049 hard lock. Validate readiness from the supplied project context.',
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
assert.equal(session.stageAttempts,1,JSON.stringify({
  sessionId:session.id,
  status:session.status,
  stageAttempts:session.stageAttempts,
  capabilityInvocationCount:session.capabilityInvocationCount,
  attempts:session.attempts
},null,2));
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

// M28.1: frontend display labels are Chinese while stable keys remain unchanged.
r=await request('GET','/api/runtime/domain-presets');
assert.equal(r.status,200,JSON.stringify(r.body));
const aigcPreset=r.body.data.find(x=>x.presetKey==='AIGC_CONTENT_STANDARD');
assert.equal(aigcPreset.displayName,'AIGC 内容生产标准工作流');
assert.ok(aigcPreset.spec.milestones.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));
assert.ok(aigcPreset.spec.stages.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));

r=await request('GET','/api/runtime/project-subtypes?projectTypeKey=AIGC_CONTENT');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,7);
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)),JSON.stringify(r.body.data));

r=await request('GET','/api/runtime/project-subtypes?projectTypeKey=PRODUCT_DEVELOPMENT');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)),JSON.stringify(r.body.data));

r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.length>=7);
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.length>=10);
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-INIT').displayName,'项目初始化门禁');
assert.equal(r.body.data.find(x=>x.stableKey==='PASS').displayName,'通过');

// The real AIGC validation sample uses the existing 你好，那年夏天 SHORT_DRAMA project.
r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-INIT/evaluate`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_INITIALIZATION_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-initializations`,{
  initializationKey:'LX-M281-INIT',
  workTitle:'你好，那年夏天',
  targetAudience:{primary:'中文情感叙事受众',secondary:['电影','剧集','短视频切片']},
  roles:{owner:'作者 / 产品负责人',creativeLead:'创作负责人',productionLead:'AIGC 制作负责人',reviewer:'最终审核人'},
  knowledgeSources:[
    {provider:'CHATGPT_LIBRARY',scope:'/你好那年夏天/',role:'PROJECT_CURRENT'},
    {provider:'CHATGPT_LIBRARY',scope:'/你好那年夏天/剧本/',role:'STORY_KNOWLEDGE'},
    {provider:'CHATGPT_LIBRARY',scope:'/你好那年夏天/视觉素材/',role:'VISUAL_KNOWLEDGE'}
  ],
  assetStorage:{projectLibrary:'/你好那年夏天/视觉素材/',workspaceReusable:'AIGC Workspace Library'},
  capabilityEnvironment:{
    models:['GPT'],tools:['Image Generation','Runway'],connections:['GitHub','ChatGPT Library'],
    credentialBoundary:'凭据只通过平台连接，不写入项目内容'
  },
  budgetGuardrail:{currency:'CNY',maxSpend:5000,policy:'超预算需人工审批'},
  timelineStrategy:{milestones:'AG-M0..AG-M9',targetRelease:'待真实制作排期确认'},
  rightsBoundary:{
    copyright:'原创剧本与原创资产为主',likeness:'角色为虚构人物',
    music:'原创 OST / 有权使用素材',font:'仅使用授权或系统字体',
    brand:'品牌露出需单独确认',aiDisclosure:'按发布平台要求披露'
  },
  formatDelivery:{
    masterFormat:{aspect:'1.85:1',type:'电影母版'},
    workingFormat:{type:'可重建中间工程'},
    deliveryFormats:['电影版','剧集版','平台切片']
  },
  backupArchive:{backup:'项目资产持续备份',export:'保留最终母版与可重建清单',archive:'按版本冻结'},
  evidence:{source:'你好那年夏天 CURRENT 基线'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const aigcInitializationId=r.body.data.id;
assert.equal(r.body.data.workTitle,'你好，那年夏天');

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-INIT/evaluate`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-DISCOVERY/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_MARKET_BENCHMARK_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-market-benchmarks`,{
  benchmarkKey:'LX-MARKET-20261007',
  platform:'多平台',
  marketRegion:'中国大陆 / 海外候选',
  categoryFormat:'情感叙事 / 电影 / 剧集 / 短视频切片',
  workCreatorAccount:{scope:'同类情感叙事内容与平台发行样本'},
  publishDate:'2026-10-01',snapshotDate:'2026-10-07',freshUntil:'2026-11-07',
  observablePerformance:{dimensions:['播放','互动','完播','收藏','评论情绪']},
  releaseCadence:{hypothesis:'完整版与切片组合分发'},
  audiencePositioning:{audience:'真实感情与成长叙事受众'},
  structureHook:{principle:'不用狗血误会，以真实关系细节与情绪记忆形成留存'},
  sourceEvidence:{type:'DATED_RESEARCH_SNAPSHOT',asOf:'2026-10-07'},
  insight:{statement:'真实关系细节与可独立传播的情绪片段需要同时保留'},
  limitation:{statement:'平台表现会随时间变化，不能固化为永久事实'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const marketBenchmarkId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-creative-references`,{
  referenceKey:'LX-CREATIVE-REF-1',
  source:{type:'CREATIVE_REFERENCE_SET',description:'台湾电影感、真实情感叙事与生活质感参考'},
  rightsStatus:'LIMITED',
  referenceRoles:['STYLE','COMPOSITION','EDITING_RHYTHM','PERFORMANCE'],
  allowedUsage:{scope:'仅用于抽象风格、镜头语言与节奏研究'},
  forbiddenCopying:{rules:['不得复制具体镜头','不得复制角色形象','不得复制对白与受版权保护表达']},
  attributionProvenance:{sourceRecorded:true,usageBoundaryRecorded:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const creativeReferenceId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-model-tool-benchmarks`,{
  benchmarkKey:'LX-MODEL-TOOL-20261007',
  provider:'多提供商评测',
  modelTool:'图像 / 视频生成工具组合',
  modelToolVersion:'2026-10-07-current-snapshot',
  capability:{identityConsistency:true,sceneReference:true,imageToVideo:true},
  supportedReferenceTypes:['IDENTITY','LOOK','SCENE','COMPOSITION','FIRST_FRAME','MOTION'],
  outputLimits:{resolution:'按提供商当前能力',duration:'按镜头策略分段'},
  controllability:{identity:'需母版锁定',motion:'需镜头级验证'},
  apiBatchQueue:{batch:true,queue:true},
  costLatencyReliability:{cost:'记录到 Generation Job',latency:'记录实测',reliability:'按模型版本评测'},
  rightsTermsDisclosure:{termsReviewed:true,aiDisclosure:'按平台与提供商要求'},
  evalDate:'2026-10-07',freshUntil:'2026-11-07',
  evidence:{type:'MODEL_TOOL_CAPABILITY_SNAPSHOT'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const modelToolBenchmarkId=r.body.data.id;

// Creative hypotheses may inform production/distribution, but may never rewrite Story Fact.
r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-creative-hypotheses`,{
  hypothesisKey:'LX-HYP-BAD-STORY',
  hypothesisType:'FORMAT',
  statement:'错误示例：为了平台表现直接改写人物硬事实',
  benchmarkIds:[marketBenchmarkId],creativeReferenceIds:[creativeReferenceId],
  modelToolBenchmarkIds:[modelToolBenchmarkId],unknowns:['未验证'],
  confidence:'LOW',storyFactMutation:true,
  decision:{status:'REJECT'},evidence:{test:'story-fact-protection'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_HYPOTHESIS_STORY_FACT_MUTATION_FORBIDDEN');

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-creative-hypotheses`,{
  hypothesisKey:'LX-HYP-FORMAT-1',
  hypothesisType:'FORMAT',
  statement:'保持故事事实不变，以电影母版为主并派生剧集与短视频分发版本',
  benchmarkIds:[marketBenchmarkId],creativeReferenceIds:[creativeReferenceId],
  modelToolBenchmarkIds:[modelToolBenchmarkId],
  unknowns:['不同平台切片的最佳长度需后续 Performance 验证'],
  confidence:'MEDIUM',storyFactMutation:false,
  decision:{status:'APPROVED',owner:'创作负责人'},
  evidence:{source:'M28.1 Discovery'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const creativeHypothesisId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-DISCOVERY/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Freshness is evaluated as-of; dated benchmark facts do not become permanent truth.
r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-DISCOVERY/evaluate`,{asOf:'2026-12-01T00:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_MARKET_BENCHMARK_STALE'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_MODEL_TOOL_BENCHMARK_STALE'));

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-PLAN/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_PRODUCTION_PLAN_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-production-plans`,{
  planKey:'LX-M281-PLAN',
  projectHierarchy:{project:'你好，那年夏天',version:'CURRENT',unit:'电影 / 剧集 / 切片',scene:'001—071',shot:'镜头级对象'},
  milestoneKeys:['AG-M0','AG-M1','AG-M2','AG-M3','AG-M4','AG-M5','AG-M6','AG-M7','AG-M8','AG-M9'],
  workBreakdown:{stages:['故事','资产','图像','视频音频','剪辑','母版','分发','表现','复盘']},
  productionOrder:{principle:'先母版与门禁，后镜头级生产；已 PASS 上游不重跑'},
  dependency:{critical:['Script Lock→Shot/Asset Coverage→Call Sheet→Generation→Timeline→Master']},
  assetCoveragePlan:{source:'001—071 全剧资产覆盖矩阵',blockedPolicy:'缺失资产自动 BLOCK'},
  modelToolStrategy:{router:'按 Reference 能力、质量、成本、时延选择，不追模型热度'},
  budgetAllocation:{currency:'CNY',total:5000,byStage:{asset:1000,image:1000,video:2500,audio:500}},
  batchQueueConcurrency:{batch:true,queue:true,concurrency:'按成本与依赖门禁'},
  humanReviewPoints:{required:['Script Lock','Asset Select','Master QA','Publish']},
  versionStrategy:{master:'电影母版优先',derivatives:['剧集版','短视频切片'],history:'不可覆盖历史候选'},
  localizationCandidates:{status:'CANDIDATE',markets:['中文主版本','海外候选']},
  evidence:{source:'M28.1 Production Strategy'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productionPlanId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${aigcProjectId}/aigc-gates/G-AIGC-PLAN/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

r=await request('GET',`/api/runtime/projects/${aigcProjectId}/aigc-foundation`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.name,'你好，那年夏天');
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.milestones.length,10);
assert.equal(r.body.data.frontend.stages.length,15);
assert.ok(r.body.data.frontend.milestones.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));
assert.ok(r.body.data.frontend.stages.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));
assert.equal(r.body.data.initializations[0].id,aigcInitializationId);
assert.equal(r.body.data.creativeHypotheses[0].id,creativeHypothesisId);
assert.equal(r.body.data.productionPlans[0].id,productionPlanId);
assert.equal(r.body.data.traces.length,4);

const [[m281Truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_trace_links WHERE project_id=? AND target_type='CREATIVE_HYPOTHESIS' AND target_id=?) hypothesis_inputs,
    (SELECT COUNT(*) FROM aigc_trace_links WHERE project_id=? AND source_type='CREATIVE_HYPOTHESIS' AND source_id=? AND target_type='PRODUCTION_PLAN' AND target_id=?) hypothesis_plan,
    (SELECT COUNT(*) FROM project_stage_instances WHERE project_id=? AND display_name REGEXP '[一-龥]') chinese_stages,
    (SELECT COUNT(*) FROM project_milestones WHERE project_id=? AND display_name REGEXP '[一-龥]') chinese_milestones`,
  [aigcProjectId,creativeHypothesisId,
   aigcProjectId,creativeHypothesisId,productionPlanId,
   aigcProjectId,aigcProjectId]
);
assert.equal(Number(m281Truth.hypothesis_inputs),3);
assert.equal(Number(m281Truth.hypothesis_plan),1);
assert.equal(Number(m281Truth.chinese_stages),15);
assert.equal(Number(m281Truth.chinese_milestones),10);

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

console.log('Runtime V2.8 M28.1 AIGC foundation + Chinese frontend labels validation passed');
