import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateReleaseGate } from './product-release-rollout.mjs';
import { getPostReleaseOperationsState } from './product-post-release-incident.mjs';

const GATE='G-PD-OUTCOME';
const METRIC_TYPES=new Set(['PRIMARY','GUARDRAIL','KPI','FUNNEL','RETENTION','CONVERSION','RELIABILITY']);
const DIRECTIONS=new Set(['HIGHER_BETTER','LOWER_BETTER','NEUTRAL']);
const DATA_QUALITY=new Set(['PASS','WARN','FAIL']);
const FEEDBACK_SOURCES=new Set(['USER','OPERATIONS','SUPPORT','INCIDENT']);
const FEEDBACK_SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const EXPERIMENT_DECISIONS=new Set(['SHIP','ITERATE','STOP','ROLLBACK','NO_CHANGE']);
const OUTCOME_DECISIONS=new Set(['SCALE','ITERATE','ROLLBACK','HOLD','NO_CHANGE']);

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

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_type FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Product Outcome requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const loadMetric=async(id,db)=>{
  const [rows]=await db.execute('SELECT * FROM product_outcome_metrics WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Outcome Metric not found','OUTCOME_METRIC_NOT_FOUND',404);
  return rows[0];
};
const loadRollout=async(id,db)=>{
  const [rows]=await db.execute('SELECT * FROM product_release_rollouts WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
  return rows[0];
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};

export const resolveOutcomeProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};
export const resolveFeedbackScope=async feedbackId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT f.id,f.project_id,p.workspace_id FROM product_feedback_signals f
      JOIN projects p ON p.id=f.project_id WHERE f.id=?`,[feedbackId]
  );
  if(!rows.length)throw errorOf('Feedback Signal not found','FEEDBACK_NOT_FOUND',404);
  return {feedbackId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveExperimentScope=async experimentId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT e.id,e.project_id,p.workspace_id FROM product_experiments e
      JOIN projects p ON p.id=e.project_id WHERE e.id=?`,[experimentId]
  );
  if(!rows.length)throw errorOf('Experiment not found','EXPERIMENT_NOT_FOUND',404);
  return {experimentId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createOutcomeMetric=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'metricKey','displayName','metricType','unit','aggregation','direction',
    'source','instrumentationRef'
  ],'INVALID_OUTCOME_METRIC');
  const metricType=upper(input.metricType),direction=upper(input.direction);
  if(!METRIC_TYPES.has(metricType))throw errorOf('Unsupported metric type','INVALID_OUTCOME_METRIC_TYPE',409,{metricType});
  if(!DIRECTIONS.has(direction))throw errorOf('Unsupported metric direction','INVALID_OUTCOME_METRIC_DIRECTION',409,{direction});
  const db=getRuntimePool();
  if(input.ownerIdentityId){
    const [owners]=await db.execute('SELECT id FROM identities WHERE id=?',[input.ownerIdentityId]);
    if(!owners.length)throw errorOf('Metric owner not found','OUTCOME_METRIC_OWNER_NOT_FOUND',404);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_outcome_metrics
      (id,project_id,metric_key,display_name,metric_type,unit,aggregation,direction,
       target_json,source_json,instrumentation_ref_json,owner_identity_id,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE')`,
    [id,projectId,input.metricKey,input.displayName,metricType,input.unit,upper(input.aggregation),direction,
     asJson(input.target||null),asJson(input.source),asJson(input.instrumentationRef),input.ownerIdentityId||actorId||null]
  );
  return {id,projectId,metricKey:input.metricKey,displayName:input.displayName,metricType,direction,status:'ACTIVE'};
};

export const createOutcomeObservation=async(projectId,input={})=>{
  await loadProject(projectId);
  requireFields(input,[
    'metricId','releaseRolloutId','observationKey','windowStart','windowEnd',
    'value','sampleSize','dataQualityStatus','dataQuality','evidence'
  ],'INVALID_OUTCOME_OBSERVATION');
  const db=getRuntimePool(),metric=await loadMetric(input.metricId,db),rollout=await loadRollout(input.releaseRolloutId,db);
  if(metric.project_id!==projectId||rollout.project_id!==projectId)throw errorOf(
    'Outcome observation scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409
  );
  if(!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))throw errorOf(
    'Outcome observation requires released rollout','OUTCOME_ROLLOUT_NOT_RELEASED',409
  );
  const start=new Date(input.windowStart),end=new Date(input.windowEnd);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)throw errorOf(
    'Observation window must be valid and increasing','INVALID_OUTCOME_WINDOW',409
  );
  const sampleSize=Number(input.sampleSize);
  if(!Number.isInteger(sampleSize)||sampleSize<=0)throw errorOf('Observation sampleSize must be positive integer','INVALID_OUTCOME_SAMPLE',409);
  const dq=upper(input.dataQualityStatus);
  if(!DATA_QUALITY.has(dq))throw errorOf('Unsupported data quality status','INVALID_DATA_QUALITY_STATUS',409);
  if(dq!=='PASS'&&!nonEmpty(input.dataQuality.rationale))throw errorOf(
    'WARN/FAIL data quality requires rationale','DATA_QUALITY_RATIONALE_REQUIRED',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_outcome_observations
      (id,project_id,metric_id,release_rollout_id,observation_key,window_start,window_end,
       value_json,sample_size,data_quality_status,data_quality_json,evidence_json,observed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,metric.id,rollout.id,input.observationKey,start,end,asJson(input.value),sampleSize,dq,
     asJson(input.dataQuality),asJson(input.evidence),input.observedAt?new Date(input.observedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'RELEASE_ROLLOUT',sourceId:rollout.id,
    targetType:'OUTCOME_OBSERVATION',targetId:id,linkType:'MEASURED_BY',evidence:{metricId:metric.id,metricType:metric.metric_type},actorId:null});
  return {id,projectId,metricId:metric.id,releaseRolloutId:rollout.id,observationKey:input.observationKey,
    metricType:metric.metric_type,dataQualityStatus:dq,sampleSize};
};

export const createProductExperiment=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','experimentKey','title','hypothesis','control','treatment','population',
    'primaryMetricId','guardrailMetricIds','plannedSample','timeWindow','evidence'
  ],'INVALID_PRODUCT_EXPERIMENT');
  if(!Array.isArray(input.guardrailMetricIds)||!input.guardrailMetricIds.length)throw errorOf(
    'Experiment requires guardrail metrics','EXPERIMENT_GUARDRAIL_REQUIRED',409
  );
  const db=getRuntimePool(),rollout=await loadRollout(input.releaseRolloutId,db);
  if(rollout.project_id!==projectId||!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))throw errorOf(
    'Experiment requires released rollout in same project','EXPERIMENT_RELEASE_SCOPE_INVALID',409
  );
  const primary=await loadMetric(input.primaryMetricId,db);
  if(primary.project_id!==projectId||primary.metric_type!=='PRIMARY')throw errorOf(
    'Experiment primary metric must be PRIMARY metric in same project','EXPERIMENT_PRIMARY_METRIC_INVALID',409
  );
  const ids=[...new Set(input.guardrailMetricIds)];
  const placeholders=ids.map(()=>'?').join(',');
  const [guards]=await db.execute(
    `SELECT id,metric_type FROM product_outcome_metrics WHERE project_id=? AND id IN (${placeholders})`,
    [projectId,...ids]
  );
  if(guards.length!==ids.length||guards.some(x=>!['GUARDRAIL','RELIABILITY'].includes(x.metric_type)))throw errorOf(
    'Experiment guardrail metrics must be GUARDRAIL/RELIABILITY metrics in same project',
    'EXPERIMENT_GUARDRAIL_METRIC_INVALID',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_experiments
      (id,project_id,release_rollout_id,experiment_key,title,hypothesis_json,control_json,treatment_json,
       population_json,primary_metric_id,guardrail_metric_ids_json,planned_sample_json,time_window_json,
       status,evidence_json,owner_identity_id,started_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'RUNNING',?,?,?)`,
    [id,projectId,rollout.id,input.experimentKey,input.title,asJson(input.hypothesis),asJson(input.control),
     asJson(input.treatment),asJson(input.population),primary.id,asJson(ids),asJson(input.plannedSample),
     asJson(input.timeWindow),asJson(input.evidence),input.ownerIdentityId||actorId||null,
     input.startedAt?new Date(input.startedAt):new Date()]
  );
  return {id,projectId,releaseRolloutId:rollout.id,experimentKey:input.experimentKey,status:'RUNNING'};
};

export const completeProductExperiment=async(experimentId,input={},actorId=null)=>{
  requireFields(input,['actualSample','srm','result','confidence','decision','evidence'],'INVALID_EXPERIMENT_RESULT');
  const decisionType=upper(input.decision.type);
  if(!EXPERIMENT_DECISIONS.has(decisionType))throw errorOf('Unsupported experiment decision','INVALID_EXPERIMENT_DECISION',409,{decisionType});
  if(upper(input.srm.status)!=='PASS')throw errorOf(
    'Experiment cannot complete with SRM failure','EXPERIMENT_SRM_NOT_PASS',409
  );
  if(!Number.isFinite(Number(input.actualSample.total))||Number(input.actualSample.total)<=0)throw errorOf(
    'Experiment actual sample total must be positive','INVALID_EXPERIMENT_SAMPLE',409
  );
  if(!Number.isFinite(Number(input.confidence.level))||Number(input.confidence.level)<=0||
     Number(input.confidence.level)>1)throw errorOf('Experiment confidence level must be in (0,1]','INVALID_EXPERIMENT_CONFIDENCE',409);
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM product_experiments WHERE id=?',[experimentId]);
  if(!rows.length)throw errorOf('Experiment not found','EXPERIMENT_NOT_FOUND',404);
  const exp=rows[0];
  if(exp.status!=='RUNNING')throw errorOf('Only RUNNING experiment can complete','EXPERIMENT_STATE_INVALID',409,{status:exp.status});
  await db.execute(
    `UPDATE product_experiments SET status='COMPLETED',actual_sample_json=?,srm_json=?,result_json=?,
       confidence_json=?,decision_json=?,evidence_json=?,completed_at=? WHERE id=?`,
    [asJson(input.actualSample),asJson(input.srm),asJson(input.result),
     asJson({...input.confidence}),asJson({...input.decision,type:decisionType}),asJson(input.evidence),
     input.completedAt?new Date(input.completedAt):new Date(),experimentId]
  );
  await insertTrace(db,{projectId:exp.project_id,sourceType:'EXPERIMENT',sourceId:experimentId,
    targetType:'RELEASE_ROLLOUT',targetId:exp.release_rollout_id,linkType:'MEASURES_OUTCOME_FOR',
    evidence:{decision:decisionType},actorId});
  return {id:experimentId,projectId:exp.project_id,status:'COMPLETED',decisionType};
};

export const createFeedbackSignal=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','feedbackKey','sourceType','sourceRef','summary','severity','evidence'
  ],'INVALID_FEEDBACK_SIGNAL');
  const sourceType=upper(input.sourceType),severity=upper(input.severity);
  if(!FEEDBACK_SOURCES.has(sourceType))throw errorOf('Unsupported feedback source','INVALID_FEEDBACK_SOURCE',409);
  if(!FEEDBACK_SEVERITIES.has(severity))throw errorOf('Unsupported feedback severity','INVALID_FEEDBACK_SEVERITY',409);
  const db=getRuntimePool(),rollout=await loadRollout(input.releaseRolloutId,db);
  if(rollout.project_id!==projectId||!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))throw errorOf(
    'Feedback requires released rollout in same project','FEEDBACK_RELEASE_SCOPE_INVALID',409
  );
  if(sourceType==='INCIDENT'){
    const incidentId=input.sourceRef.incidentId;
    if(!incidentId)throw errorOf('INCIDENT feedback requires incidentId','FEEDBACK_INCIDENT_REF_REQUIRED',409);
    const [incidents]=await db.execute('SELECT id FROM product_incidents WHERE id=? AND project_id=? AND release_rollout_id=?',
      [incidentId,projectId,rollout.id]);
    if(!incidents.length)throw errorOf('Feedback incident reference not found in rollout','FEEDBACK_INCIDENT_REF_INVALID',409);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_feedback_signals
      (id,project_id,release_rollout_id,feedback_key,source_type,source_ref_json,summary,severity,status,
       evidence_json,owner_identity_id,collected_at)
     VALUES (?,?,?,?,?,?,?,?, 'COLLECTED',?,?,?)`,
    [id,projectId,rollout.id,input.feedbackKey,sourceType,asJson(input.sourceRef),input.summary,severity,
     asJson(input.evidence),input.ownerIdentityId||actorId||null,input.collectedAt?new Date(input.collectedAt):new Date()]
  );
  return {id,projectId,releaseRolloutId:rollout.id,feedbackKey:input.feedbackKey,sourceType,severity,status:'COLLECTED'};
};

export const decideFeedbackSignal=async(feedbackId,input={},actorId=null)=>{
  requireFields(input,['triage','insight','problemOpportunity','decision','action'],'INVALID_FEEDBACK_DECISION');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM product_feedback_signals WHERE id=?',[feedbackId]);
  if(!rows.length)throw errorOf('Feedback Signal not found','FEEDBACK_NOT_FOUND',404);
  const feedback=rows[0];
  if(feedback.status!=='COLLECTED')throw errorOf('Only COLLECTED feedback can be decided','FEEDBACK_STATE_INVALID',409,{status:feedback.status});
  const actionType=upper(input.action.type);
  let targetId=null;
  if(actionType==='WORK_ITEM'){
    requireFields(input.action,['itemKey','itemType','title','priority','acceptanceCriteria','evidence'],'INVALID_FEEDBACK_WORK_ITEM');
    targetId=randomUUID();
    await db.execute(
      `INSERT INTO project_work_items
        (id,project_id,item_key,item_type,title,stage_key,priority,status,acceptance_criteria_json,evidence_json,metadata_json)
       VALUES (?,?,?,?,?,'PD_16_OUTCOME',?,'PLANNED',?,?,?)`,
      [targetId,feedback.project_id,input.action.itemKey,upper(input.action.itemType),input.action.title,
       upper(input.action.priority),asJson(input.action.acceptanceCriteria),asJson(input.action.evidence),
       asJson({source:'PRODUCT_FEEDBACK',feedbackId})]
    );
  }else if(actionType==='EXPERIMENT'){
    if(!input.action.experimentId)throw errorOf('EXPERIMENT action requires experimentId','FEEDBACK_EXPERIMENT_REQUIRED',409);
    const [experiments]=await db.execute('SELECT id FROM product_experiments WHERE id=? AND project_id=?',
      [input.action.experimentId,feedback.project_id]);
    if(!experiments.length)throw errorOf('Feedback experiment target not found','FEEDBACK_EXPERIMENT_INVALID',409);
    targetId=input.action.experimentId;
  }else{
    throw errorOf('Feedback decision must create Work Item or link Experiment','FEEDBACK_ACTION_REQUIRED',409);
  }
  await db.execute(
    `UPDATE product_feedback_signals SET status='DECIDED',triage_json=?,insight_json=?,problem_opportunity_json=?,
       decision_json=?,action_type=?,action_target_id=?,decided_at=? WHERE id=?`,
    [asJson(input.triage),asJson(input.insight),asJson(input.problemOpportunity),asJson(input.decision),
     actionType,targetId,input.decidedAt?new Date(input.decidedAt):new Date(),feedbackId]
  );
  await insertTrace(db,{projectId:feedback.project_id,sourceType:'FEEDBACK',sourceId:feedbackId,
    targetType:actionType,targetId,linkType:'DECIDES_TO',actorId,evidence:{decision:input.decision}});
  return {id:feedbackId,projectId:feedback.project_id,status:'DECIDED',actionType,actionTargetId:targetId};
};

const loadObservationWithMetric=async(db,id)=>{
  const [rows]=await db.execute(
    `SELECT o.*,m.metric_type,m.metric_key,m.display_name
       FROM product_outcome_observations o JOIN product_outcome_metrics m ON m.id=o.metric_id
      WHERE o.id=?`,[id]
  );
  if(!rows.length)throw errorOf('Outcome Observation not found','OUTCOME_OBSERVATION_NOT_FOUND',404,{id});
  return rows[0];
};

export const createOutcomeReview=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','postReleaseVerificationId','reviewKey','primaryMetricObservationId',
    'guardrailObservationIds','reliability','outcome','decision','nextAction','evidence'
  ],'INVALID_OUTCOME_REVIEW');
  if(!Array.isArray(input.guardrailObservationIds)||!input.guardrailObservationIds.length)throw errorOf(
    'Outcome Review requires guardrail observations','OUTCOME_GUARDRAIL_REQUIRED',409
  );
  if(!Array.isArray(input.experimentIds)||!Array.isArray(input.feedbackSignalIds)||!Array.isArray(input.incidentIds))
    throw errorOf('Outcome Review experiment/feedback/incident ids must be arrays','INVALID_OUTCOME_REVIEW_COLLECTIONS',409);
  const decisionType=upper(input.decision.type);
  if(!OUTCOME_DECISIONS.has(decisionType))throw errorOf('Unsupported outcome decision','INVALID_OUTCOME_DECISION',409,{decisionType});
  const db=getRuntimePool(),rollout=await loadRollout(input.releaseRolloutId,db);
  if(rollout.project_id!==projectId||!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))throw errorOf(
    'Outcome Review requires released rollout in same project','OUTCOME_RELEASE_SCOPE_INVALID',409
  );
  const [verifications]=await db.execute('SELECT * FROM product_post_release_verifications WHERE id=?',
    [input.postReleaseVerificationId]);
  if(!verifications.length||verifications[0].project_id!==projectId||
     verifications[0].release_rollout_id!==rollout.id||verifications[0].status!=='PASS')
    throw errorOf('Outcome Review requires PASS post-release verification','OUTCOME_POST_RELEASE_PASS_REQUIRED',409);
  const [latestRows]=await db.execute(
    'SELECT id,status FROM product_post_release_verifications WHERE release_rollout_id=? ORDER BY verified_at DESC,id DESC LIMIT 1',
    [rollout.id]
  );
  if(!latestRows.length||latestRows[0].id!==input.postReleaseVerificationId||latestRows[0].status!=='PASS')
    throw errorOf('Outcome Review must use latest PASS post-release verification','OUTCOME_POST_RELEASE_STALE',409);

  const primary=await loadObservationWithMetric(db,input.primaryMetricObservationId);
  if(primary.project_id!==projectId||primary.release_rollout_id!==rollout.id||primary.metric_type!=='PRIMARY')
    throw errorOf('Outcome primary observation must be PRIMARY metric for same rollout','OUTCOME_PRIMARY_OBSERVATION_INVALID',409);
  if(primary.data_quality_status!=='PASS')throw errorOf('Primary metric data quality must PASS','OUTCOME_PRIMARY_DATA_QUALITY_NOT_PASS',409);

  const guardIds=[...new Set(input.guardrailObservationIds)];
  const guardRows=[];
  for(const id of guardIds)guardRows.push(await loadObservationWithMetric(db,id));
  if(guardRows.some(x=>x.project_id!==projectId||x.release_rollout_id!==rollout.id||
      !['GUARDRAIL','RELIABILITY'].includes(x.metric_type)||x.data_quality_status!=='PASS'))
    throw errorOf('Guardrail observations must be PASS GUARDRAIL/RELIABILITY metrics for same rollout',
      'OUTCOME_GUARDRAIL_OBSERVATION_INVALID',409);

  const [allExperiments,allFeedback,allIncidents]=await Promise.all([
    db.execute('SELECT * FROM product_experiments WHERE release_rollout_id=? ORDER BY created_at,id',[rollout.id]).then(x=>x[0]),
    db.execute('SELECT * FROM product_feedback_signals WHERE release_rollout_id=? ORDER BY collected_at,id',[rollout.id]).then(x=>x[0]),
    db.execute('SELECT * FROM product_incidents WHERE release_rollout_id=? ORDER BY detected_at,id',[rollout.id]).then(x=>x[0])
  ]);
  if(!sameSet(input.experimentIds,allExperiments.map(x=>x.id)))throw errorOf(
    'Outcome Review must include complete experiment set for rollout','OUTCOME_EXPERIMENT_SET_MISMATCH',409
  );
  if(allExperiments.some(x=>x.status!=='COMPLETED'||upper(parseJson(x.srm_json)?.status)!=='PASS'||
      !EXPERIMENT_DECISIONS.has(upper(parseJson(x.decision_json)?.type))))
    throw errorOf('All rollout experiments must be completed with SRM PASS and decision','OUTCOME_EXPERIMENT_INCOMPLETE',409);
  if(!sameSet(input.feedbackSignalIds,allFeedback.map(x=>x.id)))throw errorOf(
    'Outcome Review must include complete feedback set for rollout','OUTCOME_FEEDBACK_SET_MISMATCH',409
  );
  if(allFeedback.some(x=>x.status!=='DECIDED'||!x.action_target_id))throw errorOf(
    'All rollout feedback must be decided into Work Item/Experiment','OUTCOME_FEEDBACK_INCOMPLETE',409
  );
  if(!sameSet(input.incidentIds,allIncidents.map(x=>x.id)))throw errorOf(
    'Outcome Review must include complete incident set for rollout','OUTCOME_INCIDENT_SET_MISMATCH',409
  );
  if(allIncidents.some(x=>x.status!=='CLOSED'))throw errorOf(
    'All rollout incidents must be CLOSED before Outcome Review','OUTCOME_INCIDENT_OPEN',409
  );

  if(upper(input.reliability.status)!=='PASS')throw errorOf('Outcome reliability must PASS','OUTCOME_RELIABILITY_NOT_PASS',409);
  if(Number(input.reliability.openIncidents||0)!==0)throw errorOf('Outcome reliability cannot have open incidents','OUTCOME_RELIABILITY_OPEN_INCIDENT',409);

  const nextType=upper(input.nextAction.type);
  if(nextType==='WORK_ITEM'){
    if(!input.nextAction.targetId)throw errorOf('Next Work Item targetId is required','OUTCOME_NEXT_ACTION_TARGET_REQUIRED',409);
    const [items]=await db.execute('SELECT id FROM project_work_items WHERE id=? AND project_id=?',
      [input.nextAction.targetId,projectId]);
    if(!items.length)throw errorOf('Outcome next Work Item not found','OUTCOME_NEXT_WORK_ITEM_INVALID',409);
  }else if(nextType==='EXPERIMENT'){
    if(!input.nextAction.targetId||!allExperiments.some(x=>x.id===input.nextAction.targetId))
      throw errorOf('Outcome next Experiment must exist in rollout','OUTCOME_NEXT_EXPERIMENT_INVALID',409);
  }else if(nextType==='NO_CHANGE'){
    if(!nonEmpty(input.nextAction.rationale))throw errorOf('NO_CHANGE next action requires rationale','OUTCOME_NO_CHANGE_RATIONALE_REQUIRED',409);
  }else{
    throw errorOf('Outcome next action must be WORK_ITEM, EXPERIMENT or NO_CHANGE','INVALID_OUTCOME_NEXT_ACTION',409);
  }

  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_outcome_reviews
      (id,project_id,release_rollout_id,release_version_id,post_release_verification_id,review_key,
       primary_metric_observation_id,guardrail_observation_ids_json,experiment_ids_json,
       feedback_signal_ids_json,incident_ids_json,reliability_json,outcome_json,decision_json,
       next_action_json,evidence_json,status,reviewed_by_identity_id,reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
    [id,projectId,rollout.id,rollout.release_version_id,input.postReleaseVerificationId,input.reviewKey,
     primary.id,asJson(guardIds),asJson(input.experimentIds),asJson(input.feedbackSignalIds),
     asJson(input.incidentIds),asJson(input.reliability),asJson(input.outcome),
     asJson({...input.decision,type:decisionType}),asJson({...input.nextAction,type:nextType}),
     asJson(input.evidence),actorId,input.reviewedAt?new Date(input.reviewedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'RELEASE_ROLLOUT',sourceId:rollout.id,
    targetType:'OUTCOME_REVIEW',targetId:id,linkType:'OUTCOME_REVIEWED_AS',actorId,evidence:{decision:decisionType}});
  return {id,projectId,releaseRolloutId:rollout.id,releaseVersionId:rollout.release_version_id,
    reviewKey:input.reviewKey,status:'FROZEN',decisionType,nextActionType:nextType};
};

export const evaluateOutcomeGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const release=await evaluateReleaseGate(projectId,{persist:false},actorId);
  if(release.status!=='PASS')reasons.push('RELEASE_NOT_READY_FOR_OUTCOME');
  evidence.releaseRolloutId=release.evidenceSnapshot?.releaseRolloutId||null;
  evidence.releaseState=release.evidenceSnapshot?.releaseState||null;

  const ops=await getPostReleaseOperationsState(projectId);
  evidence.operationalStatus=ops.operationalStatus;
  evidence.latestVerificationId=ops.latestVerificationId;
  if(ops.operationalStatus!=='HEALTHY')reasons.push('POST_RELEASE_OPERATIONS_NOT_HEALTHY');

  const [reviews]=await db.execute(
    "SELECT * FROM product_outcome_reviews WHERE project_id=? AND status='FROZEN' ORDER BY reviewed_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const review=reviews[0]||null;
  evidence.outcomeReviewId=review?.id||null;
  if(!review)reasons.push('FROZEN_OUTCOME_REVIEW_REQUIRED');
  else{
    evidence.releaseVersionId=review.release_version_id;
    evidence.primaryMetricObservationId=review.primary_metric_observation_id;
    evidence.guardrailObservationIds=parseJson(review.guardrail_observation_ids_json)||[];
    evidence.experimentIds=parseJson(review.experiment_ids_json)||[];
    evidence.feedbackSignalIds=parseJson(review.feedback_signal_ids_json)||[];
    evidence.incidentIds=parseJson(review.incident_ids_json)||[];
    evidence.decision=parseJson(review.decision_json);
    evidence.nextAction=parseJson(review.next_action_json);
    if(evidence.releaseRolloutId&&review.release_rollout_id!==evidence.releaseRolloutId)reasons.push('OUTCOME_REVIEW_RELEASE_STALE');
    if(ops.latestVerificationId&&review.post_release_verification_id!==ops.latestVerificationId)reasons.push('OUTCOME_REVIEW_VERIFICATION_STALE');

    const primary=await loadObservationWithMetric(db,review.primary_metric_observation_id);
    if(primary.data_quality_status!=='PASS'||primary.metric_type!=='PRIMARY')reasons.push('OUTCOME_PRIMARY_EVIDENCE_INVALID');
    const guardIds=evidence.guardrailObservationIds;
    for(const id of guardIds){
      const row=await loadObservationWithMetric(db,id);
      if(row.data_quality_status!=='PASS'||!['GUARDRAIL','RELIABILITY'].includes(row.metric_type))
        reasons.push('OUTCOME_GUARDRAIL_EVIDENCE_INVALID');
    }
    const [experiments,feedback,incidents]=await Promise.all([
      db.execute('SELECT * FROM product_experiments WHERE release_rollout_id=?',[review.release_rollout_id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_feedback_signals WHERE release_rollout_id=?',[review.release_rollout_id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_incidents WHERE release_rollout_id=?',[review.release_rollout_id]).then(x=>x[0])
    ]);
    if(!sameSet(evidence.experimentIds,experiments.map(x=>x.id))||
       experiments.some(x=>x.status!=='COMPLETED'||upper(parseJson(x.srm_json)?.status)!=='PASS'))
      reasons.push('OUTCOME_EXPERIMENT_EVIDENCE_STALE');
    if(!sameSet(evidence.feedbackSignalIds,feedback.map(x=>x.id))||
       feedback.some(x=>x.status!=='DECIDED'||!x.action_target_id))
      reasons.push('OUTCOME_FEEDBACK_EVIDENCE_STALE');
    if(!sameSet(evidence.incidentIds,incidents.map(x=>x.id))||incidents.some(x=>x.status!=='CLOSED'))
      reasons.push('OUTCOME_INCIDENT_EVIDENCE_STALE');
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m279_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getProductOutcomeState=async projectId=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const [metrics,observations,experiments,feedback,reviews,gates]=await Promise.all([
    db.execute('SELECT * FROM product_outcome_metrics WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_outcome_observations WHERE project_id=? ORDER BY window_end,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_experiments WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_feedback_signals WHERE project_id=? ORDER BY collected_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_outcome_reviews WHERE project_id=? ORDER BY reviewed_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m279_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    metrics:metrics.map(x=>({id:x.id,metricKey:x.metric_key,displayName:x.display_name,metricType:x.metric_type,
      unit:x.unit,aggregation:x.aggregation,direction:x.direction,target:parseJson(x.target_json),status:x.status})),
    observations:observations.map(x=>({id:x.id,metricId:x.metric_id,releaseRolloutId:x.release_rollout_id,
      observationKey:x.observation_key,windowStart:x.window_start,windowEnd:x.window_end,value:parseJson(x.value_json),
      sampleSize:Number(x.sample_size),dataQualityStatus:x.data_quality_status,dataQuality:parseJson(x.data_quality_json)})),
    experiments:experiments.map(x=>({id:x.id,releaseRolloutId:x.release_rollout_id,experimentKey:x.experiment_key,
      title:x.title,status:x.status,hypothesis:parseJson(x.hypothesis_json),primaryMetricId:x.primary_metric_id,
      guardrailMetricIds:parseJson(x.guardrail_metric_ids_json),srm:parseJson(x.srm_json),
      result:parseJson(x.result_json),confidence:parseJson(x.confidence_json),decision:parseJson(x.decision_json)})),
    feedback:feedback.map(x=>({id:x.id,releaseRolloutId:x.release_rollout_id,feedbackKey:x.feedback_key,
      sourceType:x.source_type,summary:x.summary,severity:x.severity,status:x.status,
      insight:parseJson(x.insight_json),problemOpportunity:parseJson(x.problem_opportunity_json),
      decision:parseJson(x.decision_json),actionType:x.action_type,actionTargetId:x.action_target_id})),
    reviews:reviews.map(x=>({id:x.id,releaseRolloutId:x.release_rollout_id,releaseVersionId:x.release_version_id,
      postReleaseVerificationId:x.post_release_verification_id,reviewKey:x.review_key,status:x.status,
      primaryMetricObservationId:x.primary_metric_observation_id,
      guardrailObservationIds:parseJson(x.guardrail_observation_ids_json),
      experimentIds:parseJson(x.experiment_ids_json),feedbackSignalIds:parseJson(x.feedback_signal_ids_json),
      incidentIds:parseJson(x.incident_ids_json),reliability:parseJson(x.reliability_json),
      outcome:parseJson(x.outcome_json),decision:parseJson(x.decision_json),nextAction:parseJson(x.next_action_json)})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
