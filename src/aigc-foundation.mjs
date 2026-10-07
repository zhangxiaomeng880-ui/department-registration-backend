import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const REQUIRED_MILESTONES=['AG-M0','AG-M1','AG-M2','AG-M3','AG-M4','AG-M5','AG-M6','AG-M7','AG-M8','AG-M9'];
const ALLOWED_REFERENCE_RIGHTS=new Set(['CLEARED','ALLOWED','LIMITED']);
const HYPOTHESIS_TYPES=new Set(['CONTENT_FORM','HOOK','DISTRIBUTION','FORMAT','PRODUCTION']);
const CONFIDENCE_LEVELS=new Set(['LOW','MEDIUM','HIGH']);

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{
  if(v==null)return null;
  if(typeof v==='object')return v;
  try{return JSON.parse(v);}catch{return null;}
};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const sameSet=(a,b)=>{
  const aa=[...new Set(a||[])].sort(),bb=[...new Set(b||[])].sort();
  return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);
};
const validDate=value=>{
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE',400,{value});
  return d;
};
const loadAigcProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC domain requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO aigc_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};
const requireObjectKeys=(obj,keys,code)=>{
  if(!obj||typeof obj!=='object')throw errorOf('Structured object is required',code,400,{keys});
  const missing=keys.filter(k=>obj[k]===undefined||obj[k]===null||obj[k]==='');
  if(missing.length)throw errorOf('Structured fields are missing',code,400,{missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

export const resolveAigcProjectScope=async projectId=>{
  const p=await loadAigcProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const listAigcModules=async()=>{
  const db=getRuntimePool();
  const rows=await listRows(db,'SELECT * FROM aigc_module_registry WHERE status=\'ACTIVE\' ORDER BY sort_order,module_key');
  return rows.map(x=>({
    moduleKey:x.module_key,displayName:x.display_name,stageKey:x.stage_key,
    sortOrder:Number(x.sort_order),status:x.status,description:x.description||null
  }));
};

export const listAigcUiLabels=async()=>{
  const db=getRuntimePool();
  const rows=await listRows(db,'SELECT * FROM aigc_ui_labels WHERE status=\'ACTIVE\' ORDER BY label_type,stable_key');
  return rows.map(x=>({labelType:x.label_type,stableKey:x.stable_key,displayName:x.display_name}));
};

export const createAigcInitialization=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'initializationKey','workTitle','targetAudience','roles','knowledgeSources','assetStorage',
    'capabilityEnvironment','budgetGuardrail','timelineStrategy','rightsBoundary',
    'formatDelivery','backupArchive','evidence'
  ],'INVALID_AIGC_INITIALIZATION');
  if(!Array.isArray(input.knowledgeSources)||!input.knowledgeSources.length)throw errorOf(
    'AIGC initialization requires knowledge sources','AIGC_KNOWLEDGE_SOURCE_REQUIRED',409
  );
  requireObjectKeys(input.roles,['owner','creativeLead','productionLead','reviewer'],'AIGC_ROLES_INCOMPLETE');
  requireObjectKeys(input.capabilityEnvironment,['models','tools','connections','credentialBoundary'],'AIGC_CAPABILITY_ENVIRONMENT_INCOMPLETE');
  requireObjectKeys(input.rightsBoundary,['copyright','likeness','music','font','brand','aiDisclosure'],'AIGC_RIGHTS_BOUNDARY_INCOMPLETE');
  requireObjectKeys(input.formatDelivery,['masterFormat','workingFormat','deliveryFormats'],'AIGC_FORMAT_DELIVERY_INCOMPLETE');
  requireObjectKeys(input.backupArchive,['backup','export','archive'],'AIGC_BACKUP_ARCHIVE_INCOMPLETE');
  const maxSpend=Number(input.budgetGuardrail.maxSpend);
  if(!Number.isFinite(maxSpend)||maxSpend<0||!input.budgetGuardrail.currency)throw errorOf(
    'Budget guardrail requires non-negative maxSpend and currency','AIGC_BUDGET_GUARDRAIL_INVALID',409
  );
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_project_initializations
      (id,project_id,initialization_key,work_title,target_audience_json,roles_json,knowledge_sources_json,
       asset_storage_json,capability_environment_json,budget_guardrail_json,timeline_strategy_json,
       rights_boundary_json,format_delivery_json,backup_archive_json,status,evidence_json,
       initialized_by_identity_id,initialized_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'FROZEN',?,?,?)`,
    [id,projectId,input.initializationKey,input.workTitle,asJson(input.targetAudience),asJson(input.roles),
     asJson(input.knowledgeSources),asJson(input.assetStorage),asJson(input.capabilityEnvironment),
     asJson(input.budgetGuardrail),asJson(input.timelineStrategy),asJson(input.rightsBoundary),
     asJson(input.formatDelivery),asJson(input.backupArchive),asJson(input.evidence),actorId,
     input.initializedAt?validDate(input.initializedAt):new Date()]
  );
  return {id,projectId,initializationKey:input.initializationKey,workTitle:input.workTitle,status:'FROZEN'};
};

export const createAigcMarketBenchmark=async(projectId,input={})=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'benchmarkKey','platform','marketRegion','categoryFormat','workCreatorAccount',
    'snapshotDate','freshUntil','observablePerformance','releaseCadence','audiencePositioning',
    'structureHook','sourceEvidence','insight','limitation'
  ],'INVALID_AIGC_MARKET_BENCHMARK');
  const snapshot=validDate(input.snapshotDate),fresh=validDate(input.freshUntil);
  if(fresh<snapshot)throw errorOf('freshUntil cannot precede snapshotDate','AIGC_BENCHMARK_FRESHNESS_INVALID',409);
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_market_benchmarks
      (id,project_id,benchmark_key,platform,market_region,category_format,work_creator_account_json,
       publish_date,snapshot_date,fresh_until,observable_performance_json,release_cadence_json,
       audience_positioning_json,structure_hook_json,source_evidence_json,insight_json,limitation_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT')`,
    [id,projectId,input.benchmarkKey,input.platform,input.marketRegion,input.categoryFormat,
     asJson(input.workCreatorAccount),input.publishDate||null,input.snapshotDate,input.freshUntil,
     asJson(input.observablePerformance),asJson(input.releaseCadence),asJson(input.audiencePositioning),
     asJson(input.structureHook),asJson(input.sourceEvidence),asJson(input.insight),asJson(input.limitation)]
  );
  return {id,projectId,benchmarkKey:input.benchmarkKey,status:'CURRENT',freshUntil:input.freshUntil};
};

export const createAigcCreativeReference=async(projectId,input={})=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'referenceKey','source','rightsStatus','referenceRoles','allowedUsage',
    'forbiddenCopying','attributionProvenance'
  ],'INVALID_AIGC_CREATIVE_REFERENCE');
  const rightsStatus=upper(input.rightsStatus);
  if(!['CLEARED','ALLOWED','LIMITED','UNKNOWN','PROHIBITED'].includes(rightsStatus))
    throw errorOf('Unsupported reference rights status','AIGC_REFERENCE_RIGHTS_INVALID',409,{rightsStatus});
  if(!Array.isArray(input.referenceRoles)||!input.referenceRoles.length)throw errorOf(
    'Creative Reference requires explicit reference roles','AIGC_REFERENCE_ROLE_REQUIRED',409
  );
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_creative_references
      (id,project_id,reference_key,source_json,rights_status,reference_roles_json,
       allowed_usage_json,forbidden_copying_json,attribution_provenance_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,'CURRENT')`,
    [id,projectId,input.referenceKey,asJson(input.source),rightsStatus,asJson(input.referenceRoles),
     asJson(input.allowedUsage),asJson(input.forbiddenCopying),asJson(input.attributionProvenance)]
  );
  return {id,projectId,referenceKey:input.referenceKey,rightsStatus,status:'CURRENT'};
};

export const createAigcModelToolBenchmark=async(projectId,input={})=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'benchmarkKey','provider','modelTool','modelToolVersion','capability','supportedReferenceTypes',
    'outputLimits','controllability','apiBatchQueue','costLatencyReliability',
    'rightsTermsDisclosure','evalDate','freshUntil','evidence'
  ],'INVALID_AIGC_MODEL_TOOL_BENCHMARK');
  const evalDate=validDate(input.evalDate),fresh=validDate(input.freshUntil);
  if(fresh<evalDate)throw errorOf('freshUntil cannot precede evalDate','AIGC_MODEL_BENCHMARK_FRESHNESS_INVALID',409);
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_model_tool_benchmarks
      (id,project_id,benchmark_key,provider,model_tool,model_tool_version,capability_json,
       supported_reference_types_json,output_limits_json,controllability_json,api_batch_queue_json,
       cost_latency_reliability_json,rights_terms_disclosure_json,eval_date,fresh_until,evidence_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT')`,
    [id,projectId,input.benchmarkKey,input.provider,input.modelTool,input.modelToolVersion,
     asJson(input.capability),asJson(input.supportedReferenceTypes),asJson(input.outputLimits),
     asJson(input.controllability),asJson(input.apiBatchQueue),asJson(input.costLatencyReliability),
     asJson(input.rightsTermsDisclosure),input.evalDate,input.freshUntil,asJson(input.evidence)]
  );
  return {id,projectId,benchmarkKey:input.benchmarkKey,status:'CURRENT',freshUntil:input.freshUntil};
};

const loadIds=async(db,table,ids,projectId)=>{
  if(!Array.isArray(ids)||!ids.length)return [];
  const placeholders=ids.map(()=>'?').join(',');
  return listRows(db,`SELECT id FROM ${table} WHERE project_id=? AND id IN (${placeholders})`,[projectId,...ids]);
};

export const createAigcCreativeHypothesis=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'hypothesisKey','hypothesisType','statement','benchmarkIds','creativeReferenceIds',
    'modelToolBenchmarkIds','unknowns','confidence','decision','evidence'
  ],'INVALID_AIGC_CREATIVE_HYPOTHESIS');
  const hypothesisType=upper(input.hypothesisType),confidence=upper(input.confidence);
  if(!HYPOTHESIS_TYPES.has(hypothesisType))throw errorOf('Unsupported AIGC hypothesis type','AIGC_HYPOTHESIS_TYPE_INVALID',409);
  if(!CONFIDENCE_LEVELS.has(confidence))throw errorOf('Unsupported confidence','AIGC_HYPOTHESIS_CONFIDENCE_INVALID',409);
  if(input.storyFactMutation===true)throw errorOf(
    'Creative hypothesis cannot mutate Story Fact','AIGC_HYPOTHESIS_STORY_FACT_MUTATION_FORBIDDEN',409
  );
  const db=getRuntimePool();
  const [markets,refs,models]=await Promise.all([
    loadIds(db,'aigc_market_benchmarks',input.benchmarkIds,projectId),
    loadIds(db,'aigc_creative_references',input.creativeReferenceIds,projectId),
    loadIds(db,'aigc_model_tool_benchmarks',input.modelToolBenchmarkIds,projectId)
  ]);
  if(markets.length!==new Set(input.benchmarkIds).size)throw errorOf('Market benchmark linkage invalid','AIGC_HYPOTHESIS_MARKET_LINK_INVALID',409);
  if(refs.length!==new Set(input.creativeReferenceIds).size)throw errorOf('Creative reference linkage invalid','AIGC_HYPOTHESIS_REFERENCE_LINK_INVALID',409);
  if(models.length!==new Set(input.modelToolBenchmarkIds).size)throw errorOf('Model/tool benchmark linkage invalid','AIGC_HYPOTHESIS_MODEL_LINK_INVALID',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_creative_hypotheses
      (id,project_id,hypothesis_key,hypothesis_type,statement,benchmark_ids_json,
       creative_reference_ids_json,model_tool_benchmark_ids_json,unknowns_json,confidence,
       story_fact_mutation,decision_json,evidence_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,FALSE,?,?,'APPROVED')`,
    [id,projectId,input.hypothesisKey,hypothesisType,input.statement,asJson(input.benchmarkIds),
     asJson(input.creativeReferenceIds),asJson(input.modelToolBenchmarkIds),asJson(input.unknowns),
     confidence,asJson(input.decision),asJson(input.evidence)]
  );
  for(const sourceId of input.benchmarkIds)await insertTrace(db,{projectId,sourceType:'MARKET_BENCHMARK',sourceId,
    targetType:'CREATIVE_HYPOTHESIS',targetId:id,linkType:'SUPPORTS',actorId,evidence:{hypothesisType}});
  for(const sourceId of input.creativeReferenceIds)await insertTrace(db,{projectId,sourceType:'CREATIVE_REFERENCE',sourceId,
    targetType:'CREATIVE_HYPOTHESIS',targetId:id,linkType:'INFORMS',actorId,evidence:{hypothesisType}});
  for(const sourceId of input.modelToolBenchmarkIds)await insertTrace(db,{projectId,sourceType:'MODEL_TOOL_BENCHMARK',sourceId,
    targetType:'CREATIVE_HYPOTHESIS',targetId:id,linkType:'CONSTRAINS',actorId,evidence:{hypothesisType}});
  return {id,projectId,hypothesisKey:input.hypothesisKey,hypothesisType,confidence,status:'APPROVED'};
};

export const createAigcProductionPlan=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'planKey','projectHierarchy','milestoneKeys','workBreakdown','productionOrder','dependency',
    'assetCoveragePlan','modelToolStrategy','budgetAllocation','batchQueueConcurrency',
    'humanReviewPoints','versionStrategy','localizationCandidates','evidence'
  ],'INVALID_AIGC_PRODUCTION_PLAN');
  if(!sameSet(input.milestoneKeys,REQUIRED_MILESTONES))throw errorOf(
    'AIGC plan must cover AG-M0 through AG-M9','AIGC_PLAN_MILESTONE_COVERAGE_INVALID',409,
    {required:REQUIRED_MILESTONES,actual:input.milestoneKeys}
  );
  requireObjectKeys(input.projectHierarchy,['project','version','unit','scene','shot'],'AIGC_PLAN_HIERARCHY_INCOMPLETE');
  requireObjectKeys(input.budgetAllocation,['currency','total','byStage'],'AIGC_PLAN_BUDGET_INCOMPLETE');
  if(Number(input.budgetAllocation.total)<0)throw errorOf('AIGC plan budget cannot be negative','AIGC_PLAN_BUDGET_INVALID',409);
  const db=getRuntimePool();
  const [milestones]=await db.execute(
    'SELECT milestone_key FROM project_milestones WHERE project_id=? ORDER BY sequence_no',[projectId]
  );
  if(!sameSet(milestones.map(x=>x.milestone_key),REQUIRED_MILESTONES))throw errorOf(
    'Project lifecycle milestones do not match AIGC standard','AIGC_PROJECT_MILESTONES_INCOMPLETE',409
  );
  const [hypotheses]=await db.execute(
    "SELECT id FROM aigc_creative_hypotheses WHERE project_id=? AND status='APPROVED'",[projectId]
  );
  if(!hypotheses.length)throw errorOf('Approved creative hypothesis is required before planning','AIGC_PLAN_HYPOTHESIS_REQUIRED',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_production_plans
      (id,project_id,plan_key,project_hierarchy_json,milestone_keys_json,work_breakdown_json,
       production_order_json,dependency_json,asset_coverage_plan_json,model_tool_strategy_json,
       budget_allocation_json,batch_queue_concurrency_json,human_review_points_json,
       version_strategy_json,localization_candidates_json,evidence_json,status,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?)`,
    [id,projectId,input.planKey,asJson(input.projectHierarchy),asJson(input.milestoneKeys),
     asJson(input.workBreakdown),asJson(input.productionOrder),asJson(input.dependency),
     asJson(input.assetCoveragePlan),asJson(input.modelToolStrategy),asJson(input.budgetAllocation),
     asJson(input.batchQueueConcurrency),asJson(input.humanReviewPoints),asJson(input.versionStrategy),
     asJson(input.localizationCandidates),asJson(input.evidence),actorId]
  );
  for(const h of hypotheses)await insertTrace(db,{projectId,sourceType:'CREATIVE_HYPOTHESIS',sourceId:h.id,
    targetType:'PRODUCTION_PLAN',targetId:id,linkType:'PLANS_FROM',actorId,evidence:{planKey:input.planKey}});
  return {id,projectId,planKey:input.planKey,status:'FROZEN'};
};

const persistGate=async(db,result,actorId)=>{
  await db.execute(
    `INSERT INTO aigc_m281_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),result.projectId,result.gateKey,result.status,asJson(result.reasonCodes),
     asJson(result.evidenceSnapshot),result.asOf,actorId]
  );
};

export const evaluateAigcFoundationGate=async(projectId,gateKey,input={},actorId=null)=>{
  const project=await loadAigcProject(projectId);
  const asOf=input.asOf?validDate(input.asOf):new Date();
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};

  const [inits]=await db.execute(
    "SELECT * FROM aigc_project_initializations WHERE project_id=? AND status='FROZEN' ORDER BY initialized_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const init=inits[0]||null;
  evidence.initializationId=init?.id||null;
  if(!init)reasons.push('AIGC_INITIALIZATION_REQUIRED');

  if(gateKey==='G-AIGC-INIT'){
    if(init){
      const rights=parseJson(init.rights_boundary_json)||{};
      for(const k of ['copyright','likeness','music','font','brand','aiDisclosure']){
        if(rights[k]===undefined||rights[k]===null||rights[k]==='')reasons.push('AIGC_RIGHTS_BOUNDARY_INCOMPLETE:'+k);
      }
      const sources=parseJson(init.knowledge_sources_json)||[];
      if(!sources.length)reasons.push('AIGC_KNOWLEDGE_SOURCE_REQUIRED');
    }
  }else if(gateKey==='G-AIGC-DISCOVERY'||gateKey==='G-AIGC-PLAN'){
    const initGate=await evaluateAigcFoundationGate(projectId,'G-AIGC-INIT',{asOf,persist:false},actorId);
    if(initGate.status!=='PASS')reasons.push('G_AIGC_INIT_NOT_PASS');
    const [markets,refs,models,hypotheses]=await Promise.all([
      listRows(db,"SELECT * FROM aigc_market_benchmarks WHERE project_id=? AND status='CURRENT'",[projectId]),
      listRows(db,"SELECT * FROM aigc_creative_references WHERE project_id=? AND status='CURRENT'",[projectId]),
      listRows(db,"SELECT * FROM aigc_model_tool_benchmarks WHERE project_id=? AND status='CURRENT'",[projectId]),
      listRows(db,"SELECT * FROM aigc_creative_hypotheses WHERE project_id=? AND status='APPROVED'",[projectId])
    ]);
    evidence.marketBenchmarkIds=markets.map(x=>x.id);
    evidence.creativeReferenceIds=refs.map(x=>x.id);
    evidence.modelToolBenchmarkIds=models.map(x=>x.id);
    evidence.creativeHypothesisIds=hypotheses.map(x=>x.id);
    if(!markets.length)reasons.push('AIGC_MARKET_BENCHMARK_REQUIRED');
    if(markets.some(x=>new Date(x.fresh_until)<asOf))reasons.push('AIGC_MARKET_BENCHMARK_STALE');
    if(!refs.length)reasons.push('AIGC_CREATIVE_REFERENCE_REQUIRED');
    if(refs.some(x=>!ALLOWED_REFERENCE_RIGHTS.has(x.rights_status)))reasons.push('AIGC_CREATIVE_REFERENCE_RIGHTS_BLOCKED');
    if(!models.length)reasons.push('AIGC_MODEL_TOOL_BENCHMARK_REQUIRED');
    if(models.some(x=>new Date(x.fresh_until)<asOf))reasons.push('AIGC_MODEL_TOOL_BENCHMARK_STALE');
    if(!hypotheses.length)reasons.push('AIGC_CREATIVE_HYPOTHESIS_REQUIRED');
    if(hypotheses.some(x=>Boolean(x.story_fact_mutation)))reasons.push('AIGC_HYPOTHESIS_STORY_FACT_MUTATION_FORBIDDEN');

    if(gateKey==='G-AIGC-PLAN'){
      const discoveryGate=await evaluateAigcFoundationGate(projectId,'G-AIGC-DISCOVERY',{asOf,persist:false},actorId);
      if(discoveryGate.status!=='PASS')reasons.push('G_AIGC_DISCOVERY_NOT_PASS');
      const [plans]=await db.execute(
        "SELECT * FROM aigc_production_plans WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",
        [projectId]
      );
      const plan=plans[0]||null;
      evidence.productionPlanId=plan?.id||null;
      if(!plan)reasons.push('AIGC_PRODUCTION_PLAN_REQUIRED');
      else{
        const milestoneKeys=parseJson(plan.milestone_keys_json)||[];
        if(!sameSet(milestoneKeys,REQUIRED_MILESTONES))reasons.push('AIGC_PLAN_MILESTONE_COVERAGE_INVALID');
        const [projectMilestones]=await db.execute(
          'SELECT milestone_key,display_name FROM project_milestones WHERE project_id=? ORDER BY sequence_no',[projectId]
        );
        evidence.milestoneKeys=projectMilestones.map(x=>x.milestone_key);
        evidence.milestoneDisplayNames=projectMilestones.map(x=>x.display_name);
        if(!sameSet(projectMilestones.map(x=>x.milestone_key),REQUIRED_MILESTONES))
          reasons.push('AIGC_PROJECT_MILESTONES_INCOMPLETE');
        if(projectMilestones.some(x=>!/[\u4e00-\u9fff]/.test(x.display_name)))
          reasons.push('AIGC_FRONTEND_MILESTONE_LABEL_NOT_CHINESE');
      }
    }
  }else{
    throw errorOf('Unsupported M28.1 gate','INVALID_AIGC_FOUNDATION_GATE',400,{gateKey});
  }

  const result={projectId,gateKey,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await persistGate(db,result,actorId);
  return result;
};

export const getAigcFoundationState=async projectId=>{
  const project=await loadAigcProject(projectId);
  const db=getRuntimePool();
  const [modules,uiLabels,inits,markets,refs,models,hypotheses,plans,traces,gates,milestones,stages]=await Promise.all([
    listAigcModules(),listAigcUiLabels(),
    listRows(db,'SELECT * FROM aigc_project_initializations WHERE project_id=? ORDER BY initialized_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_market_benchmarks WHERE project_id=? ORDER BY snapshot_date,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_creative_references WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_model_tool_benchmarks WHERE project_id=? ORDER BY eval_date,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_creative_hypotheses WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_plans WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_trace_links WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m281_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]),
    listRows(db,'SELECT milestone_key,display_name,sequence_no,status FROM project_milestones WHERE project_id=? ORDER BY sequence_no',[projectId]),
    listRows(db,'SELECT stage_key,display_name,sequence_no,status,gate_policy_key FROM project_stage_instances WHERE project_id=? ORDER BY sequence_no',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type,
      projectSubtypeKey:project.project_subtype_key},
    frontend:{language:'zh-CN',modules,uiLabels,
      milestones:milestones.map(x=>({milestoneKey:x.milestone_key,displayName:x.display_name,sequenceNo:Number(x.sequence_no),status:x.status})),
      stages:stages.map(x=>({stageKey:x.stage_key,displayName:x.display_name,sequenceNo:Number(x.sequence_no),status:x.status,gateKey:x.gate_policy_key||null}))},
    initializations:inits.map(x=>({id:x.id,initializationKey:x.initialization_key,workTitle:x.work_title,status:x.status,
      targetAudience:parseJson(x.target_audience_json),roles:parseJson(x.roles_json),knowledgeSources:parseJson(x.knowledge_sources_json),
      budgetGuardrail:parseJson(x.budget_guardrail_json),rightsBoundary:parseJson(x.rights_boundary_json)})),
    marketBenchmarks:markets.map(x=>({id:x.id,benchmarkKey:x.benchmark_key,platform:x.platform,marketRegion:x.market_region,
      categoryFormat:x.category_format,snapshotDate:x.snapshot_date,freshUntil:x.fresh_until,status:x.status})),
    creativeReferences:refs.map(x=>({id:x.id,referenceKey:x.reference_key,rightsStatus:x.rights_status,
      referenceRoles:parseJson(x.reference_roles_json),status:x.status})),
    modelToolBenchmarks:models.map(x=>({id:x.id,benchmarkKey:x.benchmark_key,provider:x.provider,
      modelTool:x.model_tool,modelToolVersion:x.model_tool_version,evalDate:x.eval_date,freshUntil:x.fresh_until,status:x.status})),
    creativeHypotheses:hypotheses.map(x=>({id:x.id,hypothesisKey:x.hypothesis_key,hypothesisType:x.hypothesis_type,
      statement:x.statement,confidence:x.confidence,storyFactMutation:Boolean(x.story_fact_mutation),status:x.status})),
    productionPlans:plans.map(x=>({id:x.id,planKey:x.plan_key,status:x.status,
      projectHierarchy:parseJson(x.project_hierarchy_json),milestoneKeys:parseJson(x.milestone_keys_json),
      budgetAllocation:parseJson(x.budget_allocation_json),versionStrategy:parseJson(x.version_strategy_json)})),
    traces:traces.map(x=>({id:x.id,sourceType:x.source_type,sourceId:x.source_id,targetType:x.target_type,
      targetId:x.target_id,linkType:x.link_type,evidence:parseJson(x.evidence_json)})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
