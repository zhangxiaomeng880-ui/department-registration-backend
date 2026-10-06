import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value)),
  'utf8'
).digest('hex');
const asJson=value=>value==null?null:JSON.stringify(value);
const agentKey=role=>'AGENT:BUILTIN:'+String(role).toUpperCase()
  .replace(/\+/g,' PLUS ')
  .replace(/&/g,' AND ')
  .replace(/[^A-Z0-9]+/g,'_')
  .replace(/^_+|_+$/g,'');

const req=(key,capabilityType,purpose,requirementMode='REQUIRED',traits=[])=>({
  requirementKey:key,capabilityType,routingMode:'DEFERRED',requirementMode,
  priority:requirementMode==='REQUIRED'?10:50,
  constraints:{contractKey:key,purpose,requiredTraits:traits,realization:'M27_M28'}
});
const gate=(gateKey,gateRole='PRIMARY',required=true,sequenceNo=1,appliesWhen=null,contract=null)=>({
  gateKey,gateRole,required,aggregationMode:'ALL_REQUIRED_PASS',sequenceNo,appliesWhen,contract
});
const kp=(policyKey,sourceKey,queryTemplate,contextRole='PROJECT_CONTEXT',required=true,writebackMode='NONE',writebackTargetPath=null)=>({
  policyKey,sourceKey,queryTemplate,contextRole,required,maxItems:12,
  allowedStatuses:['CURRENT','FACT','RULE','FINAL'],
  injectionMode:'APPEND_CONTEXT',writebackMode,writebackTargetPath
});
const stage=(stageKey,displayName,sequenceNo,primary,supporting,gates,requirements,knowledgePolicies=[],config={})=>({
  stageKey,displayName,sequenceNo,stageType:'EXECUTION',
  primaryAgentRole:primary,supportingAgentRoles:supporting,
  defaultGateKey:gates.find(x=>x.gateRole==='AGGREGATE')?.gateKey||gates.find(x=>x.required)?.gateKey||null,
  gateContracts:gates,requirements,knowledgePolicies,
  config:{
    maxRetries:1,onFailure:'RETRY',onRetryExhausted:'ESCALATE',
    specOnly:true,milestoneBinding:'DECOUPLED_PENDING_M26',...config
  }
});

export const PRODUCT_DEVELOPMENT_DOMAIN_SPEC={
  projectTypeKey:'PRODUCT_DEVELOPMENT',
  templateKey:'product-development-standard',
  version:'1.2.0',
  displayName:'Product Development Standard Workflow V1.2',
  sourceSpecKey:'AI_Native_2.0_产品研发工作流',
  sourceSpecVersion:'V1.2_CURRENT',
  sourceSpec:{
    path:'/AI_Native_Project/AI_NATIVE_2.0/knowledge/Product_Development/AI_Native_2.0_产品研发工作流_V1.2_CURRENT.md',
    fileId:'file_00000000225081fda8fc1ef483a39042',
    libraryFileId:'libfile_15132c5414ac8191b90c54363ea57e12',
    architectureBaseline:'AI_NATIVE_2.0_MASTER_BLUEPRINT_V1.4_FROZEN'
  },
  subtypeProfiles:[
    'FRONTEND_PROTOTYPE','FULL_STACK_WEB','MOBILE_APP','BACKEND_API_SERVICE',
    'SAAS_PLATFORM','AI_APPLICATION','DATA_PRODUCT','INTEGRATION_SDK','INTERNAL_TOOL'
  ],
  lifecycleContract:'Why → What → How → Build → Verify → Release → Outcome → Learn',
  stageContract:'Input → Readiness → Input Verification → Plan → Execute → Output → Output Verification → Gate → Approval(optional) → Handoff → State Update → Checkpoint',
  milestoneStageBinding:'DECOUPLED_PENDING_M26',
  milestones:[
    ['PD-M0','Readiness Complete'],
    ['PD-M1','Problem / Opportunity Validated'],
    ['PD-M2','Product Baseline Approved'],
    ['PD-M3','Design + Technical Contract Locked'],
    ['PD-M4','Feature Complete / Preview Ready'],
    ['PD-M5','Acceptance + QA PASS'],
    ['PD-M6','Release Candidate Ready'],
    ['PD-M7','Production Verified'],
    ['PD-M8','Outcome Reviewed / Version Closed']
  ].map(([milestoneKey,displayName],index)=>({
    milestoneKey,displayName,sequenceNo:index+1,
    acceptance:{mode:'OUTCOME_CONTRACT',completion:'M26_MILESTONE_GOVERNANCE'},
    metadata:{stageIndependent:true,source:'Product Development V1.2 CURRENT'}
  })),
  stages:[
    stage('PD-00-INIT','Project Initialization / System Readiness',0,
      'Project Initialization',['Environment','Security'],
      [gate('G-PD-INIT')],
      [req('SYSTEM_READINESS','SKILL','Validate project/system readiness'),
       req('ENVIRONMENT_CONNECTIONS','CONNECTOR','Resolve environment/repository/design/data connections','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current project baseline, roles, policies and readiness constraints.')]),
    stage('PD-01-DISCOVERY','Discovery / Evidence / Insight / Competitor Intelligence',1,
      'Product / Research',['Data','Operations'],
      [gate('G-PD-DISCOVERY')],
      [req('RESEARCH_SYNTHESIS','SKILL','Synthesize evidence, insight and competitor intelligence'),
       req('EVIDENCE_SOURCES','CONNECTOR','Retrieve external/customer/data evidence with provenance','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current product/project facts and decisions.'),
       kp('RESEARCH_CURRENT','PRODUCT_RESEARCH_KB','Retrieve current research, evidence and competitor snapshots.','EVIDENCE',false)]),
    stage('PD-02-PRIORITY','Opportunity / Hypothesis / Prioritization',2,
      'Product',['Research','Data','Project'],
      [gate('G-PD-PRIORITY')],
      [req('PRIORITIZATION','SKILL','Evaluate opportunity, hypothesis and prioritization evidence')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current goals, constraints and discovery evidence.')],
      {humanGateRequired:true}),
    stage('PD-03-GOAL','Goal / Success Criteria / Product Bet',3,
      'Product',['Research','Data'],
      [gate('G-PD-GOAL')],
      [req('PRODUCT_GOAL_DEFINITION','SKILL','Define product goal, success and guardrail criteria')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current opportunity, decision and metric context.')]),
    stage('PD-04-PRODUCT','Product Definition / Requirement Baseline',4,
      'Product',['Research','Data'],
      [gate('G-PD-PRODUCT')],
      [req('PRODUCT_DEFINITION','SKILL','Create and validate versioned product requirement baseline')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current evidence, goal, rules and requirement baseline.')],
      {humanGateRequired:true,baselineLock:true}),
    stage('PD-05-FEASIBILITY','Feasibility / Risk / Architecture',5,
      'Feasibility',['Engineering','Security','Compliance'],
      [gate('G-PD-FEASIBILITY')],
      [req('FEASIBILITY_ARCHITECTURE','SKILL','Validate architecture, data, security, deployment, cost and risk'),
       req('SECURITY_ANALYSIS','TOOL','Execute applicable security/dependency analysis','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve frozen product baseline and current risks.'),
       kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve current architecture, platform and integration constraints.','TECHNICAL_CONTEXT',false)],
      {humanGateRequired:true}),
    stage('PD-06-PLAN','Delivery Planning / Milestone / Release Plan',6,
      'Product / Project',['Engineering','Design','QA'],
      [gate('G-PD-PLAN')],
      [req('DELIVERY_PLANNING','SKILL','Plan work items, dependency, capacity, milestone and release')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current baseline, dependencies and target release.')]),
    stage('PD-07-DESIGN','Design / Prototype / Design Contract',7,
      'Design',['Product'],
      [gate('G-PD-DESIGN')],
      [req('DESIGN_CONTRACT','SKILL','Produce verifiable design/prototype contract'),
       req('DESIGN_SOURCE','CONNECTOR','Access authoritative design source such as Figma','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve requirements, acceptance criteria and product decisions.'),
       kp('DESIGN_CURRENT','PRODUCT_DESIGN_KB','Retrieve current design system and design decisions.','DESIGN_CONTEXT',false)]),
    stage('PD-08-CONTRACT','Technical / API / Data / Integration / Instrumentation Contract',8,
      'Engineering / Data',['Product','Security','AI Product / Eval'],
      [
        gate('G-PD-CONTRACT'),
        gate('G-PD-AI-CONTRACT','CONDITIONAL_SUB_GATE',true,2,{subtype:'AI_APPLICATION'},
          {covers:['Model','Prompt','RAG','Agent','Tool','Eval','Safety','Prompt Injection','Fallback','Human Escalation']})
      ],
      [req('TECHNICAL_CONTRACT','SKILL','Define technical, API, data, integration and instrumentation contracts'),
       req('EXTERNAL_INTEGRATION','CONNECTOR','Validate external API/SDK/MCP integration contract','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve frozen product/design baseline.'),
       kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve current architecture, API, data and integration constraints.','TECHNICAL_CONTEXT',true)]),
    stage('PD-09-ENGINEERING','Engineering / Implementation',9,
      'Engineering / Coding',['Product','Design'],
      [],
      [req('ENGINEERING_IMPLEMENTATION','SKILL','Implement against frozen product/design/technical contracts'),
       req('SOURCE_CONTROL','MCP','Access source control, PR and commit operations','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve current frozen requirements and acceptance criteria.'),
       kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve exact technical contract and implementation constraints.','TECHNICAL_CONTEXT',true)]),
    stage('PD-10-PREVIEW','Build / Integration / Preview',10,
      'Preview / Release Engineering',['Engineering'],
      [gate('G-PD-ENGINEERING')],
      [req('BUILD_PREVIEW','TOOL','Build, integrate and create exact preview artifact'),
       req('CI_CD','MCP','Run CI/build/deployment workflow','OPTIONAL')],
      [kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve build, environment, migration and deployment contract.','TECHNICAL_CONTEXT',true)]),
    stage('PD-11-ACCEPTANCE','Product Acceptance',11,
      'Acceptance',['Product','Design'],
      [gate('G-PD-ACCEPTANCE')],
      [req('PRODUCT_ACCEPTANCE','SKILL','Validate exact preview against product acceptance matrix')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve frozen product requirement and acceptance baseline.')]),
    stage('PD-12-QA','QA / Non-functional / Security Validation',12,
      'QA',['Engineering','Security','Eval'],
      [gate('G-PD-QA')],
      [req('QA_VALIDATION','SKILL','Execute functional, regression, non-functional and security validation'),
       req('TEST_EXECUTION','TOOL','Execute automated test/eval suites','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve requirement/acceptance and known-risk context.'),
       kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve technical, security and quality contracts.','TECHNICAL_CONTEXT',true)]),
    stage('PD-13-RELEASE-READY','Release Readiness / Version Freeze',13,
      'Release',['QA','Product','Compliance'],
      [gate('G-PD-RELEASE-READY')],
      [req('RELEASE_READINESS','SKILL','Freeze exact release candidate and evidence manifest')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve product/release scope and approvals.'),
       kp('TECH_CURRENT','PRODUCT_TECH_KB','Retrieve exact commit, artifact, config, migration and rollback evidence.','TECHNICAL_CONTEXT',true)],
      {humanGateRequired:true}),
    stage('PD-14-RELEASE','Release / Rollout',14,
      'Release',['Engineering','Operations'],
      [gate('G-PD-RELEASE')],
      [req('RELEASE_DEPLOYMENT','CONNECTOR','Execute controlled release/rollout against approved target')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve approved release manifest and rollout policy.')],
      {humanGateRequired:true,externalSideEffect:true}),
    stage('PD-15-POST-RELEASE','Post-release Verification / Incident Operations',15,
      'Operations / Release',['Engineering','Data'],
      [],
      [req('POST_RELEASE_VERIFICATION','TOOL','Verify health, critical flow, instrumentation and incident signals'),
       req('OBSERVABILITY_SOURCE','CONNECTOR','Read production observability/incident source','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve release manifest, rollback target and success criteria.')]),
    stage('PD-16-OUTCOME','Data / Experiment / Feedback',16,
      'Data Analysis / Experiment',['Product'],
      [gate('G-PD-OUTCOME')],
      [req('DATA_ANALYSIS','TOOL','Analyze product metric, experiment and feedback evidence'),
       req('ANALYTICS_SOURCE','CONNECTOR','Read authoritative analytics/feedback sources','OPTIONAL')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve goals, primary/guardrail metrics and experiment hypotheses.'),
       kp('DATA_CURRENT','PRODUCT_DATA_KB','Retrieve current metric semantics and instrumentation contract.','DATA_CONTEXT',true)],
      {humanGateRequired:true}),
    stage('PD-17-REVIEW','Decision / Review',17,
      'Review',['Product','Engineering','QA','Data'],
      [],
      [req('REVIEW_DECISION','SKILL','Review planned vs actual, evidence, outcome and failure modes')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve complete release/outcome evidence and prior decisions.')]),
    stage('PD-18-KNOWLEDGE','Knowledge / Backlog / Next Version',18,
      'Knowledge Update',['Review','Product'],
      [gate('G-PD-REVIEW')],
      [req('KNOWLEDGE_UPDATE','SKILL','Convert reviewed evidence into governed knowledge/backlog/next-version proposals')],
      [kp('PROJECT_CURRENT','PRODUCT_PROJECT_KB','Retrieve review decisions and current knowledge baseline.',
        'PROJECT_CONTEXT',true,'PROPOSE','/Product_Development/Knowledge')],
      {humanGateRequired:true})
  ]
};

export const AIGC_DOMAIN_SPEC={
  projectTypeKey:'AIGC_CONTENT',
  templateKey:'aigc-content-production-standard',
  version:'2.4.0',
  displayName:'AIGC Content Production Standard Workflow V2.4',
  sourceSpecKey:'AI_Native_2.0_AIGC工作流升级说明',
  sourceSpecVersion:'V2.4_CURRENT',
  sourceSpec:{
    path:'/AI_Native_Project/AI_NATIVE_2.0/knowledge/AIGC_Content_Production/AI_Native_2.0_AIGC工作流升级说明_V2.4_CURRENT.md',
    fileId:'file_00000000cb008230b7e9df6ced6043cd',
    libraryFileId:'libfile_5eb0dc0887388191a335c2e4aa7ea241',
    architectureBaseline:'AI_NATIVE_2.0_MASTER_BLUEPRINT_V1.4_FROZEN'
  },
  subtypeProfiles:[
    'NARRATIVE_FILM','FEATURE','LIMITED_SERIES','SHORT_DRAMA','SERIAL_STORY',
    'SHORT_VIDEO','CREATOR_CONTENT','MUSIC','SONG','OST','MV','MUSIC_VIDEO',
    'AD','CAMPAIGN_CREATIVE','MULTIMODAL_CONTENT'
  ],
  knowledgeDomains:['Story','Visual','Audio','Production','Distribution','Performance','Rights / Compliance'],
  stageContract:'Input → Readiness → Preflight → Execute → Candidate/Output → Verification → Selection/Lock → Gate → Handoff → Checkpoint',
  milestoneStageBinding:'DECOUPLED_PENDING_M26',
  milestones:[
    ['AG-M0','Project / Rights / Environment Ready'],
    ['AG-M1','Creative Direction / Market Hypothesis Approved'],
    ['AG-M2','Story / Script / Structure Locked'],
    ['AG-M3','Master Asset System Ready'],
    ['AG-M4','Storyboard / Shot / Production Plan Ready'],
    ['AG-M5','Core Production Complete'],
    ['AG-M6','Edit / Picture / Audio Master Locked'],
    ['AG-M7','Distribution / Localization Package Ready'],
    ['AG-M8','Published / Distributed'],
    ['AG-M9','Performance Review / Knowledge Backwrite Complete']
  ].map(([milestoneKey,displayName],index)=>({
    milestoneKey,displayName,sequenceNo:index+1,
    acceptance:{mode:'OUTCOME_CONTRACT',completion:'M26_MILESTONE_GOVERNANCE'},
    metadata:{stageIndependent:true,source:'AIGC V2.4 CURRENT'}
  })),
  stages:[
    stage('AG-00-INIT','Project Initialization / Rights / Environment',0,
      'Project Initialization',['Rights','Security','Operations'],
      [gate('G-AIGC-INIT')],
      [req('AIGC_PROJECT_READINESS','SKILL','Validate AIGC project, rights, environment and delivery readiness'),
       req('AIGC_STORAGE_CONNECTIONS','CONNECTOR','Resolve project/workspace asset and delivery stores','OPTIONAL')],
      [kp('PROJECT_CURRENT','AIGC_PROJECT_KB','Retrieve current AIGC project baseline, rights, format and production constraints.')]),
    stage('AG-01-DISCOVERY','Discovery / Market / Creative Benchmark',1,
      'Creator Mining / Research',['Data','Content Strategy'],
      [gate('G-AIGC-DISCOVERY')],
      [req('CREATIVE_RESEARCH','SKILL','Analyze market, creative references and model/tool benchmarks'),
       req('AIGC_EXTERNAL_RESEARCH','CONNECTOR','Retrieve external market/reference evidence with freshness','OPTIONAL')],
      [kp('PROJECT_CURRENT','AIGC_PROJECT_KB','Retrieve current creative goal and rights constraints.'),
       kp('DISTRIBUTION_CURRENT','AIGC_DISTRIBUTION_KB','Retrieve current market/platform/distribution knowledge.','DISTRIBUTION_CONTEXT',false)]),
    stage('AG-02-PLAN','Planning / Milestone / Budget / Production Strategy',2,
      'Content Strategy / Project',['Production','Operations'],
      [gate('G-AIGC-PLAN')],
      [req('CONTENT_PLANNING','SKILL','Plan creative production, dependencies, review points, budget and delivery')],
      [kp('PROJECT_CURRENT','AIGC_PROJECT_KB','Retrieve creative direction, project constraints and current budget guardrails.')]),
    stage('AG-03-SCRIPT','Story / Script / Structure',3,
      'Script',['Research','Review'],
      [gate('G-AIGC-SCRIPT')],
      [req('SCRIPT_DEVELOPMENT','SKILL','Develop and lock story/script/structure with change-impact rules')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve CURRENT/FACT/RULE story, character, relationship, timeline and script constraints.','STORY_CONTEXT',true)],
      {humanGateRequired:true,baselineLock:true}),
    stage('AG-04-BREAKDOWN','Breakdown / Shot / Production Planning',4,
      'Script / Production Planning',['Asset','Visual','Audio'],
      [gate('G-AIGC-BREAKDOWN')],
      [req('SHOT_BREAKDOWN','SKILL','Create shot/asset coverage and production readiness plan')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve frozen story/script and continuity constraints.','STORY_CONTEXT',true),
       kp('PRODUCTION_CURRENT','AIGC_PRODUCTION_KB','Retrieve current production rules and known failure modes.','PRODUCTION_CONTEXT',false)]),
    stage('AG-05-FORMAT','Visual Format / Audio / Distribution Strategy',5,
      'Content Strategy',['Visual','Audio','Operations'],
      [gate('G-AIGC-FORMAT')],
      [req('FORMAT_STRATEGY','SKILL','Define master visual/audio/distribution format and adaptation policy')],
      [kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve current visual/style/format rules.','VISUAL_CONTEXT',false),
       kp('AUDIO_CURRENT','AIGC_AUDIO_KB','Retrieve current audio/voice/music delivery rules.','AUDIO_CONTEXT',false),
       kp('DISTRIBUTION_CURRENT','AIGC_DISTRIBUTION_KB','Retrieve current platform/market format constraints.','DISTRIBUTION_CONTEXT',false)]),
    stage('AG-06-ASSET','Asset System / Master Creation',6,
      'Asset System',['Visual','Audio','Rights'],
      [gate('G-AIGC-ASSET')],
      [req('ASSET_SYSTEM','SKILL','Build governed identity/look/scene/prop/action/expression/audio/reference masters'),
       req('ASSET_PRODUCTION_TOOL','TOOL','Create or edit controlled reusable master assets','OPTIONAL')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve story facts that constrain assets.','STORY_CONTEXT',true),
       kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve current visual master and reference rules.','VISUAL_CONTEXT',true),
       kp('AUDIO_CURRENT','AIGC_AUDIO_KB','Retrieve current voice/audio master rules.','AUDIO_CONTEXT',false),
       kp('RIGHTS_CURRENT','AIGC_RIGHTS_KB','Retrieve current rights/license/likeness constraints.','RIGHTS_CONTEXT',true)]),
    stage('AG-07-IMAGE','Image / Keyframe / Storyboard Production',7,
      'Visual Production',['Asset','QA'],
      [gate('G-AIGC-IMAGE')],
      [req('IMAGE_GENERATION','MODEL','Generate controlled image/keyframe/storyboard outputs with real references'),
       req('IMAGE_EDIT_TOOL','TOOL','Perform controlled image edit/inpaint/composite','OPTIONAL')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve story/shot continuity facts.','STORY_CONTEXT',true),
       kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve locked identity/look/scene/action/expression/reference rules.','VISUAL_CONTEXT',true),
       kp('PRODUCTION_CURRENT','AIGC_PRODUCTION_KB','Retrieve image production QA/failure rules.','PRODUCTION_CONTEXT',true)]),
    stage('AG-08-PRODUCTION','Video / Motion / Dialogue / Music / SFX Production',8,
      'AIGC Production',['Visual','Audio','QA'],
      [gate('G-AIGC-PRODUCTION')],
      [req('VIDEO_AUDIO_GENERATION','MODEL','Generate controlled video/motion/dialogue/audio output'),
       req('VIDEO_AUDIO_TOOL','TOOL','Execute supporting video/audio generation/edit operations','OPTIONAL')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve shot/dialogue/performance continuity facts.','STORY_CONTEXT',true),
       kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve locked visual/keyframe/reference rules.','VISUAL_CONTEXT',true),
       kp('AUDIO_CURRENT','AIGC_AUDIO_KB','Retrieve voice/music/SFX masters and audio constraints.','AUDIO_CONTEXT',true),
       kp('PRODUCTION_CURRENT','AIGC_PRODUCTION_KB','Retrieve temporal production QA/failure rules.','PRODUCTION_CONTEXT',true)]),
    stage('AG-09-EDIT','Edit / Timeline / Composite / Post-production',9,
      'Editing',['Audio','Visual','QA'],
      [gate('G-AIGC-EDIT')],
      [req('EDIT_TIMELINE','TOOL','Edit timeline, tracks, composite, captions and post-production assets')],
      [kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve visual/edit continuity and style rules.','VISUAL_CONTEXT',true),
       kp('AUDIO_CURRENT','AIGC_AUDIO_KB','Retrieve audio mix and track rules.','AUDIO_CONTEXT',true),
       kp('PRODUCTION_CURRENT','AIGC_PRODUCTION_KB','Retrieve timeline/review/production constraints.','PRODUCTION_CONTEXT',true)]),
    stage('AG-10-MASTER','Mastering / Acceptance / QA / Compliance',10,
      'Acceptance + QA',['Review','Compliance','Rights'],
      [
        gate('G-AIGC-CREATIVE-ACCEPTANCE','SUB_GATE',true,1),
        gate('G-AIGC-PRODUCTION-QA','SUB_GATE',true,2),
        gate('G-AIGC-TECHNICAL-QA','SUB_GATE',true,3),
        gate('G-AIGC-COMPLIANCE','SUB_GATE',true,4),
        gate('G-AIGC-LOCALIZATION-QA','CONDITIONAL_SUB_GATE',true,5,{localizationEnabled:true}),
        gate('G-AIGC-MASTER','AGGREGATE',true,6,null,{requiresAllRequiredSubGatesPass:true})
      ],
      [req('MASTER_QA','SKILL','Run creative acceptance, production QA, technical QA and compliance matrix'),
       req('MEDIA_QA_TOOL','TOOL','Execute technical media validation','OPTIONAL')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve frozen story/script/creative intent.','STORY_CONTEXT',true),
       kp('VISUAL_CURRENT','AIGC_VISUAL_KB','Retrieve locked visual masters and continuity rules.','VISUAL_CONTEXT',true),
       kp('AUDIO_CURRENT','AIGC_AUDIO_KB','Retrieve locked audio/voice/music rules.','AUDIO_CONTEXT',true),
       kp('RIGHTS_CURRENT','AIGC_RIGHTS_KB','Retrieve current rights/license/disclosure/compliance rules.','RIGHTS_CONTEXT',true)],
      {humanGateRequired:true}),
    stage('AG-11-DERIVATION','Content Derivation / Localization / Platform Adaptation',11,
      'Operations / Content',['Localization','Editing'],
      [gate('G-AIGC-DISTRIBUTION-PACKAGE')],
      [req('CONTENT_DERIVATION','SKILL','Create governed derivatives/localization/platform variants'),
       req('LOCALIZATION_TOOL','TOOL','Execute translation/dub/recompose transformations','OPTIONAL')],
      [kp('STORY_CURRENT','AIGC_STORY_KB','Retrieve immutable mother-content facts and spoiler constraints.','STORY_CONTEXT',true),
       kp('DISTRIBUTION_CURRENT','AIGC_DISTRIBUTION_KB','Retrieve current platform/market/localization rules.','DISTRIBUTION_CONTEXT',true),
       kp('RIGHTS_CURRENT','AIGC_RIGHTS_KB','Retrieve regional rights and disclosure constraints.','RIGHTS_CONTEXT',true)]),
    stage('AG-12-PUBLISH','Release / Distribution / Publishing',12,
      'Operations / Release',['Compliance'],
      [gate('G-AIGC-PUBLISH')],
      [req('PUBLISHING_CONNECTOR','CONNECTOR','Publish/schedule approved distribution version to target channel')],
      [kp('DISTRIBUTION_CURRENT','AIGC_DISTRIBUTION_KB','Retrieve approved distribution package, channel and schedule rules.','DISTRIBUTION_CONTEXT',true),
       kp('RIGHTS_CURRENT','AIGC_RIGHTS_KB','Retrieve publish rights/disclosure/platform compliance rules.','RIGHTS_CONTEXT',true)],
      {humanGateRequired:true,externalSideEffect:true}),
    stage('AG-13-PERFORMANCE','Performance / Experiment / Feedback',13,
      'Data Analysis',['Operations','Content'],
      [gate('G-AIGC-PERFORMANCE')],
      [req('PERFORMANCE_ANALYSIS','TOOL','Analyze production and content performance evidence'),
       req('PLATFORM_ANALYTICS','CONNECTOR','Read authoritative platform performance source','OPTIONAL')],
      [kp('DISTRIBUTION_CURRENT','AIGC_DISTRIBUTION_KB','Retrieve distribution version and experiment context.','DISTRIBUTION_CONTEXT',true),
       kp('PERFORMANCE_CURRENT','AIGC_PERFORMANCE_KB','Retrieve metric semantics and previous performance baselines.','PERFORMANCE_CONTEXT',true)]),
    stage('AG-14-REVIEW','Review / Knowledge / Next Version',14,
      'Review + Knowledge Update',['All stages'],
      [gate('G-AIGC-REVIEW')],
      [req('AIGC_REVIEW_KNOWLEDGE','SKILL','Review production/performance evidence and propose governed next-version knowledge')],
      [
        kp('PROJECT_CURRENT','AIGC_PROJECT_KB','Retrieve project/version goal and complete execution evidence.'),
        kp('PRODUCTION_CURRENT','AIGC_PRODUCTION_KB','Retrieve production metrics, failures and model/tool evidence.','PRODUCTION_CONTEXT',true,'PROPOSE','/AIGC/Production'),
        kp('PERFORMANCE_CURRENT','AIGC_PERFORMANCE_KB','Retrieve distribution/performance evidence.','PERFORMANCE_CONTEXT',true,'PROPOSE','/AIGC/Performance')
      ],
      {humanGateRequired:true})
  ]
};

export const BUILTIN_DOMAIN_SPECS=[PRODUCT_DEVELOPMENT_DOMAIN_SPEC,AIGC_DOMAIN_SPEC];

const allAgentRoles=spec=>Array.from(new Set(spec.stages.flatMap(item=>[
  item.primaryAgentRole,...item.supportingAgentRoles
])));

const ensureAgent=async(conn,role,projectTypeKey)=>{
  const capabilityKey=agentKey(role);
  await conn.execute(
    `INSERT INTO capability_registry
      (capability_key,capability_type,display_name,version,status,routable,adapter_key,
       capabilities_json,policy_tags_json,metadata_json)
     VALUES (?,'AGENT',?,'domain-spec-v1','ACTIVE',FALSE,'agent-runtime',?,?,?)
     ON DUPLICATE KEY UPDATE
       display_name=VALUES(display_name),status='ACTIVE',routable=FALSE,
       adapter_key='agent-runtime',metadata_json=VALUES(metadata_json)`,
    [
      capabilityKey,role,
      asJson({orchestrationRole:true}),
      asJson({builtin:true,domainTemplate:true}),
      asJson({system:true,builtin:true,role,source:'M25.6_DOMAIN_SPEC'})
    ]
  );
  await conn.execute(
    `INSERT INTO agent_profiles
      (capability_key,role_key,policy_mode,knowledge_scope_json,config_json)
     VALUES (?,?, 'QUALITY_FIRST',?,?)
     ON DUPLICATE KEY UPDATE
       role_key=VALUES(role_key),policy_mode=VALUES(policy_mode),
       knowledge_scope_json=VALUES(knowledge_scope_json),config_json=VALUES(config_json)`,
    [
      capabilityKey,agentKey(role).replace('AGENT:BUILTIN:',''),
      asJson({projectTypes:[projectTypeKey]}),
      asJson({builtin:true,directInvocation:false})
    ]
  );
  await conn.execute(
    `INSERT INTO project_type_capability_bindings
      (project_type_key,capability_key,binding_mode,priority,constraints_json)
     VALUES (?,?,'ALLOWED',100,?)
     ON DUPLICATE KEY UPDATE
       binding_mode='ALLOWED',priority=100,constraints_json=VALUES(constraints_json)`,
    [projectTypeKey,capabilityKey,asJson({role:'STAGE_AGENT',builtin:true})]
  );
  return capabilityKey;
};

const ensureSpec=async(conn,spec)=>{
  const definitionSha256=sha256(spec);
  const [existing]=await conn.execute(
    `SELECT * FROM workflow_templates
      WHERE project_type_key=? AND template_key=? AND version=? LIMIT 1`,
    [spec.projectTypeKey,spec.templateKey,spec.version]
  );
  if(existing.length){
    const row=existing[0];
    if(row.status!=='SPEC_FROZEN'||row.execution_readiness!=='SPEC_ONLY'||
       row.definition_sha256!==definitionSha256){
      const error=new Error('Built-in domain workflow template drift detected');
      error.code='BUILTIN_DOMAIN_TEMPLATE_DRIFT';
      error.statusCode=500;
      error.details={
        projectTypeKey:spec.projectTypeKey,templateKey:spec.templateKey,version:spec.version,
        expectedSha256:definitionSha256,actualSha256:row.definition_sha256,
        status:row.status,executionReadiness:row.execution_readiness
      };
      throw error;
    }
    return {id:row.id,definitionSha256,created:false};
  }

  for(const role of allAgentRoles(spec)) await ensureAgent(conn,role,spec.projectTypeKey);

  const templateId=randomUUID();
  await conn.execute(
    `INSERT INTO workflow_templates
      (id,project_type_key,template_key,version,display_name,description,template_class,status,
       execution_readiness,source_spec_key,source_spec_version,definition_sha256,metadata_json,frozen_at)
     VALUES (?,?,?,?,?,?,'DOMAIN_STANDARD','SPEC_FROZEN','SPEC_ONLY',?,?,?,?,CURRENT_TIMESTAMP(6))`,
    [
      templateId,spec.projectTypeKey,spec.templateKey,spec.version,spec.displayName,
      'Built-in domain workflow specification. Execution is blocked until M26/M27/M28 realization.',
      spec.sourceSpecKey,spec.sourceSpecVersion,definitionSha256,
      asJson({
        sourceSpec:spec.sourceSpec,subtypeProfiles:spec.subtypeProfiles,
        knowledgeDomains:spec.knowledgeDomains||null,lifecycleContract:spec.lifecycleContract||null,
        stageContract:spec.stageContract,milestoneStageBinding:spec.milestoneStageBinding,
        specOnly:true
      })
    ]
  );

  for(const milestone of spec.milestones){
    await conn.execute(
      `INSERT INTO workflow_template_milestones
        (id,workflow_template_id,milestone_key,display_name,sequence_no,acceptance_json,metadata_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        randomUUID(),templateId,milestone.milestoneKey,milestone.displayName,milestone.sequenceNo,
        asJson(milestone.acceptance),asJson(milestone.metadata)
      ]
    );
  }

  for(const item of spec.stages){
    const stageId=randomUUID();
    const primaryCapabilityKey=agentKey(item.primaryAgentRole);
    await conn.execute(
      `INSERT INTO workflow_template_stages
        (id,workflow_template_id,milestone_template_id,stage_key,display_name,stage_type,
         sequence_no,default_agent_capability_key,gate_policy_key,config_json)
       VALUES (?,?,NULL,?,?,?,?,?,?,?)`,
      [
        stageId,templateId,item.stageKey,item.displayName,item.stageType,item.sequenceNo,
        primaryCapabilityKey,item.defaultGateKey,asJson(item.config)
      ]
    );

    let assignmentPriority=1;
    await conn.execute(
      `INSERT INTO stage_agent_assignments
        (id,workflow_stage_id,agent_capability_key,assignment_role,priority,conditional_json)
       VALUES (?,?,?,'PRIMARY',?,NULL)`,
      [randomUUID(),stageId,primaryCapabilityKey,assignmentPriority++]
    );
    for(const role of item.supportingAgentRoles){
      await conn.execute(
        `INSERT INTO stage_agent_assignments
          (id,workflow_stage_id,agent_capability_key,assignment_role,priority,conditional_json)
         VALUES (?,?,?,'SUPPORTING',?,?)`,
        [
          randomUUID(),stageId,agentKey(role),assignmentPriority++,
          asJson(role==='AI Product / Eval'?{subtype:'AI_APPLICATION'}:null)
        ]
      );
    }

    for(const contract of item.gateContracts){
      await conn.execute(
        `INSERT INTO stage_gate_contracts
          (id,workflow_stage_id,gate_key,gate_role,required,aggregation_mode,sequence_no,
           applies_when_json,contract_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          randomUUID(),stageId,contract.gateKey,contract.gateRole,contract.required?1:0,
          contract.aggregationMode,contract.sequenceNo,asJson(contract.appliesWhen),asJson(contract.contract)
        ]
      );
    }

    for(const requirement of item.requirements){
      await conn.execute(
        `INSERT INTO stage_capability_requirements
          (id,workflow_stage_id,requirement_key,capability_type,capability_key,routing_mode,
           requirement_mode,priority,constraints_json)
         VALUES (?,?,?, ?,NULL,'DEFERRED',?,?,?)`,
        [
          randomUUID(),stageId,requirement.requirementKey,requirement.capabilityType,
          requirement.requirementMode,requirement.priority,asJson(requirement.constraints)
        ]
      );
    }

    for(const policy of item.knowledgePolicies){
      await conn.execute(
        `INSERT INTO stage_knowledge_policies
          (id,workflow_stage_id,policy_key,source_key,query_template,context_role,required,max_items,
           allowed_statuses_json,injection_mode,writeback_mode,writeback_target_path,config_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          randomUUID(),stageId,policy.policyKey,policy.sourceKey,policy.queryTemplate,policy.contextRole,
          policy.required?1:0,policy.maxItems,asJson(policy.allowedStatuses),policy.injectionMode,
          policy.writebackMode,policy.writebackTargetPath,asJson({specOnly:true})
        ]
      );
    }
  }
  return {id:templateId,definitionSha256,created:true};
};

export const bootstrapBuiltinDomainWorkflowSpecs=async()=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  const results=[];
  try{
    await conn.beginTransaction();
    for(const spec of BUILTIN_DOMAIN_SPECS){
      results.push({projectTypeKey:spec.projectTypeKey,...await ensureSpec(conn,spec)});
    }
    await conn.commit();
    return results;
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{
    conn.release();
  }
};
