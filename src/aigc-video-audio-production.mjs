import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import {
  evaluateAigcImageGate,getAigcQaDimensions,isAigcCandidateQaPass
} from './aigc-generation-image.mjs';

const GATE='G-AIGC-PRODUCTION';
const PRODUCTION_TYPES=['VIDEO','DIALOGUE','VOICE','MUSIC','SFX'];
const PRODUCTION_TYPE_SET=new Set(PRODUCTION_TYPES);
const APPLICABILITY=new Set(['REQUIRED','N_A']);
const FAILURE_CATEGORIES=new Set(['TOOL_CAPABILITY','PROMPT','REFERENCE','MOTION','ASSET_UPSTREAM']);
const SHA64=/^[0-9a-f]{64}$/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];
const stableValue=value=>{
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value)),'utf8'
).digest('hex');

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Production requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentBreakdown=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
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

export const resolveAigcProductionProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveAigcProductionRequirementScope=async requirementId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.project_id,p.workspace_id
       FROM aigc_shot_production_requirements r JOIN projects p ON p.id=r.project_id
      WHERE r.id=?`,[requirementId]
  );
  if(!rows.length)throw errorOf('Production requirement not found','AIGC_PRODUCTION_REQUIREMENT_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveAigcProductionFailureScope=async failureAnalysisId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT f.project_id,p.workspace_id
       FROM aigc_production_failure_analyses f JOIN projects p ON p.id=f.project_id
      WHERE f.id=?`,[failureAnalysisId]
  );
  if(!rows.length)throw errorOf('Production failure analysis not found','AIGC_PRODUCTION_FAILURE_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcProductionRequirements=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['requirements','evidence'],'INVALID_AIGC_PRODUCTION_REQUIREMENTS');
  if(!Array.isArray(input.requirements)||!input.requirements.length)throw errorOf(
    'Production requirements must be a non-empty array','AIGC_PRODUCTION_REQUIREMENTS_REQUIRED',409
  );
  const db=getRuntimePool();
  const imageGate=await evaluateAigcImageGate(projectId,{persist:false},actorId);
  if(imageGate.status!=='PASS')throw errorOf(
    'G-AIGC-IMAGE must PASS before Video/Audio production planning','G_AIGC_IMAGE_REQUIRED',409,
    {reasonCodes:imageGate.reasonCodes}
  );
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const shots=await listRows(db,'SELECT id,shot_key FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY shot_key',[breakdown.id]);
  const shotIds=new Set(shots.map(x=>x.id));
  const existing=await listRows(db,'SELECT id FROM aigc_shot_production_requirements WHERE breakdown_plan_id=?',[breakdown.id]);
  if(existing.length)throw errorOf(
    'Production requirements already exist for current Breakdown','AIGC_PRODUCTION_REQUIREMENTS_ALREADY_EXIST',409
  );

  const normalized=[];
  const pairKeys=new Set();
  for(const req of input.requirements){
    requireFields(req,[
      'requirementKey','shotId','productionType','applicability','sourceSpec','qaPolicy','rationale','evidence'
    ],'INVALID_AIGC_PRODUCTION_REQUIREMENT');
    const productionType=upper(req.productionType),applicability=upper(req.applicability);
    if(!PRODUCTION_TYPE_SET.has(productionType))throw errorOf(
      'Unsupported production type','AIGC_PRODUCTION_TYPE_INVALID',409,{productionType}
    );
    if(!APPLICABILITY.has(applicability))throw errorOf(
      'Production applicability must be REQUIRED or N_A','AIGC_PRODUCTION_APPLICABILITY_INVALID',409,{applicability}
    );
    if(!shotIds.has(req.shotId))throw errorOf(
      'Production requirement shot is outside current Breakdown','AIGC_PRODUCTION_SHOT_STALE',409,{shotId:req.shotId}
    );
    if(productionType==='VIDEO'&&applicability!=='REQUIRED')throw errorOf(
      'Every shot requires VIDEO production','AIGC_VIDEO_REQUIREMENT_MANDATORY',409,{shotId:req.shotId}
    );
    const pair=req.shotId+'|'+productionType;
    if(pairKeys.has(pair))throw errorOf('Duplicate production requirement type for shot',
      'AIGC_PRODUCTION_REQUIREMENT_DUPLICATE',409,{shotId:req.shotId,productionType});
    pairKeys.add(pair);
    normalized.push({...req,productionType,applicability,status:applicability==='N_A'?'N_A':'OPEN'});
  }

  const expectedPairs=new Set();
  for(const shot of shots)for(const type of PRODUCTION_TYPES)expectedPairs.add(shot.id+'|'+type);
  const missing=[...expectedPairs].filter(x=>!pairKeys.has(x));
  if(missing.length)throw errorOf(
    'Every shot must explicitly declare VIDEO/DIALOGUE/VOICE/MUSIC/SFX as REQUIRED or N_A',
    'AIGC_PRODUCTION_REQUIREMENT_COVERAGE_INCOMPLETE',409,{missingCount:missing.length,missing:missing.slice(0,20)}
  );

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const ids=[];
    for(const req of normalized){
      const id=randomUUID();ids.push(id);
      await conn.execute(
        `INSERT INTO aigc_shot_production_requirements
          (id,project_id,breakdown_plan_id,shot_id,requirement_key,production_type,applicability,
           source_spec_json,qa_policy_json,rationale,status,evidence_json,created_by_identity_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,breakdown.id,req.shotId,req.requirementKey,req.productionType,req.applicability,
         asJson(req.sourceSpec),asJson(req.qaPolicy),req.rationale,req.status,asJson(req.evidence),actorId]
      );
      await insertTrace(conn,{projectId,sourceType:'SHOT',sourceId:req.shotId,
        targetType:'PRODUCTION_REQUIREMENT',targetId:id,linkType:'REQUIRES_MEDIA',actorId,
        evidence:{productionType:req.productionType,applicability:req.applicability}});
    }
    await conn.commit();
    return {projectId,breakdownPlanId:breakdown.id,requirementCount:ids.length,
      requiredCount:normalized.filter(x=>x.applicability==='REQUIRED').length,
      notApplicableCount:normalized.filter(x=>x.applicability==='N_A').length,status:'FROZEN'};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const lockAigcProductionRequirement=async(requirementId,input={},actorId=null)=>{
  requireFields(input,['generationJobId','candidateId','lockKey','rights','timing','evidence'],
    'INVALID_AIGC_PRODUCTION_LOCK');
  const db=getRuntimePool();
  const [reqRows]=await db.execute('SELECT * FROM aigc_shot_production_requirements WHERE id=?',[requirementId]);
  const req=reqRows[0];
  if(!req)throw errorOf('Production requirement not found','AIGC_PRODUCTION_REQUIREMENT_NOT_FOUND',404);
  if(req.applicability!=='REQUIRED'||req.status!=='OPEN')throw errorOf(
    'Only OPEN REQUIRED production requirement can be locked','AIGC_PRODUCTION_REQUIREMENT_STATE_INVALID',409,
    {applicability:req.applicability,status:req.status}
  );

  const [rows]=await db.execute(
    `SELECT c.*,j.status AS job_status,j.generation_kind,j.reference_bindings_json,j.project_id AS job_project_id,
            j.shot_id AS job_shot_id
       FROM aigc_generation_candidates c
       JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
      WHERE c.id=? AND j.id=?`,[input.candidateId,input.generationJobId]
  );
  const candidate=rows[0];
  if(!candidate||candidate.project_id!==req.project_id||candidate.job_project_id!==req.project_id||
     candidate.job_shot_id!==req.shot_id||candidate.generation_kind!==req.production_type)
    throw errorOf('Production lock candidate/job does not match requirement scope',
      'AIGC_PRODUCTION_LOCK_SCOPE_INVALID',409
    );
  if(candidate.job_status!=='PASS'||candidate.selection_status!=='SELECTED'||!candidate.is_current)
    throw errorOf('Production lock requires CURRENT selected candidate from PASS job',
      'AIGC_PRODUCTION_CURRENT_CANDIDATE_REQUIRED',409
    );
  const qa=parseJson(candidate.qa_json)||{};
  if(!isAigcCandidateQaPass(qa,req.production_type))throw errorOf(
    'Production candidate QA must PASS before lock','AIGC_PRODUCTION_QA_PASS_REQUIRED',409,
    {productionType:req.production_type,qaDimensions:getAigcQaDimensions(req.production_type)}
  );
  const safety=parseJson(candidate.safety_json)||{};
  if(upper(safety.status||'PASS')!=='PASS')throw errorOf(
    'Production candidate safety must PASS','AIGC_PRODUCTION_SAFETY_PASS_REQUIRED',409
  );
  if(!['PASS','APPROVED','CLEARED'].includes(upper(input.rights.status)))
    throw errorOf('Production rights must be approved before lock','AIGC_PRODUCTION_RIGHTS_REQUIRED',409);

  if(req.production_type==='VIDEO'){
    const refs=parseJson(candidate.reference_bindings_json)||parseJson(rows[0].reference_bindings_json)||[];
    const jobRefs=parseJson(rows[0].reference_bindings_json)||[];
    const frameRefs=jobRefs.filter(x=>
      upper(x.referenceType||'ASSET_VERSION')==='GENERATION_CANDIDATE'&&
      ['FIRST_FRAME','LAST_FRAME','KEYFRAME'].includes(upper(x.role))
    );
    if(!frameRefs.length)throw errorOf(
      'VIDEO lock requires selected keyframe/first-frame Generation Candidate reference',
      'AIGC_VIDEO_KEYFRAME_REFERENCE_REQUIRED',409
    );
    const ids=frameRefs.map(x=>x.referenceId);
    const placeholders=ids.map(()=>'?').join(',');
    const [frameRows]=await db.execute(
      `SELECT c.id,c.candidate_key,c.is_current,c.selection_status,j.status AS job_status,j.generation_kind
         FROM aigc_generation_candidates c JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
        WHERE c.project_id=? AND c.id IN (${placeholders})`,[req.project_id,...ids]
    );
    if(frameRows.length!==new Set(ids).size||frameRows.some(x=>
      x.generation_kind!=='KEYFRAME'||x.job_status!=='PASS'||!['SELECTED','LOCKED'].includes(x.selection_status)||!x.is_current
    ))throw errorOf('VIDEO reference must point to CURRENT selected/locked KEYFRAME',
      'AIGC_VIDEO_KEYFRAME_REFERENCE_INVALID',409);
  }

  const lockFingerprint=sha256({
    requirementId:req.id,generationJobId:input.generationJobId,candidateId:input.candidateId,
    qa,rights:input.rights,timing:input.timing
  });
  const conn=await db.getConnection(),lockId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO aigc_production_locks
        (id,project_id,production_requirement_id,generation_job_id,candidate_id,lock_key,
         lock_fingerprint_sha256,qa_snapshot_json,rights_json,timing_json,status,evidence_json,
         locked_by_identity_id,locked_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'LOCKED',?,?,?)`,
      [lockId,req.project_id,req.id,input.generationJobId,input.candidateId,input.lockKey,lockFingerprint,
       asJson(qa),asJson(input.rights),asJson(input.timing),asJson(input.evidence),actorId,
       input.lockedAt?new Date(input.lockedAt):new Date()]
    );
    await conn.execute("UPDATE aigc_shot_production_requirements SET status='LOCKED' WHERE id=?",[req.id]);
    await insertTrace(conn,{projectId:req.project_id,sourceType:'PRODUCTION_REQUIREMENT',sourceId:req.id,
      targetType:'GENERATION_CANDIDATE',targetId:input.candidateId,linkType:'LOCKS_OUTPUT',actorId,
      evidence:{productionType:req.production_type,lockId,lockFingerprint}});
    await conn.commit();
    return {id:lockId,projectId:req.project_id,requirementId:req.id,productionType:req.production_type,
      generationJobId:input.generationJobId,candidateId:input.candidateId,status:'LOCKED',
      lockFingerprintSha256:lockFingerprint};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createAigcProductionFailureAnalysis=async(generationJobId,input={},actorId=null)=>{
  requireFields(input,['failureCategory','affectedScope','rerunScope','rootEvidence','evidence'],
    'INVALID_AIGC_PRODUCTION_FAILURE_ANALYSIS');
  const category=upper(input.failureCategory);
  if(!FAILURE_CATEGORIES.has(category))throw errorOf(
    'Unsupported production failure category','AIGC_PRODUCTION_FAILURE_CATEGORY_INVALID',409,{category}
  );
  const db=getRuntimePool();
  const [jobs]=await db.execute('SELECT * FROM aigc_generation_jobs WHERE id=?',[generationJobId]);
  const job=jobs[0];
  if(!job)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  if(!PRODUCTION_TYPE_SET.has(job.generation_kind)||!['FAIL','BLOCKED'].includes(job.status))
    throw errorOf('Failure analysis requires failed/blocked Stage 08 Generation Job',
      'AIGC_PRODUCTION_FAILURE_JOB_INVALID',409,{generationKind:job.generation_kind,status:job.status}
    );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_production_failure_analyses
      (id,project_id,generation_job_id,failure_category,affected_scope_json,rerun_scope_json,
       root_evidence_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,'OPEN',?,?)`,
    [id,job.project_id,generationJobId,category,asJson(input.affectedScope),asJson(input.rerunScope),
     asJson(input.rootEvidence),asJson(input.evidence),actorId]
  );
  return {id,projectId:job.project_id,generationJobId,failureCategory:category,status:'OPEN'};
};

export const resolveAigcProductionFailureAnalysis=async(failureAnalysisId,input={},actorId=null)=>{
  requireFields(input,['replacementGenerationJobId','resolution','evidence'],
    'INVALID_AIGC_PRODUCTION_FAILURE_RESOLUTION');
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT f.*,j.shot_id,j.generation_kind
       FROM aigc_production_failure_analyses f
       JOIN aigc_generation_jobs j ON j.id=f.generation_job_id
      WHERE f.id=?`,[failureAnalysisId]
  );
  const failure=rows[0];
  if(!failure)throw errorOf('Production failure analysis not found','AIGC_PRODUCTION_FAILURE_NOT_FOUND',404);
  if(failure.status!=='OPEN')throw errorOf(
    'Only OPEN failure analysis can be resolved','AIGC_PRODUCTION_FAILURE_STATE_INVALID',409,{status:failure.status}
  );
  const [replacements]=await db.execute('SELECT * FROM aigc_generation_jobs WHERE id=?',[input.replacementGenerationJobId]);
  const replacement=replacements[0];
  if(!replacement||replacement.project_id!==failure.project_id||replacement.shot_id!==failure.shot_id||
     replacement.generation_kind!==failure.generation_kind||replacement.status!=='PASS')
    throw errorOf('Replacement Generation Job must PASS in the same shot/type scope',
      'AIGC_PRODUCTION_FAILURE_REPLACEMENT_INVALID',409
    );
  await db.execute(
    `UPDATE aigc_production_failure_analyses
        SET status='RESOLVED',replacement_generation_job_id=?,resolution_json=?,evidence_json=?,resolved_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [replacement.id,asJson(input.resolution),asJson(input.evidence),failureAnalysisId]
  );
  await insertTrace(db,{projectId:failure.project_id,sourceType:'GENERATION_JOB',sourceId:failure.generation_job_id,
    targetType:'GENERATION_JOB',targetId:replacement.id,linkType:'LOCALLY_RERUN_AS',actorId,
    evidence:{failureAnalysisId,resolution:input.resolution}});
  return {id:failureAnalysisId,status:'RESOLVED',replacementGenerationJobId:replacement.id};
};

export const evaluateAigcProductionGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const imageGate=await evaluateAigcImageGate(projectId,{asOf,persist:false},actorId);
  if(imageGate.status!=='PASS')reasons.push('G_AIGC_IMAGE_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.currentBreakdownPlanId=breakdown?.id||null;
  if(!breakdown)reasons.push('AIGC_BREAKDOWN_PLAN_REQUIRED');
  else{
    const [shots,requirements,locks,failJobs,failures]=await Promise.all([
      listRows(db,'SELECT id,shot_key FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY shot_key',[breakdown.id]),
      listRows(db,'SELECT * FROM aigc_shot_production_requirements WHERE breakdown_plan_id=? ORDER BY shot_id,production_type',[breakdown.id]),
      listRows(db,
        `SELECT l.*,r.production_type,r.applicability,r.shot_id,c.is_current,c.selection_status,c.qa_json,c.safety_json,
                j.status AS job_status,j.generation_kind
           FROM aigc_production_locks l
           JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
           JOIN aigc_generation_candidates c ON c.id=l.candidate_id
           JOIN aigc_generation_jobs j ON j.id=l.generation_job_id
          WHERE r.breakdown_plan_id=?`,[breakdown.id]),
      listRows(db,
        `SELECT * FROM aigc_generation_jobs
          WHERE breakdown_plan_id=? AND generation_kind IN ('VIDEO','DIALOGUE','VOICE','MUSIC','SFX')
            AND status IN ('FAIL','BLOCKED')`,[breakdown.id]),
      listRows(db,
        `SELECT f.* FROM aigc_production_failure_analyses f
          JOIN aigc_generation_jobs j ON j.id=f.generation_job_id
         WHERE j.breakdown_plan_id=?`,[breakdown.id])
    ]);

    const reqByPair=new Map(requirements.map(x=>[x.shot_id+'|'+x.production_type,x]));
    const missingPairs=[];
    for(const shot of shots)for(const type of PRODUCTION_TYPES){
      if(!reqByPair.has(shot.id+'|'+type))missingPairs.push(shot.id+'|'+type);
    }
    if(missingPairs.length)reasons.push('AIGC_PRODUCTION_REQUIREMENT_COVERAGE_INCOMPLETE');
    const invalidVideo=requirements.filter(x=>x.production_type==='VIDEO'&&x.applicability!=='REQUIRED');
    if(invalidVideo.length)reasons.push('AIGC_VIDEO_REQUIREMENT_MANDATORY');

    const lockByReq=new Map(locks.map(x=>[x.production_requirement_id,x]));
    const required=requirements.filter(x=>x.applicability==='REQUIRED');
    const requiredUnlocked=required.filter(x=>x.status!=='LOCKED'||!lockByReq.has(x.id));
    if(requiredUnlocked.length)reasons.push('AIGC_REQUIRED_PRODUCTION_OUTPUT_UNLOCKED');
    const invalidLocks=locks.filter(x=>
      x.status!=='LOCKED'||x.job_status!=='PASS'||x.selection_status!=='SELECTED'||!x.is_current||
      x.generation_kind!==x.production_type||
      !isAigcCandidateQaPass(parseJson(x.qa_json)||{},x.production_type)||
      upper((parseJson(x.safety_json)||{}).status||'PASS')!=='PASS'
    );
    if(invalidLocks.length)reasons.push('AIGC_PRODUCTION_LOCK_STALE_OR_INVALID');

    const failureMap=new Map(failures.map(x=>[x.generation_job_id,x]));
    const unanalyzedFailures=failJobs.filter(x=>!failureMap.has(x.id));
    if(unanalyzedFailures.length)reasons.push('AIGC_PRODUCTION_FAILURE_ANALYSIS_REQUIRED');
    const unresolvedFailures=failures.filter(x=>x.status!=='RESOLVED');
    if(unresolvedFailures.length)reasons.push('AIGC_PRODUCTION_FAILURE_UNRESOLVED');

    evidence.shotCount=shots.length;
    evidence.requirementCount=requirements.length;
    evidence.requiredCount=required.length;
    evidence.notApplicableCount=requirements.filter(x=>x.applicability==='N_A').length;
    evidence.lockedRequiredCount=required.filter(x=>x.status==='LOCKED'&&lockByReq.has(x.id)).length;
    evidence.videoRequiredCount=requirements.filter(x=>x.production_type==='VIDEO'&&x.applicability==='REQUIRED').length;
    evidence.lockCountsByType=Object.fromEntries(PRODUCTION_TYPES.map(type=>[
      type,locks.filter(x=>x.production_type===type&&x.status==='LOCKED').length
    ]));
    evidence.failedOrBlockedJobCount=failJobs.length;
    evidence.failureAnalysisCount=failures.length;
    evidence.unresolvedFailureCount=unresolvedFailures.length;
    evidence.productionReady=
      shots.length>0&&missingPairs.length===0&&invalidVideo.length===0&&requiredUnlocked.length===0&&
      invalidLocks.length===0&&unanalyzedFailures.length===0&&unresolvedFailures.length===0;
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m2810_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcProductionState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  const [requirements,locks,failures,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_shot_production_requirements WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_locks WHERE project_id=? ORDER BY locked_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_production_failure_analyses WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2810_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['视频与动作生产','对白与声音生产','音乐与音效生产','生产失败与局部重跑'],
      gateName:'视频 / 音频生产门禁',
      productionTypeLabels:{VIDEO:'视频',DIALOGUE:'对白',VOICE:'声音',MUSIC:'音乐 / OST',SFX:'音效'},
      applicabilityLabels:{REQUIRED:'必需',N_A:'不适用'}
    },
    currentBreakdownPlanId:breakdown?.id||null,
    requirements:requirements.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,shotId:x.shot_id,requirementKey:x.requirement_key,
      productionType:x.production_type,applicability:x.applicability,sourceSpec:parseJson(x.source_spec_json),
      qaPolicy:parseJson(x.qa_policy_json),rationale:x.rationale,status:x.status
    })),
    locks:locks.map(x=>({
      id:x.id,productionRequirementId:x.production_requirement_id,generationJobId:x.generation_job_id,
      candidateId:x.candidate_id,lockKey:x.lock_key,lockFingerprintSha256:x.lock_fingerprint_sha256,
      qaSnapshot:parseJson(x.qa_snapshot_json),rights:parseJson(x.rights_json),timing:parseJson(x.timing_json),
      status:x.status,lockedAt:x.locked_at
    })),
    failures:failures.map(x=>({
      id:x.id,generationJobId:x.generation_job_id,failureCategory:x.failure_category,
      affectedScope:parseJson(x.affected_scope_json),rerunScope:parseJson(x.rerun_scope_json),
      rootEvidence:parseJson(x.root_evidence_json),status:x.status,
      replacementGenerationJobId:x.replacement_generation_job_id||null,
      resolution:parseJson(x.resolution_json),resolvedAt:x.resolved_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
