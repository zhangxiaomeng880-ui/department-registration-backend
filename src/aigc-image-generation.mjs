import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcAssetGate } from './aigc-asset-system.mjs';

const GATE='G-AIGC-IMAGE';
const IMAGE_TYPES=new Set(['IMAGE','KEYFRAME','STORYBOARD']);
const CANDIDATE_TYPES=new Set(['IMAGE','KEYFRAME','STORYBOARD']);
const SELECTION_EVENTS=new Set(['SELECT','REJECT','RESTORE','LOCK']);
const QA_DIMS=[
  'identityLookSceneProp','actionPose','expressionPerformance','gazeBlocking','anatomyHands',
  'spatialScalePerspective','compositionCamera','lightingColor','textUi','multiFormat','technicalIntegrity'
];
const SHA64=/^[0-9a-f]{64}$/i;
const ASSET_ROLE_MAP={
  IDENTITY:'IDENTITY',LOOK:'LOOK',COSTUME:'LOOK',SCENE:'SCENE',LOCATION:'SCENE',
  STYLE:'STYLE',COMPOSITION_REFERENCE:'COMPOSITION',ACTION:'MOTION',POSE:'MOTION',
  PERFORMANCE:'PERFORMANCE',VOICE:'AUDIO',MUSIC:'AUDIO',OST:'AUDIO',SFX:'AUDIO',AMBIENCE:'AUDIO'
};

const errorOf=(message,code,statusCode=400,details)=>{const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{if(v==null)return false;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;};
const requireFields=(input,fields,code)=>{const missing=fields.filter(k=>!nonEmpty(input[k]));if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const sha256=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(stable(v)),'utf8').digest('hex');
const listRows=async(db,sql,params=[])=>(await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf('AIGC Image requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409);
  return rows[0];
};
const currentBreakdown=async(projectId,db)=>{
  const [rows]=await db.execute("SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",[projectId]);
  return rows[0]||null;
};
const currentImagePlan=async(projectId,db)=>{
  const [rows]=await db.execute("SELECT * FROM aigc_image_production_plans WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId]);
  return rows[0]||null;
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

export const resolveAigcImageProjectScope=async projectId=>{const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};};
export const resolveGenerationJobScope=async id=>{
  const db=getRuntimePool();const [rows]=await db.execute(
    `SELECT j.project_id,p.workspace_id FROM aigc_generation_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`,[id]);
  if(!rows.length)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveCandidateScope=async id=>{
  const db=getRuntimePool();const [rows]=await db.execute(
    `SELECT c.project_id,p.workspace_id FROM aigc_generation_candidates c JOIN projects p ON p.id=c.project_id WHERE c.id=?`,[id]);
  if(!rows.length)throw errorOf('Candidate not found','AIGC_GENERATION_CANDIDATE_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcImageProductionPlan=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['planKey','targetShotIds','requiredOutputType','coveragePolicy','qaPolicy','selectionPolicy','evidence'],'INVALID_AIGC_IMAGE_PLAN');
  if(!Array.isArray(input.targetShotIds)||!input.targetShotIds.length)throw errorOf('Image plan requires target shots','AIGC_IMAGE_TARGET_SHOTS_REQUIRED',409);
  const outputType=upper(input.requiredOutputType);
  if(!IMAGE_TYPES.has(outputType))throw errorOf('Unsupported image output type','AIGC_IMAGE_OUTPUT_TYPE_INVALID',409,{outputType});
  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const ids=[...new Set(input.targetShotIds)];
  const placeholders=ids.map(()=>'?').join(',');
  const shots=await listRows(db,`SELECT id FROM aigc_shots WHERE breakdown_plan_id=? AND id IN (${placeholders})`,[breakdown.id,...ids]);
  if(shots.length!==ids.length)throw errorOf('Image plan contains stale/unknown shots','AIGC_IMAGE_TARGET_SHOT_INVALID',409);
  await db.execute("UPDATE aigc_image_production_plans SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",[projectId]);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_image_production_plans
      (id,project_id,breakdown_plan_id,plan_key,target_shot_ids_json,required_output_type,
       coverage_policy_json,qa_policy_json,selection_policy_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
    [id,projectId,breakdown.id,input.planKey,asJson(ids),outputType,asJson(input.coveragePolicy),
     asJson(input.qaPolicy),asJson(input.selectionPolicy),asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:breakdown.id,targetType:'IMAGE_PRODUCTION_PLAN',targetId:id,
    linkType:'PRODUCES_IMAGE_PLAN',actorId,evidence:{outputType,targetShotCount:ids.length}});
  return {id,projectId,breakdownPlanId:breakdown.id,planKey:input.planKey,requiredOutputType:outputType,targetShotCount:ids.length,status:'FROZEN'};
};

const loadShotGenerationContext=async(db,projectId,shotId)=>{
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const [shots]=await db.execute(
    `SELECT s.*,sc.unit_id FROM aigc_shots s JOIN aigc_scenes sc ON sc.id=s.scene_id
      WHERE s.id=? AND s.breakdown_plan_id=?`,[shotId,breakdown.id]);
  if(!shots.length)throw errorOf('Shot not in current Breakdown','AIGC_GENERATION_SHOT_STALE',409);
  const shot=shots[0];
  const requirements=await listRows(db,'SELECT * FROM aigc_shot_asset_requirements WHERE shot_id=? AND criticality=\'REQUIRED\'',[shotId]);
  const bindings=await listRows(db,
    `SELECT b.* FROM aigc_asset_requirement_bindings b
      WHERE b.asset_requirement_id IN (SELECT id FROM aigc_shot_asset_requirements WHERE shot_id=? AND criticality='REQUIRED')
        AND b.is_current=TRUE`,[shotId]);
  if(bindings.length!==requirements.length)throw errorOf('Shot has unbound required assets','AIGC_GENERATION_REQUIRED_ASSET_UNBOUND',409);
  return {breakdown,shot,requirements,bindings};
};

export const createAigcGenerationJob=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'imageProductionPlanId','shotId','parentCallSheetId','generationKey','generationType','provider',
    'modelName','modelVersion','executionStack','prompt','promptVersion','parameters',
    'requestedOutputCount','supportedReferenceRoles','retry','provenance','evidence'
  ],'INVALID_AIGC_GENERATION_JOB');
  const generationType=upper(input.generationType);
  if(!IMAGE_TYPES.has(generationType))throw errorOf('Unsupported generation type','AIGC_GENERATION_TYPE_INVALID',409,{generationType});
  const count=Number(input.requestedOutputCount);
  if(!Number.isInteger(count)||count<1||count>16)throw errorOf('requestedOutputCount must be 1..16','AIGC_GENERATION_OUTPUT_COUNT_INVALID',409);
  const db=getRuntimePool(),assetGate=await evaluateAigcAssetGate(projectId,{persist:false},actorId);
  if(assetGate.status!=='PASS')throw errorOf('G-AIGC-ASSET must PASS before generation','G_AIGC_ASSET_REQUIRED',409,{reasonCodes:assetGate.reasonCodes});
  const plan=await currentImagePlan(projectId,db);
  if(!plan||plan.id!==input.imageProductionPlanId)throw errorOf('Current image production plan required','AIGC_IMAGE_PLAN_STALE',409);
  const targetIds=parseJson(plan.target_shot_ids_json)||[];
  if(!targetIds.includes(input.shotId))throw errorOf('Shot not targeted by image plan','AIGC_IMAGE_SHOT_NOT_TARGETED',409);
  if(plan.required_output_type!==generationType)throw errorOf('Generation type mismatches image plan','AIGC_IMAGE_OUTPUT_TYPE_MISMATCH',409);

  const ctx=await loadShotGenerationContext(db,projectId,input.shotId);
  const callBinding=ctx.bindings.find(b=>b.call_sheet_id===input.parentCallSheetId);
  if(!callBinding)throw errorOf('Parent Call Sheet must resolve a required asset for this shot','AIGC_PARENT_CALL_SHEET_INVALID',409);
  const [sheets]=await db.execute('SELECT * FROM aigc_asset_call_sheets WHERE id=?',[input.parentCallSheetId]);
  const parentSheet=sheets[0];
  if(!parentSheet||parentSheet.status!=='READY'||upper(parseJson(parentSheet.preflight_json)?.status)!=='PASS')
    throw errorOf('Parent Call Sheet preflight is not ready','AIGC_PARENT_CALL_SHEET_NOT_READY',409);

  const refs=[];
  for(const b of ctx.bindings){
    if(b.resolution_type==='CURRENT_ASSET'){
      const [rows]=await db.execute(
        `SELECT v.id,a.asset_type FROM aigc_asset_versions v JOIN aigc_assets a ON a.id=v.asset_id WHERE v.id=?`,[b.asset_version_id]);
      if(!rows.length)throw errorOf('Bound asset version missing','AIGC_BOUND_ASSET_VERSION_MISSING',409);
      const role=ASSET_ROLE_MAP[rows[0].asset_type]||'COMPOSITION';
      refs.push({assetVersionId:rows[0].id,role,inheritedFrom:'CURRENT_ASSET',required:true,compatibility:{status:'PASS'}});
    }else if(b.resolution_type==='CALL_SHEET'){
      const [cs]=await db.execute('SELECT * FROM aigc_asset_call_sheets WHERE id=?',[b.call_sheet_id]);
      if(!cs.length||cs[0].status!=='READY'||upper(parseJson(cs[0].preflight_json)?.status)!=='PASS')
        throw errorOf('Bound Call Sheet not ready','AIGC_BOUND_CALL_SHEET_NOT_READY',409);
      const rr=await listRows(db,'SELECT * FROM aigc_call_sheet_reference_bindings WHERE call_sheet_id=?',[b.call_sheet_id]);
      for(const x of rr)refs.push({assetVersionId:x.reference_asset_version_id,role:x.reference_role,
        inheritedFrom:'CALL_SHEET',required:Boolean(x.required),compatibility:parseJson(x.compatibility_json)||{}});
    }
  }
  const dedup=new Map();
  for(const x of refs)dedup.set(`${x.assetVersionId}:${x.role}`,x);
  const references=[...dedup.values()];
  const supported=new Set((input.supportedReferenceRoles||[]).map(upper));
  const unsupported=references.filter(x=>x.required&&!supported.has(x.role)).map(x=>x.role);
  if(unsupported.length)throw errorOf('Model/tool does not support required Reference Roles',
    'AIGC_GENERATION_REFERENCE_ROLE_UNSUPPORTED',409,{unsupportedRoles:[...new Set(unsupported)]});

  const fingerprint=sha256({
    shotId:input.shotId,generationType,provider:input.provider,modelName:input.modelName,
    modelVersion:input.modelVersion,prompt:input.prompt,negativePrompt:input.negativePrompt||null,
    promptVersion:input.promptVersion,parameters:input.parameters,
    references:references.map(x=>({assetVersionId:x.assetVersionId,role:x.role})).sort((a,b)=>(a.role+a.assetVersionId).localeCompare(b.role+b.assetVersionId))
  });
  const preflight={status:'PASS',assetGate:'PASS',shotSpec:'READY',currentKnowledge:'READY',
    parentCallSheetId:parentSheet.id,requiredReferenceCount:references.filter(x=>x.required).length,
    supportedReferenceRoles:[...supported].sort()};
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_generation_jobs
      (id,project_id,image_production_plan_id,breakdown_plan_id,unit_id,scene_id,shot_id,asset_id,parent_call_sheet_id,
       generation_key,generation_type,provider,model_name,model_version,execution_stack_json,prompt_text,
       negative_prompt_text,prompt_version,parameters_json,input_fingerprint_sha256,requested_output_count,
       reference_snapshot_json,preflight_json,status,retry_json,provenance_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'RUNNING',?,?,?,?)`,
    [id,projectId,plan.id,ctx.breakdown.id,ctx.shot.unit_id,ctx.shot.scene_id,ctx.shot.id,input.assetId||null,
     parentSheet.id,input.generationKey,generationType,input.provider,input.modelName,input.modelVersion,
     asJson(input.executionStack),input.prompt,input.negativePrompt||null,input.promptVersion,asJson(input.parameters),
     fingerprint,count,asJson(references),asJson(preflight),asJson(input.retry),asJson(input.provenance),asJson(input.evidence),actorId]
  );
  for(const ref of references)await db.execute(
    `INSERT INTO aigc_generation_job_references
      (id,project_id,generation_job_id,asset_version_id,reference_role,inherited_from,required,compatibility_json,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,id,ref.assetVersionId,ref.role,ref.inheritedFrom,ref.required?1:0,
     asJson(ref.compatibility),asJson({source:'GENERATION_PREFLIGHT'})]
  );
  await insertTrace(db,{projectId,sourceType:'SHOT',sourceId:ctx.shot.id,targetType:'GENERATION_JOB',targetId:id,
    linkType:'GENERATES',actorId,evidence:{generationType,inputFingerprintSha256:fingerprint}});
  return {id,projectId,shotId:ctx.shot.id,generationKey:input.generationKey,generationType,status:'RUNNING',
    inputFingerprintSha256:fingerprint,referenceCount:references.length,preflight};
};

const validateImageQa=qa=>{
  requireFields(qa,['overallStatus',...QA_DIMS],'INVALID_AIGC_IMAGE_QA');
  const overall=upper(qa.overallStatus);
  if(!['PASS','FAIL'].includes(overall))throw errorOf('QA overallStatus must PASS/FAIL','AIGC_IMAGE_QA_STATUS_INVALID',409);
  const invalid=QA_DIMS.filter(k=>!['PASS','N_A','FAIL'].includes(upper(qa[k])));
  if(invalid.length)throw errorOf('Invalid QA dimension status','AIGC_IMAGE_QA_DIMENSION_INVALID',409,{dimensions:invalid});
  if(overall==='PASS'&&QA_DIMS.some(k=>upper(qa[k])==='FAIL'))
    throw errorOf('Overall PASS cannot contain failed QA dimension','AIGC_IMAGE_QA_INCONSISTENT',409);
  return overall;
};

export const completeAigcGenerationJob=async(jobId,input={},actorId=null)=>{
  requireFields(input,['candidates','endedAt','latencyMs','tokenUsage','creditUsage','cost','safety','provenance','evidence'],
    'INVALID_AIGC_GENERATION_COMPLETION');
  if(!Array.isArray(input.candidates)||!input.candidates.length)throw errorOf('Generation completion needs candidates','AIGC_GENERATION_CANDIDATES_REQUIRED',409);
  if(upper(input.safety.status)!=='PASS')throw errorOf('Safety/Moderation must PASS before candidates persist','AIGC_GENERATION_SAFETY_NOT_PASS',409);
  const db=getRuntimePool();const [rows]=await db.execute('SELECT * FROM aigc_generation_jobs WHERE id=?',[jobId]);const job=rows[0];
  if(!job)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  if(job.status!=='RUNNING')throw errorOf('Only RUNNING job can complete','AIGC_GENERATION_JOB_STATE_INVALID',409,{status:job.status});
  if(input.candidates.length>Number(job.requested_output_count))throw errorOf('Candidate count exceeds requested output count','AIGC_GENERATION_CANDIDATE_COUNT_INVALID',409);
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const candidateIds=[];
    for(let i=0;i<input.candidates.length;i++){
      const c=input.candidates[i];
      requireFields(c,['candidateKey','candidateType','contentLocator','outputFingerprintSha256','qaResult','compareGroup','provenance','evidence'],
        'INVALID_AIGC_GENERATION_CANDIDATE');
      const type=upper(c.candidateType);
      if(!CANDIDATE_TYPES.has(type)||type!==job.generation_type)throw errorOf('Candidate type mismatches job','AIGC_CANDIDATE_TYPE_MISMATCH',409);
      if(!SHA64.test(String(c.outputFingerprintSha256)))throw errorOf('Candidate fingerprint must be SHA-256','AIGC_CANDIDATE_FINGERPRINT_INVALID',409);
      const qaStatus=validateImageQa(c.qaResult),id=randomUUID();candidateIds.push(id);
      await conn.execute(
        `INSERT INTO aigc_generation_candidates
          (id,project_id,generation_job_id,shot_id,candidate_key,candidate_type,ordinal_no,content_locator_json,
           output_fingerprint_sha256,qa_result_json,qa_status,compare_group,state,is_current,
           human_comment,parent_candidate_id,version_no,provenance_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,?,?,?,?,?)`,
        [id,job.project_id,job.id,job.shot_id,c.candidateKey,type,i+1,asJson(c.contentLocator),
         String(c.outputFingerprintSha256).toLowerCase(),asJson(c.qaResult),qaStatus,c.compareGroup,
         c.humanComment||null,c.parentCandidateId||null,Number(c.versionNo||1),asJson(c.provenance),asJson(c.evidence)]
      );
      await insertTrace(conn,{projectId:job.project_id,sourceType:'GENERATION_JOB',sourceId:job.id,
        targetType:'CANDIDATE',targetId:id,linkType:'OUTPUTS',actorId,evidence:{qaStatus,type}});
    }
    const ended=new Date(input.endedAt);if(Number.isNaN(ended.getTime()))throw errorOf('Invalid endedAt','INVALID_DATE');
    await conn.execute(
      `UPDATE aigc_generation_jobs SET status='SUCCEEDED',ended_at=?,latency_ms=?,token_usage_json=?,
       credit_usage_json=?,cost_json=?,safety_json=?,provenance_json=?,evidence_json=? WHERE id=?`,
      [ended,Number(input.latencyMs),asJson(input.tokenUsage),asJson(input.creditUsage),asJson(input.cost),
       asJson(input.safety),asJson(input.provenance),asJson(input.evidence),job.id]
    );
    await conn.commit();
    return {id:job.id,projectId:job.project_id,shotId:job.shot_id,status:'SUCCEEDED',candidateIds};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const applyAigcCandidateSelection=async(candidateId,input={},actorId=null)=>{
  requireFields(input,['eventType','reason','evidence'],'INVALID_AIGC_CANDIDATE_SELECTION');
  const eventType=upper(input.eventType);
  if(!SELECTION_EVENTS.has(eventType))throw errorOf('Unsupported candidate selection event','AIGC_CANDIDATE_EVENT_INVALID',409,{eventType});
  const db=getRuntimePool();const [rows]=await db.execute('SELECT * FROM aigc_generation_candidates WHERE id=?',[candidateId]);const c=rows[0];
  if(!c)throw errorOf('Candidate not found','AIGC_GENERATION_CANDIDATE_NOT_FOUND',404);
  if(['SELECT','RESTORE','LOCK'].includes(eventType)&&c.qa_status!=='PASS')
    throw errorOf('Only QA PASS candidate can become current/locked','AIGC_CANDIDATE_QA_PASS_REQUIRED',409);
  const [currentRows]=await db.execute(
    'SELECT * FROM aigc_generation_candidates WHERE shot_id=? AND is_current=TRUE ORDER BY created_at DESC LIMIT 1',[c.shot_id]);
  const previous=currentRows[0]||null;
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    if(eventType==='REJECT'){
      if(c.is_current)throw errorOf('Current candidate must be replaced before reject','AIGC_CURRENT_CANDIDATE_REJECT_FORBIDDEN',409);
      await conn.execute("UPDATE aigc_generation_candidates SET state='REJECTED',rejected_reason=?,human_comment=? WHERE id=?",
        [input.reason,input.humanComment||null,candidateId]);
    }else if(eventType==='SELECT'||eventType==='RESTORE'){
      await conn.execute('UPDATE aigc_generation_candidates SET is_current=FALSE WHERE shot_id=? AND is_current=TRUE',[c.shot_id]);
      await conn.execute("UPDATE aigc_generation_candidates SET state='SELECTED',is_current=TRUE,selected_reason=?,human_comment=? WHERE id=?",
        [input.reason,input.humanComment||null,candidateId]);
    }else if(eventType==='LOCK'){
      if(!c.is_current||!['SELECTED','LOCKED'].includes(c.state))throw errorOf('Candidate must be current SELECTED before lock','AIGC_CANDIDATE_CURRENT_REQUIRED',409);
      await conn.execute("UPDATE aigc_generation_candidates SET state='LOCKED',is_current=TRUE,selected_reason=?,human_comment=? WHERE id=?",
        [input.reason,input.humanComment||null,candidateId]);
    }
    const eventId=randomUUID();
    await conn.execute(
      `INSERT INTO aigc_candidate_selection_events
        (id,project_id,shot_id,candidate_id,event_type,previous_current_candidate_id,reason,human_comment,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [eventId,c.project_id,c.shot_id,candidateId,eventType,previous?.id||null,input.reason,input.humanComment||null,asJson(input.evidence),actorId]
    );
    await insertTrace(conn,{projectId:c.project_id,sourceType:'CANDIDATE',sourceId:candidateId,targetType:'SELECTION_EVENT',targetId:eventId,
      linkType:eventType,actorId,evidence:{previousCurrentCandidateId:previous?.id||null}});
    await conn.commit();
    return {eventId,candidateId,projectId:c.project_id,shotId:c.shot_id,eventType,
      state:eventType==='REJECT'?'REJECTED':eventType==='LOCK'?'LOCKED':'SELECTED',
      isCurrent:eventType!=='REJECT',previousCurrentCandidateId:previous?.id||null};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateAigcImageGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};
  const assetGate=await evaluateAigcAssetGate(projectId,{asOf,persist:false},actorId);
  if(assetGate.status!=='PASS')reasons.push('G_AIGC_ASSET_NOT_PASS');
  const plan=await currentImagePlan(projectId,db);evidence.imageProductionPlanId=plan?.id||null;
  if(!plan)reasons.push('AIGC_IMAGE_PRODUCTION_PLAN_REQUIRED');
  else{
    const targets=parseJson(plan.target_shot_ids_json)||[];
    const placeholders=targets.map(()=>'?').join(',');
    const currents=targets.length?await listRows(db,
      `SELECT * FROM aigc_generation_candidates WHERE project_id=? AND shot_id IN (${placeholders}) AND is_current=TRUE`,
      [projectId,...targets]):[];
    const byShot=new Map(currents.map(x=>[x.shot_id,x]));
    const missing=targets.filter(id=>!byShot.has(id));
    const invalid=currents.filter(x=>x.qa_status!=='PASS'||!['SELECTED','LOCKED'].includes(x.state));
    if(missing.length)reasons.push('AIGC_IMAGE_SELECTED_COVERAGE_INCOMPLETE');
    if(invalid.length)reasons.push('AIGC_IMAGE_CURRENT_CANDIDATE_INVALID');
    evidence.targetShotCount=targets.length;
    evidence.currentSelectedShotCount=targets.length-missing.length;
    evidence.lockedShotCount=currents.filter(x=>x.state==='LOCKED').length;
    evidence.selectedShotCount=currents.filter(x=>x.state==='SELECTED').length;
    evidence.missingShotIds=missing;
    evidence.videoReferenceReadyShotCount=currents.filter(x=>x.qa_status==='PASS'&&['SELECTED','LOCKED'].includes(x.state)).length;
  }
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m289_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcImageState=async projectId=>{
  const project=await loadProject(projectId),db=getRuntimePool();
  const [plans,jobs,refs,candidates,events,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_image_production_plans WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_generation_jobs WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_generation_job_references WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_generation_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_candidate_selection_events WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m289_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{language:'zh-CN',moduleNames:['生成任务','生成候选与历史','图像 / 关键帧 / 分镜生产','图像质量验证'],
      gateName:'图像生产门禁',candidateStateLabels:{CANDIDATE:'候选',SELECTED:'已选择',REJECTED:'已拒绝',LOCKED:'已锁定'},
      selectionEventLabels:{SELECT:'选择',REJECT:'拒绝',RESTORE:'恢复为当前',LOCK:'锁定'}},
    plans:plans.map(x=>({id:x.id,breakdownPlanId:x.breakdown_plan_id,planKey:x.plan_key,targetShotIds:parseJson(x.target_shot_ids_json),
      requiredOutputType:x.required_output_type,coveragePolicy:parseJson(x.coverage_policy_json),qaPolicy:parseJson(x.qa_policy_json),
      selectionPolicy:parseJson(x.selection_policy_json),status:x.status})),
    jobs:jobs.map(x=>({id:x.id,imageProductionPlanId:x.image_production_plan_id,shotId:x.shot_id,parentCallSheetId:x.parent_call_sheet_id,
      generationKey:x.generation_key,generationType:x.generation_type,provider:x.provider,modelName:x.model_name,modelVersion:x.model_version,
      executionStack:parseJson(x.execution_stack_json),promptVersion:x.prompt_version,parameters:parseJson(x.parameters_json),
      inputFingerprintSha256:x.input_fingerprint_sha256,requestedOutputCount:Number(x.requested_output_count),
      preflight:parseJson(x.preflight_json),status:x.status,latencyMs:x.latency_ms==null?null:Number(x.latency_ms),
      tokenUsage:parseJson(x.token_usage_json),creditUsage:parseJson(x.credit_usage_json),cost:parseJson(x.cost_json),
      safety:parseJson(x.safety_json),provenance:parseJson(x.provenance_json)})),
    references:refs.map(x=>({id:x.id,generationJobId:x.generation_job_id,assetVersionId:x.asset_version_id,referenceRole:x.reference_role,
      inheritedFrom:x.inherited_from,required:Boolean(x.required),compatibility:parseJson(x.compatibility_json)})),
    candidates:candidates.map(x=>({id:x.id,generationJobId:x.generation_job_id,shotId:x.shot_id,candidateKey:x.candidate_key,
      candidateType:x.candidate_type,ordinalNo:Number(x.ordinal_no),contentLocator:parseJson(x.content_locator_json),
      outputFingerprintSha256:x.output_fingerprint_sha256,qaResult:parseJson(x.qa_result_json),qaStatus:x.qa_status,
      compareGroup:x.compare_group,state:x.state,isCurrent:Boolean(x.is_current),selectedReason:x.selected_reason||null,
      rejectedReason:x.rejected_reason||null,humanComment:x.human_comment||null,parentCandidateId:x.parent_candidate_id||null,versionNo:Number(x.version_no)})),
    selectionEvents:events.map(x=>({id:x.id,shotId:x.shot_id,candidateId:x.candidate_id,eventType:x.event_type,
      previousCurrentCandidateId:x.previous_current_candidate_id||null,reason:x.reason,humanComment:x.human_comment||null,createdAt:x.created_at})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
