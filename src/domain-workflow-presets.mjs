import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import {
  upsertCapability,upsertAgentProfile,grantAgentCapability,bindProjectTypeCapability,
  createWorkflowTemplate,addWorkflowMilestone,addWorkflowStage,addStageCapabilityRequirement,
  addStageKnowledgePolicy,freezeWorkflowTemplate
} from './core-meta-registry.mjs';

const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const m=(key,name,sequenceNo)=>({milestoneKey:key,displayName:name,sequenceNo});
const modelReq=(taskType,extra={})=>({
  requirementKey:'PRIMARY_MODEL',capabilityType:'MODEL',routingMode:'POLICY',requirementMode:'REQUIRED',
  constraints:{taskType,structuredOutput:true,...extra}
});
const taggedReq=(key,type,domainCapability,required=true)=>({
  requirementKey:key,capabilityType:type,routingMode:'POLICY',
  requirementMode:required?'REQUIRED':'OPTIONAL',
  constraints:{requiredPolicyTags:{domainCapability}}
});
const k=(policyKey,bindingKey,queryTemplate,contextRole,required=true,writebackMode='NONE')=>({
  policyKey,bindingKey,queryTemplate,contextRole,required,maxItems:12,
  allowedStatuses:['CURRENT','FACT','RULE','FINAL'],
  injectionMode:'APPEND_CONTEXT',writebackMode
});
const s=(stageKey,displayName,sequenceNo,milestoneKey,gateKey,agentRole,supportingRoles,options={})=>({
  stageKey,displayName,sequenceNo,milestoneKey,gateKey,agentRole,supportingRoles,
  executionMode:options.executionMode||'AUTO',
  maxRetries:options.maxRetries??1,
  onFailure:options.onFailure||'RETRY',
  onRetryExhausted:options.onRetryExhausted||'ESCALATE',
  rollbackStageKey:options.rollbackStageKey||null,
  capabilityRequirements:options.capabilityRequirements||[],
  knowledgePolicies:options.knowledgePolicies||[],
  metadata:options.metadata||{}
});

const PRODUCT_PRESET={
  presetKey:'PRODUCT_DEVELOPMENT_STANDARD',
  projectTypeKey:'PRODUCT_DEVELOPMENT',
  version:'1.2',
  displayName:'Product Development Standard Workflow',
  sourceRefs:[
    {name:'AI_Native_2.0_产品研发工作流_V1.2_CURRENT.md',status:'CURRENT',date:'2026-10-05'},
    {name:'AI_NATIVE_2.0_MASTER_BLUEPRINT_V1.4_FROZEN.md',status:'FROZEN'}
  ],
  milestones:[
    m('PD-M0','Readiness Complete',1),
    m('PD-M1','Problem / Opportunity Validated',2),
    m('PD-M2','Product Baseline Approved',3),
    m('PD-M3','Design + Technical Contract Locked',4),
    m('PD-M4','Feature Complete / Preview Ready',5),
    m('PD-M5','Acceptance + QA PASS',6),
    m('PD-M6','Release Candidate Ready',7),
    m('PD-M7','Production Verified',8),
    m('PD-M8','Outcome Reviewed / Version Closed',9)
  ],
  stages:[
    s('PD_00_INIT','Project Initialization / System Readiness',1,'PD-M0','G-PD-INIT','PROJECT_INITIALIZATION',['ENVIRONMENT','SECURITY'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PROJECT_INITIALIZATION')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load current project baseline, scope, roles, environments and execution constraints.','PROJECT_CONTEXT')]
    }),
    s('PD_01_DISCOVERY','Discovery / Evidence / Insight / Competitor Intelligence',2,'PD-M1','G-PD-DISCOVERY','PRODUCT_RESEARCH',['DATA','OPERATIONS'],{
      capabilityRequirements:[modelReq('PRODUCT_DISCOVERY')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load current product facts, rules, existing decisions and user context.','PROJECT_CONTEXT'),
        k('MARKET_RESEARCH','MARKET_RESEARCH','Load dated market, competitor and user evidence relevant to the current problem.','RESEARCH_CONTEXT')
      ]
    }),
    s('PD_02_OPPORTUNITY','Opportunity / Hypothesis / Prioritization',3,'PD-M1','G-PD-PRIORITY','PRODUCT',['RESEARCH','DATA','PROJECT'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PRODUCT_PRIORITIZATION')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load validated discovery evidence, opportunities, constraints and current backlog.','PROJECT_CONTEXT')]
    }),
    s('PD_03_GOAL','Goal / Success Criteria / Product Bet',4,'PD-M1','G-PD-GOAL','PRODUCT',['RESEARCH','DATA'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PRODUCT_GOAL_DEFINITION')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load approved opportunity, business constraints and measurable outcome context.','PROJECT_CONTEXT')]
    }),
    s('PD_04_PRODUCT','Product Definition / Requirement Baseline',5,'PD-M2','G-PD-PRODUCT','PRODUCT',['RESEARCH','DESIGN'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PRODUCT_DEFINITION')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load approved goal, scope, existing requirements and change history.','PROJECT_CONTEXT')]
    }),
    s('PD_05_FEASIBILITY','Feasibility / Risk / Architecture',6,'PD-M3','G-PD-FEASIBILITY','FEASIBILITY',['ENGINEERING','SECURITY','COMPLIANCE'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('TECHNICAL_FEASIBILITY')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load frozen product baseline and constraints.','PROJECT_CONTEXT'),
        k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load current architecture, API, data, environment and dependency facts.','ENGINEERING_CONTEXT')
      ]
    }),
    s('PD_06_PLAN','Delivery Planning / Milestone / Release Plan',7,'PD-M3','G-PD-PLAN','PRODUCT_PROJECT',['ENGINEERING','DESIGN','QA'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('DELIVERY_PLANNING')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load product baseline, feasibility decision, dependencies, risks and milestone context.','PROJECT_CONTEXT')]
    }),
    s('PD_07_DESIGN','Design / Prototype / Design Contract',8,'PD-M3','G-PD-DESIGN','DESIGN',['PRODUCT'],{
      executionMode:'HUMAN_GATE',
      capabilityRequirements:[modelReq('PRODUCT_DESIGN'),taggedReq('DESIGN_TOOL','TOOL','DESIGN')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load approved product baseline, flows, requirements and acceptance criteria.','PROJECT_CONTEXT'),
        k('DESIGN_SOURCE','DESIGN_SOURCE','Load current design system, design source and existing prototype constraints.','DESIGN_CONTEXT',false)
      ]
    }),
    s('PD_08_CONTRACT','Technical / API / Data / Integration / Instrumentation Contract',9,'PD-M3','G-PD-CONTRACT','ENGINEERING_DATA',['PRODUCT','SECURITY'],{
      executionMode:'HUMAN_GATE',
      capabilityRequirements:[modelReq('TECHNICAL_CONTRACT')],
      knowledgePolicies:[k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load current API, schema, integration, instrumentation and security constraints.','ENGINEERING_CONTEXT')]
    }),
    s('PD_09_ENGINEERING','Engineering / Implementation',10,'PD-M4',null,'ENGINEERING',['PRODUCT','DESIGN'],{
      executionMode:'HYBRID',capabilityRequirements:[
        taggedReq('CODE_EXECUTION','TOOL','CODE_EXECUTION'),
        taggedReq('SOURCE_CONTROL','MCP','SOURCE_CONTROL')
      ],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load frozen product/design/technical contracts and acceptance criteria.','PROJECT_CONTEXT'),
        k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load repository, branch, current code and dependency context.','ENGINEERING_CONTEXT')
      ]
    }),
    s('PD_10_BUILD','Build / Integration / Preview',11,'PD-M4','G-PD-ENGINEERING','PREVIEW_RELEASE_ENGINEERING',['ENGINEERING'],{
      capabilityRequirements:[taggedReq('BUILD_PREVIEW','TOOL','BUILD_DEPLOY')],
      knowledgePolicies:[k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load exact implementation version, environment, migration and build context.','ENGINEERING_CONTEXT')]
    }),
    s('PD_11_ACCEPTANCE','Product Acceptance',12,'PD-M5','G-PD-ACCEPTANCE','ACCEPTANCE',['PRODUCT','DESIGN'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PRODUCT_ACCEPTANCE')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load frozen requirements, design contract, acceptance matrix and preview evidence.','PROJECT_CONTEXT')]
    }),
    s('PD_12_QA','QA / Non-functional / Security Validation',13,'PD-M5','G-PD-QA','QA',['ENGINEERING','SECURITY','EVAL'],{
      capabilityRequirements:[taggedReq('TEST_EXECUTION','TOOL','TESTING')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load acceptance baseline, quality matrix and known issues.','PROJECT_CONTEXT'),
        k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load exact build, environment and change set under test.','ENGINEERING_CONTEXT')
      ]
    }),
    s('PD_13_RELEASE_READY','Release Readiness / Version Freeze',14,'PD-M6','G-PD-RELEASE-READY','RELEASE',['QA','PRODUCT','COMPLIANCE'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('RELEASE_READINESS')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load release candidate scope, acceptance, QA, risks and rollout/rollback constraints.','PROJECT_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load applicable security, privacy, compliance and release obligations.','COMPLIANCE_CONTEXT',false)
      ]
    }),
    s('PD_14_RELEASE','Release / Rollout',15,'PD-M7','G-PD-RELEASE','RELEASE',['ENGINEERING','OPERATIONS'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[taggedReq('DEPLOYMENT','TOOL','DEPLOYMENT')],
      knowledgePolicies:[k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load exact frozen release candidate, environment and rollback target.','ENGINEERING_CONTEXT')]
    }),
    s('PD_15_POST_RELEASE','Post-release Verification / Incident Operations',16,'PD-M7',null,'OPERATIONS_RELEASE',['ENGINEERING','DATA'],{
      capabilityRequirements:[taggedReq('OBSERVABILITY','TOOL','OBSERVABILITY')],
      knowledgePolicies:[k('ENGINEERING_SOURCE','ENGINEERING_SOURCE','Load production health, readiness, incident and deployment evidence.','OPERATIONS_CONTEXT')]
    }),
    s('PD_16_OUTCOME','Data / Experiment / Feedback',17,'PD-M8','G-PD-OUTCOME','DATA_EXPERIMENT',['PRODUCT'],{
      capabilityRequirements:[taggedReq('DATA_ANALYTICS','TOOL','DATA_ANALYTICS')],
      knowledgePolicies:[k('PERFORMANCE_DATA','PERFORMANCE_DATA','Load current instrumentation, KPI, experiment, feedback and incident evidence.','DATA_CONTEXT')]
    }),
    s('PD_17_REVIEW','Decision / Review',18,'PD-M8','G-PD-REVIEW','REVIEW',['PRODUCT','ENGINEERING','QA','DATA'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('PROJECT_REVIEW')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load planned versus actual delivery, change, defect, release and outcome evidence.','PROJECT_CONTEXT'),
        k('PERFORMANCE_DATA','PERFORMANCE_DATA','Load outcome, experiment and operational evidence.','DATA_CONTEXT',false)
      ]
    }),
    s('PD_18_KNOWLEDGE','Knowledge / Backlog / Next Version',19,'PD-M8','G-PD-REVIEW','KNOWLEDGE_UPDATE',['REVIEW','PRODUCT'],{
      capabilityRequirements:[modelReq('KNOWLEDGE_SYNTHESIS')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load project review evidence, decisions, patterns, failures and backlog context.','PROJECT_CONTEXT',true,'PROPOSE')]
    })
  ]
};

const AIGC_PRESET={
  presetKey:'AIGC_CONTENT_STANDARD',
  projectTypeKey:'AIGC_CONTENT',
  version:'2.4',
  displayName:'AIGC Content Production Standard Workflow',
  sourceRefs:[
    {name:'AI_Native_2.0_AIGC工作流升级说明_V2.4_CURRENT.md',status:'CURRENT',date:'2026-10-05'},
    {name:'AI_NATIVE_2.0_MASTER_BLUEPRINT_V1.4_FROZEN.md',status:'FROZEN'}
  ],
  milestones:[
    m('AG-M0','Project / Rights / Environment Ready',1),
    m('AG-M1','Creative Direction / Market Hypothesis Approved',2),
    m('AG-M2','Story / Script / Structure Locked',3),
    m('AG-M3','Master Asset System Ready',4),
    m('AG-M4','Storyboard / Shot / Production Plan Ready',5),
    m('AG-M5','Core Production Complete',6),
    m('AG-M6','Edit / Picture / Audio Master Locked',7),
    m('AG-M7','Distribution / Localization Package Ready',8),
    m('AG-M8','Published / Distributed',9),
    m('AG-M9','Performance Review / Knowledge Backwrite Complete',10)
  ],
  stages:[
    s('AIGC_00_INIT','Project Initialization / Rights / Environment',1,'AG-M0','G-AIGC-INIT','AIGC_PROJECT_INITIALIZATION',['RIGHTS','SECURITY','OPERATIONS'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('AIGC_PROJECT_INITIALIZATION')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load current project/work/version baseline, target audience, budget and production constraints.','PROJECT_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load rights, license, likeness, brand, font, music and AI disclosure constraints.','COMPLIANCE_CONTEXT')
      ]
    }),
    s('AIGC_01_DISCOVERY','Discovery / Market / Creative Benchmark',2,'AG-M1','G-AIGC-DISCOVERY','CREATOR_RESEARCH',['DATA','CONTENT_STRATEGY'],{
      capabilityRequirements:[modelReq('AIGC_DISCOVERY')],
      knowledgePolicies:[
        k('MARKET_RESEARCH','MARKET_RESEARCH','Load dated market, platform, creator, competitor and creative reference evidence.','RESEARCH_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load rights constraints that affect reference use and distribution.','COMPLIANCE_CONTEXT',false)
      ]
    }),
    s('AIGC_02_PLAN','Planning / Milestone / Budget / Production Strategy',3,'AG-M1','G-AIGC-PLAN','CONTENT_STRATEGY_PROJECT',['PRODUCTION','OPERATIONS'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('AIGC_PLANNING')],
      knowledgePolicies:[k('PROJECT_CURRENT','PROJECT_CURRENT','Load approved creative direction, hierarchy, budget, milestones, dependencies and production constraints.','PROJECT_CONTEXT')]
    }),
    s('AIGC_03_SCRIPT','Story / Script / Structure',4,'AG-M2','G-AIGC-SCRIPT','SCRIPT',['RESEARCH','REVIEW'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('SCRIPT_CONTINUITY')],
      knowledgePolicies:[k('STORY_KNOWLEDGE','STORY_KNOWLEDGE','Load CURRENT/FACT/RULE story, character, relationship, timeline, scene and dialogue knowledge.','STORY_CONTEXT')]
    }),
    s('AIGC_04_BREAKDOWN','Breakdown / Shot / Production Planning',5,'AG-M4','G-AIGC-BREAKDOWN','PRODUCTION_PLANNING',['ASSET','VISUAL','AUDIO'],{
      capabilityRequirements:[modelReq('SHOT_BREAKDOWN')],
      knowledgePolicies:[
        k('STORY_KNOWLEDGE','STORY_KNOWLEDGE','Load locked script, scene, character, dialogue and continuity facts.','STORY_CONTEXT'),
        k('PRODUCTION_KNOWLEDGE','PRODUCTION_KNOWLEDGE','Load existing shot, asset coverage, production dependency and retry constraints.','PRODUCTION_CONTEXT',false)
      ]
    }),
    s('AIGC_05_FORMAT','Visual Format / Audio / Distribution Strategy',6,'AG-M1','G-AIGC-FORMAT','CONTENT_VISUAL_STRATEGY',['VISUAL','AUDIO','OPERATIONS'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('AIGC_FORMAT_STRATEGY')],
      knowledgePolicies:[
        k('VISUAL_KNOWLEDGE','VISUAL_KNOWLEDGE','Load current visual style, format, camera, crop and safe-area rules.','VISUAL_CONTEXT'),
        k('AUDIO_KNOWLEDGE','AUDIO_KNOWLEDGE','Load voice, music, track, loudness and audio-rights rules.','AUDIO_CONTEXT',false),
        k('DISTRIBUTION_KNOWLEDGE','DISTRIBUTION_KNOWLEDGE','Load target channel, market, language and platform specification.','DISTRIBUTION_CONTEXT',false)
      ]
    }),
    s('AIGC_06_ASSET','Asset System / Master Creation',7,'AG-M3','G-AIGC-ASSET','ASSET_SYSTEM',['VISUAL','AUDIO','RIGHTS'],{
      capabilityRequirements:[taggedReq('ASSET_GENERATION','TOOL','ASSET_GENERATION')],
      knowledgePolicies:[
        k('STORY_KNOWLEDGE','STORY_KNOWLEDGE','Load asset identity facts and immutable story constraints.','STORY_CONTEXT'),
        k('VISUAL_KNOWLEDGE','VISUAL_KNOWLEDGE','Load CURRENT visual master rules and reusable asset constraints.','VISUAL_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load rights and usage-scope constraints for master assets.','COMPLIANCE_CONTEXT')
      ]
    }),
    s('AIGC_07_IMAGE','Image / Keyframe / Storyboard Production',8,'AG-M5','G-AIGC-IMAGE','VISUAL_PRODUCTION',['ASSET','QA'],{
      capabilityRequirements:[taggedReq('IMAGE_GENERATION','TOOL','IMAGE_GENERATION')],
      knowledgePolicies:[
        k('STORY_KNOWLEDGE','STORY_KNOWLEDGE','Load shot-level story, character, action and continuity facts.','STORY_CONTEXT'),
        k('VISUAL_KNOWLEDGE','VISUAL_KNOWLEDGE','Load identity, look, scene, prop, action, expression and composition masters.','VISUAL_CONTEXT'),
        k('PRODUCTION_KNOWLEDGE','PRODUCTION_KNOWLEDGE','Load current call sheet, reference roles, only-variable and QA constraints.','PRODUCTION_CONTEXT')
      ]
    }),
    s('AIGC_08_VIDEO_AUDIO','Video / Motion / Dialogue / Music / SFX Production',9,'AG-M5','G-AIGC-PRODUCTION','AIGC_PRODUCTION',['VISUAL','AUDIO','QA'],{
      capabilityRequirements:[
        taggedReq('VIDEO_GENERATION','TOOL','VIDEO_GENERATION'),
        taggedReq('AUDIO_GENERATION','TOOL','AUDIO_GENERATION')
      ],
      knowledgePolicies:[
        k('VISUAL_KNOWLEDGE','VISUAL_KNOWLEDGE','Load locked keyframes, motion, continuity and camera constraints.','VISUAL_CONTEXT'),
        k('AUDIO_KNOWLEDGE','AUDIO_KNOWLEDGE','Load voice, dialogue, music, SFX, timing and rights constraints.','AUDIO_CONTEXT'),
        k('PRODUCTION_KNOWLEDGE','PRODUCTION_KNOWLEDGE','Load generation history, failure modes and retry scope.','PRODUCTION_CONTEXT')
      ]
    }),
    s('AIGC_09_EDIT','Edit / Timeline / Composite / Post-production',10,'AG-M6','G-AIGC-EDIT','EDITING',['AUDIO','VISUAL','QA'],{
      capabilityRequirements:[taggedReq('MEDIA_EDITING','TOOL','MEDIA_EDITING')],
      knowledgePolicies:[
        k('PRODUCTION_KNOWLEDGE','PRODUCTION_KNOWLEDGE','Load selected/locked assets, timeline, source lineage and post-production constraints.','PRODUCTION_CONTEXT'),
        k('AUDIO_KNOWLEDGE','AUDIO_KNOWLEDGE','Load dialogue/music/SFX/ambience track intent and lock state.','AUDIO_CONTEXT',false)
      ]
    }),
    s('AIGC_10_MASTER','Mastering / Acceptance / QA / Compliance',11,'AG-M6','G-AIGC-MASTER','AIGC_ACCEPTANCE_QA',['REVIEW','COMPLIANCE','RIGHTS'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[taggedReq('MEDIA_QA','TOOL','MEDIA_QA')],
      knowledgePolicies:[
        k('STORY_KNOWLEDGE','STORY_KNOWLEDGE','Load frozen story/script/creative intent and continuity facts.','STORY_CONTEXT'),
        k('VISUAL_KNOWLEDGE','VISUAL_KNOWLEDGE','Load visual master/continuity rules.','VISUAL_CONTEXT'),
        k('AUDIO_KNOWLEDGE','AUDIO_KNOWLEDGE','Load audio master and technical rules.','AUDIO_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load rights, license, likeness, AI disclosure and platform compliance constraints.','COMPLIANCE_CONTEXT')
      ],
      metadata:{subGates:[
        'G-AIGC-CREATIVE-ACCEPTANCE','G-AIGC-PRODUCTION-QA','G-AIGC-TECHNICAL-QA',
        'G-AIGC-COMPLIANCE','G-AIGC-LOCALIZATION-QA'
      ]}
    }),
    s('AIGC_11_DERIVATION','Content Derivation / Localization / Platform Adaptation',12,'AG-M7','G-AIGC-DISTRIBUTION-PACKAGE','OPERATIONS_CONTENT',['LOCALIZATION','EDITING'],{
      capabilityRequirements:[modelReq('CONTENT_DERIVATION')],
      knowledgePolicies:[
        k('DISTRIBUTION_KNOWLEDGE','DISTRIBUTION_KNOWLEDGE','Load channel, market, format, localization and spoiler constraints.','DISTRIBUTION_CONTEXT'),
        k('PERFORMANCE_KNOWLEDGE','PERFORMANCE_KNOWLEDGE','Load prior content performance patterns that may inform derivation hypotheses.','PERFORMANCE_CONTEXT',false)
      ]
    }),
    s('AIGC_12_PUBLISH','Release / Distribution / Publishing',13,'AG-M8','G-AIGC-PUBLISH','OPERATIONS_RELEASE',['COMPLIANCE'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[taggedReq('PUBLISHING','MCP','PUBLISHING')],
      knowledgePolicies:[
        k('DISTRIBUTION_KNOWLEDGE','DISTRIBUTION_KNOWLEDGE','Load release plan, account/channel, platform, region and publication constraints.','DISTRIBUTION_CONTEXT'),
        k('RIGHTS_COMPLIANCE','RIGHTS_COMPLIANCE','Load rights/disclosure constraints for the selected channel and region.','COMPLIANCE_CONTEXT')
      ]
    }),
    s('AIGC_13_PERFORMANCE','Performance / Experiment / Feedback',14,'AG-M9','G-AIGC-PERFORMANCE','DATA_ANALYSIS',['OPERATIONS','CONTENT'],{
      capabilityRequirements:[taggedReq('DATA_ANALYTICS','TOOL','DATA_ANALYTICS')],
      knowledgePolicies:[k('PERFORMANCE_KNOWLEDGE','PERFORMANCE_KNOWLEDGE','Load production and distribution metrics, experiment results and feedback.','PERFORMANCE_CONTEXT')]
    }),
    s('AIGC_14_REVIEW','Review / Knowledge / Next Version',15,'AG-M9','G-AIGC-REVIEW','AIGC_REVIEW_KNOWLEDGE',['ALL_STAGES'],{
      executionMode:'HUMAN_GATE',capabilityRequirements:[modelReq('AIGC_REVIEW')],
      knowledgePolicies:[
        k('PROJECT_CURRENT','PROJECT_CURRENT','Load planned vs actual production, cost, failure, QA and delivery evidence.','PROJECT_CONTEXT'),
        k('PERFORMANCE_KNOWLEDGE','PERFORMANCE_KNOWLEDGE','Load distribution/performance/experiment evidence.','PERFORMANCE_CONTEXT',false,'PROPOSE'),
        k('PRODUCTION_KNOWLEDGE','PRODUCTION_KNOWLEDGE','Load production failure modes, model/tool benchmark and reuse evidence.','PRODUCTION_CONTEXT',false,'PROPOSE')
      ]
    })
  ]
};

export const STANDARD_DOMAIN_PRESETS=[PRODUCT_PRESET,AIGC_PRESET];

const normalizePresetRow=row=>({
  presetKey:row.preset_key,projectTypeKey:row.project_type_key,version:row.version,
  displayName:row.display_name,status:row.status,spec:parseJson(row.spec_json),
  specSha256:row.spec_sha256,sourceRefs:parseJson(row.source_refs_json)||[],
  createdAt:row.created_at,updatedAt:row.updated_at
});

export const syncStandardDomainPresets=async()=>{
  const db=getRuntimePool();
  const synced=[];
  for(const spec of STANDARD_DOMAIN_PRESETS){
    const specSha256=sha256(spec);
    await db.execute(
      `INSERT INTO domain_workflow_presets
        (preset_key,project_type_key,version,display_name,status,spec_json,spec_sha256,source_refs_json)
       VALUES (?,?,?,?, 'ACTIVE',?,?,?)
       ON DUPLICATE KEY UPDATE
         project_type_key=VALUES(project_type_key),version=VALUES(version),
         display_name=VALUES(display_name),status='ACTIVE',
         spec_json=VALUES(spec_json),spec_sha256=VALUES(spec_sha256),
         source_refs_json=VALUES(source_refs_json)`,
      [spec.presetKey,spec.projectTypeKey,spec.version,spec.displayName,asJson(spec),specSha256,asJson(spec.sourceRefs)]
    );
    synced.push({presetKey:spec.presetKey,specSha256});
  }
  return synced;
};

export const listProjectSubtypes=async({projectTypeKey,status='ACTIVE'}={})=>{
  const db=getRuntimePool(),where=[],params=[];
  if(projectTypeKey){where.push('project_type_key=?');params.push(projectTypeKey);}
  if(status){where.push('status=?');params.push(status);}
  const [rows]=await db.execute(
    `SELECT * FROM project_subtype_registry
      ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY project_type_key,subtype_key`,params
  );
  return rows.map(row=>({
    projectTypeKey:row.project_type_key,subtypeKey:row.subtype_key,displayName:row.display_name,
    status:row.status,overlay:parseJson(row.overlay_json),createdAt:row.created_at,updatedAt:row.updated_at
  }));
};

export const listDomainWorkflowPresets=async({projectTypeKey=null}={})=>{
  await syncStandardDomainPresets();
  const db=getRuntimePool();
  const [rows]=projectTypeKey
    ? await db.execute(
        'SELECT * FROM domain_workflow_presets WHERE project_type_key=? AND status=\'ACTIVE\' ORDER BY preset_key',
        [projectTypeKey]
      )
    : await db.execute(
        'SELECT * FROM domain_workflow_presets WHERE status=\'ACTIVE\' ORDER BY project_type_key,preset_key'
      );
  return rows.map(normalizePresetRow);
};

export const getDomainWorkflowPreset=async presetKey=>{
  await syncStandardDomainPresets();
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM domain_workflow_presets WHERE preset_key=?',[presetKey]
  );
  if(!rows.length) throw errorOf('Domain workflow preset not found','DOMAIN_PRESET_NOT_FOUND',404);
  return normalizePresetRow(rows[0]);
};

const capabilityMatches=(row,requirement)=>{
  if(row.capability_type!==requirement.capabilityType||row.status!=='ACTIVE'||!Boolean(row.routable)) return false;
  const constraints=requirement.constraints||{};
  const requiredTags=constraints.requiredPolicyTags||{};
  const tags=parseJson(row.policy_tags_json)||{};
  for(const [key,value] of Object.entries(requiredTags)){
    if(JSON.stringify(tags[key])!==JSON.stringify(value)) return false;
  }
  if(requirement.capabilityType==='MODEL'){
    const modelCaps=parseJson(row.model_capabilities_json)||{};
    if(constraints.taskType&&Array.isArray(modelCaps.taskTypes)&&modelCaps.taskTypes.length&&
       !modelCaps.taskTypes.includes(constraints.taskType)) return false;
    if(constraints.structuredOutput===true&&modelCaps.structuredOutput===false) return false;
  }
  return true;
};

const listCapabilityCandidates=async requirement=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.*,
            mb.provider_key,mb.model_key,m.capabilities_json AS model_capabilities_json
       FROM capability_registry c
       LEFT JOIN model_capability_bindings mb ON mb.capability_key=c.capability_key
       LEFT JOIN model_registry m ON m.provider_key=mb.provider_key AND m.model_key=mb.model_key
      WHERE c.capability_type=? AND c.status='ACTIVE' AND c.routable=TRUE
      ORDER BY c.capability_key`,
    [requirement.capabilityType]
  );
  return rows.filter(row=>capabilityMatches(row,requirement));
};

const agentKeyFor=(projectTypeKey,role)=>`AGENT:STANDARD:${projectTypeKey}:${role}`;

const ensureStageAgent=async(spec,stage,candidateMap)=>{
  const agentKey=agentKeyFor(spec.projectTypeKey,stage.agentRole);
  await upsertCapability({
    capabilityKey:agentKey,capabilityType:'AGENT',
    displayName:`${stage.agentRole} Agent`,version:spec.version,status:'ACTIVE',routable:true,
    adapterKey:'agent-runtime',
    metadata:{
      standardDomainAgent:true,presetKey:spec.presetKey,projectTypeKey:spec.projectTypeKey,
      primaryRole:stage.agentRole,supportedStages:[stage.stageKey],supportingRoles:stage.supportingRoles
    }
  });
  await upsertAgentProfile({
    capabilityKey:agentKey,roleKey:stage.agentRole,policyMode:'QUALITY_FIRST',
    knowledgeScope:{projectTypeKey:spec.projectTypeKey,stageKey:stage.stageKey},
    config:{standardDomainAgent:true,supportingRoles:stage.supportingRoles}
  });
  await bindProjectTypeCapability({
    projectTypeKey:spec.projectTypeKey,capabilityKey:agentKey,bindingMode:'DEFAULT',priority:1
  });
  for(const requirement of stage.capabilityRequirements){
    for(const candidate of candidateMap.get(requirement.requirementKey)||[]){
      await bindProjectTypeCapability({
        projectTypeKey:spec.projectTypeKey,capabilityKey:candidate.capability_key,
        bindingMode:'ALLOWED',priority:100
      });
      await grantAgentCapability({
        agentCapabilityKey:agentKey,childCapabilityKey:candidate.capability_key,
        requirementMode:'ALLOWED',priority:100,constraints:requirement.constraints||null
      });
    }
  }
  return agentKey;
};

export const getDomainPresetReadiness=async presetKey=>{
  const preset=await getDomainWorkflowPreset(presetKey);
  const spec=preset.spec;
  const stages=[];
  let missingRequiredCount=0;
  for(const stage of spec.stages){
    const requirements=[];
    for(const requirement of stage.capabilityRequirements){
      const candidates=await listCapabilityCandidates(requirement);
      const ready=requirement.requirementMode!=='REQUIRED'||candidates.length>0;
      if(!ready) missingRequiredCount++;
      requirements.push({
        requirementKey:requirement.requirementKey,capabilityType:requirement.capabilityType,
        requirementMode:requirement.requirementMode,constraints:requirement.constraints||{},
        ready,candidateCapabilityKeys:candidates.map(x=>x.capability_key)
      });
    }
    stages.push({
      stageKey:stage.stageKey,displayName:stage.displayName,agentRole:stage.agentRole,
      executionMode:stage.executionMode,ready:requirements.every(x=>x.ready),requirements
    });
  }
  return {
    presetKey:preset.presetKey,projectTypeKey:preset.projectTypeKey,version:preset.version,
    specSha256:preset.specSha256,ready:missingRequiredCount===0,missingRequiredCount,stages
  };
};

export const compileDomainWorkflowPreset=async presetKey=>{
  const preset=await getDomainWorkflowPreset(presetKey);
  const spec=preset.spec;
  const readiness=await getDomainPresetReadiness(presetKey);
  const db=getRuntimePool();

  const [existingRelease]=await db.execute(
    `SELECT r.*,wt.status AS workflow_status,wt.definition_sha256
       FROM domain_workflow_releases r
       LEFT JOIN workflow_templates wt ON wt.id=r.workflow_template_id
      WHERE r.preset_key=? AND r.preset_spec_sha256=? LIMIT 1`,
    [presetKey,preset.specSha256]
  );
  if(existingRelease.length&&existingRelease[0].status==='FROZEN'&&existingRelease[0].workflow_status==='FROZEN'){
    return {
      presetKey,status:'FROZEN',workflowTemplateId:existingRelease[0].workflow_template_id,
      definitionSha256:existingRelease[0].definition_sha256,
      readiness:parseJson(existingRelease[0].readiness_json),idempotent:true
    };
  }

  if(!readiness.ready){
    const releaseId=existingRelease[0]?.id||randomUUID();
    await db.execute(
      `INSERT INTO domain_workflow_releases
        (id,preset_key,workflow_template_id,status,readiness_json,preset_spec_sha256)
       VALUES (?,?,NULL,'BLOCKED',?,?)
       ON DUPLICATE KEY UPDATE status='BLOCKED',readiness_json=VALUES(readiness_json),
         workflow_template_id=NULL,workflow_definition_sha256=NULL,activated_at=NULL`,
      [releaseId,presetKey,asJson(readiness),preset.specSha256]
    );
    return {presetKey,status:'BLOCKED',workflowTemplateId:null,readiness,idempotent:false};
  }

  const candidateMapByStage=new Map();
  for(const stage of spec.stages){
    const map=new Map();
    for(const requirement of stage.capabilityRequirements){
      map.set(requirement.requirementKey,await listCapabilityCandidates(requirement));
    }
    candidateMapByStage.set(stage.stageKey,map);
  }

  const workflow=await createWorkflowTemplate({
    projectTypeKey:spec.projectTypeKey,
    templateKey:`STANDARD:${spec.presetKey}`,
    version:spec.version,
    displayName:spec.displayName,
    description:`Compiled standard domain workflow from ${spec.presetKey}`,
    metadata:{
      domainPresetKey:spec.presetKey,presetSpecSha256:preset.specSha256,sourceRefs:spec.sourceRefs
    }
  });

  const milestoneIds=new Map();
  for(const milestone of spec.milestones){
    const row=await addWorkflowMilestone(workflow.id,{
      milestoneKey:milestone.milestoneKey,displayName:milestone.displayName,
      sequenceNo:milestone.sequenceNo,acceptance:{domainPresetKey:spec.presetKey}
    });
    milestoneIds.set(milestone.milestoneKey,row.id);
  }

  for(const stage of spec.stages){
    const candidateMap=candidateMapByStage.get(stage.stageKey);
    const agentKey=await ensureStageAgent(spec,stage,candidateMap);
    const row=await addWorkflowStage(workflow.id,{
      milestoneTemplateId:milestoneIds.get(stage.milestoneKey)||null,
      stageKey:stage.stageKey,displayName:stage.displayName,sequenceNo:stage.sequenceNo,
      defaultAgentCapabilityKey:agentKey,gatePolicyKey:stage.gateKey,
      config:{
        maxRetries:stage.maxRetries,onFailure:stage.onFailure,onRetryExhausted:stage.onRetryExhausted,
        rollbackStageKey:stage.rollbackStageKey,
        executionMode:stage.executionMode,
        humanGateRequired:stage.executionMode==='HUMAN_GATE',
        supportingRoles:stage.supportingRoles,
        domainPresetKey:spec.presetKey,
        ...stage.metadata
      }
    });
    for(const requirement of stage.capabilityRequirements){
      await addStageCapabilityRequirement(row.id,{
        requirementKey:requirement.requirementKey,
        capabilityType:requirement.capabilityType,
        routingMode:requirement.routingMode,
        requirementMode:requirement.requirementMode,
        priority:100,
        constraints:requirement.constraints||null
      });
    }
    for(const policy of stage.knowledgePolicies){
      await addStageKnowledgePolicy(row.id,{
        policyKey:policy.policyKey,sourceKey:policy.bindingKey,queryTemplate:policy.queryTemplate,
        contextRole:policy.contextRole,required:policy.required,maxItems:policy.maxItems,
        allowedStatuses:policy.allowedStatuses,injectionMode:policy.injectionMode,
        writebackMode:policy.writebackMode,
        writebackTargetPath:policy.writebackTargetPath||null,
        config:{sourceBindingKey:policy.bindingKey}
      });
    }
  }

  const frozen=await freezeWorkflowTemplate(workflow.id);
  const releaseId=existingRelease[0]?.id||randomUUID();
  await db.execute(
    `INSERT INTO domain_workflow_releases
      (id,preset_key,workflow_template_id,status,readiness_json,preset_spec_sha256,
       workflow_definition_sha256,activated_at)
     VALUES (?,?,?,'FROZEN',?,?,?,CURRENT_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE workflow_template_id=VALUES(workflow_template_id),
       status='FROZEN',readiness_json=VALUES(readiness_json),
       workflow_definition_sha256=VALUES(workflow_definition_sha256),
       activated_at=CURRENT_TIMESTAMP(6)`,
    [releaseId,presetKey,workflow.id,asJson(readiness),preset.specSha256,frozen.definitionSha256]
  );

  return {
    presetKey,status:'FROZEN',workflowTemplateId:workflow.id,
    definitionSha256:frozen.definitionSha256,readiness,idempotent:false
  };
};

export const resolveDomainPresetWorkflow=async({presetKey,projectTypeKey}={})=>{
  const compiled=await compileDomainWorkflowPreset(presetKey);
  if(compiled.status!=='FROZEN') throw errorOf(
    'Domain workflow preset is not execution ready','DOMAIN_PRESET_NOT_READY',409,
    {presetKey,readiness:compiled.readiness}
  );
  const preset=await getDomainWorkflowPreset(presetKey);
  if(projectTypeKey&&preset.projectTypeKey!==projectTypeKey) throw errorOf(
    'Domain workflow preset does not match project type','DOMAIN_PRESET_PROJECT_TYPE_MISMATCH',409,
    {presetProjectTypeKey:preset.projectTypeKey,projectTypeKey}
  );
  return compiled.workflowTemplateId;
};

export const bindProjectKnowledgeSource=async({projectId,bindingKey,sourceKey,config=null}={})=>{
  if(!projectId||!bindingKey||!sourceKey) throw errorOf(
    'projectId, bindingKey and sourceKey are required','INVALID_PROJECT_KNOWLEDGE_BINDING'
  );
  const db=getRuntimePool();
  const [projects]=await db.execute('SELECT id FROM projects WHERE id=?',[projectId]);
  if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  const [sources]=await db.execute(
    'SELECT source_key,status FROM knowledge_sources WHERE source_key=?',[sourceKey]
  );
  if(!sources.length) throw errorOf('Knowledge source not found','KNOWLEDGE_SOURCE_NOT_FOUND',404);
  if(sources[0].status!=='ACTIVE') throw errorOf('Knowledge source is not active','KNOWLEDGE_SOURCE_NOT_ACTIVE',409);
  await db.execute(
    `INSERT INTO project_knowledge_bindings
      (project_id,binding_key,source_key,status,config_json)
     VALUES (?,?,?,'ACTIVE',?)
     ON DUPLICATE KEY UPDATE source_key=VALUES(source_key),status='ACTIVE',config_json=VALUES(config_json)`,
    [projectId,bindingKey,sourceKey,asJson(config)]
  );
  return {projectId,bindingKey,sourceKey,status:'ACTIVE',config};
};

export const listProjectKnowledgeBindings=async projectId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT b.*,s.provider,s.source_type,s.transport_mode
       FROM project_knowledge_bindings b
       JOIN knowledge_sources s ON s.source_key=b.source_key
      WHERE b.project_id=? ORDER BY b.binding_key`,
    [projectId]
  );
  return rows.map(row=>({
    projectId:row.project_id,bindingKey:row.binding_key,sourceKey:row.source_key,status:row.status,
    provider:row.provider,sourceType:row.source_type,transportMode:row.transport_mode,
    config:parseJson(row.config_json)
  }));
};

export const resolveProjectKnowledgeSource=async(projectId,bindingOrSourceKey)=>{
  const db=getRuntimePool();
  const [bindings]=await db.execute(
    `SELECT b.source_key,s.status AS source_status
       FROM project_knowledge_bindings b
       JOIN knowledge_sources s ON s.source_key=b.source_key
      WHERE b.project_id=? AND b.binding_key=? AND b.status='ACTIVE' LIMIT 1`,
    [projectId,bindingOrSourceKey]
  );
  if(bindings.length){
    if(bindings[0].source_status!=='ACTIVE') throw errorOf(
      'Bound knowledge source is not active','KNOWLEDGE_SOURCE_NOT_ACTIVE',409
    );
    return bindings[0].source_key;
  }
  const [sources]=await db.execute(
    'SELECT source_key,status FROM knowledge_sources WHERE source_key=?',[bindingOrSourceKey]
  );
  if(sources.length&&sources[0].status==='ACTIVE') return sources[0].source_key;
  throw errorOf(
    'Project knowledge binding is missing','PROJECT_KNOWLEDGE_BINDING_MISSING',409,
    {projectId,bindingKey:bindingOrSourceKey}
  );
};
