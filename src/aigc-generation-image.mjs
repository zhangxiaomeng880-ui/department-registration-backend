import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcAssetGate } from './aigc-asset-system.mjs';

const GATE='G-AIGC-IMAGE';
const GENERATION_KINDS=new Set(['IMAGE','KEYFRAME','STORYBOARD']);
const JOB_STATUSES=new Set(['QUEUED','RUNNING','PASS','FAIL','BLOCKED']);
const CANDIDATE_STATUSES=new Set(['CANDIDATE','SELECTED','LOCKED','REJECTED','HISTORICAL']);
const SHA64=/^[0-9a-f]{64}$/i;
const QA_DIMENSIONS=[
  'identity','look','sceneProp','actionPose','expressionPerformance','gazeBlocking',
  'anatomyHands','spatialScalePerspective','compositionCamera','lightingColor',
  'textUi','multiFormatSafety','technicalIntegrity'
];

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{if(v==null)return false;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;};
const requireFields=(input,fields,code)=>{const missing=fields.filter(k=>!nonEmpty(input?.[k]));if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Generation requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
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
const validateSha=(value,field)=>{
  if(!SHA64.test(String(value||'')))throw errorOf(field+' must be SHA-256','AIGC_GENERATION_SHA_INVALID',409,{field});
};
const qaPass=qa=>QA_DIMENSIONS.every(key=>['PASS','N_A'].includes(upper(qa?.[key])));
const validateQa=qa=>{
  if(!qa||typeof qa!=='object')throw errorOf('Candidate QA is required','AIGC_CANDIDATE_QA_REQUIRED',409);
  const missing=QA_DIMENSIONS.filter(key=>!['PASS','N_A','FAIL'].includes(upper(qa[key])));
  if(missing.length)throw errorOf('Candidate QA dimensions are incomplete','AIGC_CANDIDATE_QA_INCOMPLETE',409,{missing});
};

export const resolveAigcGenerationProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const resolveAigcGenerationJobScope=async generationJobId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT j.project_id,p.workspace_id
       FROM aigc_generation_jobs j JOIN projects p ON p.id=j.project_id
      WHERE j.id=?`,[generationJobId]
  );
  if(!rows.length)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const resolveAigcGenerationCandidateScope=async candidateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.project_id,p.workspace_id
       FROM aigc_generation_candidates c JOIN projects p ON p.id=c.project_id
      WHERE c.id=?`,[candidateId]
  );
  if(!rows.length)throw errorOf('Generation Candidate not found','AIGC_GENERATION_CANDIDATE_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcGenerationJob=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'jobKey','generationKind','shotId','parentCallSheetId','provider','modelTool','modelToolVersion',
    'prompt','promptVersion','referenceBindings','parameters','inputFingerprintSha256',
    'requestedOutputCount','retry','safety','provenance','evidence'
  ],'INVALID_AIGC_GENERATION_JOB');

  const generationKind=upper(input.generationKind);
  if(!GENERATION_KINDS.has(generationKind))throw errorOf(
    'Unsupported generation kind','AIGC_GENERATION_KIND_INVALID',409,{generationKind}
  );
  validateSha(input.inputFingerprintSha256,'inputFingerprintSha256');
  const requestedOutputCount=Number(input.requestedOutputCount);
  if(!Number.isInteger(requestedOutputCount)||requestedOutputCount<1||requestedOutputCount>32)
    throw errorOf('requestedOutputCount must be between 1 and 32','AIGC_GENERATION_OUTPUT_COUNT_INVALID',409);
  if(!Array.isArray(input.referenceBindings)||!input.referenceBindings.length)
    throw errorOf('Generation requires version-pinned references','AIGC_GENERATION_REFERENCE_REQUIRED',409);
  for(const ref of input.referenceBindings){
    requireFields(ref,['referenceId','role','versionKey'],'AIGC_GENERATION_REFERENCE_INVALID');
  }

  const db=getRuntimePool();
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current frozen Breakdown is required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const assetGate=await evaluateAigcAssetGate(projectId,{persist:false},actorId);
  if(assetGate.status!=='PASS')throw errorOf(
    'G-AIGC-ASSET must PASS before Generation','G_AIGC_ASSET_REQUIRED',409,{reasonCodes:assetGate.reasonCodes}
  );

  const [shots]=await db.execute(
    'SELECT * FROM aigc_shots WHERE id=? AND project_id=? AND breakdown_plan_id=?',
    [input.shotId,projectId,breakdown.id]
  );
  if(!shots.length)throw errorOf('Generation shot is not in current Breakdown','AIGC_GENERATION_SHOT_STALE',409);

  const [callSheets]=await db.execute(
    `SELECT cs.*,req.shot_id
       FROM aigc_asset_call_sheets cs
       JOIN aigc_shot_asset_requirements req ON req.id=cs.asset_requirement_id
      WHERE cs.id=? AND cs.project_id=? AND cs.breakdown_plan_id=?`,
    [input.parentCallSheetId,projectId,breakdown.id]
  );
  const callSheet=callSheets[0];
  if(!callSheet||callSheet.shot_id!==input.shotId)throw errorOf(
    'Generation Call Sheet must belong to the current shot','AIGC_GENERATION_CALL_SHEET_SCOPE_INVALID',409
  );
  if(callSheet.status!=='READY')throw errorOf(
    'Generation Call Sheet must be READY','AIGC_GENERATION_CALL_SHEET_NOT_READY',409
  );

  const preflight=parseJson(callSheet.preflight_json)||{};
  if(upper(preflight.status)!=='PASS')throw errorOf(
    'Generation Call Sheet preflight must PASS','AIGC_GENERATION_CALL_SHEET_PREFLIGHT_NOT_PASS',409,
    {parentCallSheetId:callSheet.id,preflightStatus:preflight.status||null}
  );

  const requiredCallSheetRefs=await listRows(db,
    `SELECT b.reference_asset_version_id,b.reference_role,b.required,v.version_key,v.state
       FROM aigc_call_sheet_reference_bindings b
       JOIN aigc_asset_versions v ON v.id=b.reference_asset_version_id
      WHERE b.call_sheet_id=? AND b.required=TRUE AND b.status='READY'
      ORDER BY b.reference_role,b.reference_asset_version_id`,
    [callSheet.id]
  );
  const inputRefByTuple=new Map(input.referenceBindings.map(x=>[
    `${x.referenceId}:${upper(x.role)}`,x
  ]));
  const missingInheritedRefs=requiredCallSheetRefs.filter(x=>{
    const supplied=inputRefByTuple.get(`${x.reference_asset_version_id}:${upper(x.reference_role)}`);
    return !supplied||supplied.versionKey!==x.version_key;
  });
  if(missingInheritedRefs.length)throw errorOf(
    'Generation must inherit every required Parent Call Sheet reference',
    'AIGC_GENERATION_REQUIRED_REFERENCE_NOT_INHERITED',409,{
      missingReferences:missingInheritedRefs.map(x=>({
        referenceId:x.reference_asset_version_id,role:x.reference_role,versionKey:x.version_key
      }))
    }
  );

  const referenceVersionIds=[...new Set(input.referenceBindings.map(x=>x.referenceId))];
  const [referenceRows]=referenceVersionIds.length
    ?await db.query(
      `SELECT v.id,v.version_key,v.state,a.owner_project_id,l.library_scope,l.permission_policy_json,
              l.rights_policy_json,l.usage_scope_json
         FROM aigc_asset_versions v
         JOIN aigc_assets a ON a.id=v.asset_id
         JOIN aigc_asset_libraries l ON l.id=a.library_id
        WHERE v.workspace_id=(SELECT workspace_id FROM projects WHERE id=?)
          AND v.id IN (${referenceVersionIds.map(()=>'?').join(',')})`,
      [projectId,...referenceVersionIds]
    )
    :[[]];
  const refMap=new Map(referenceRows.map(x=>[x.id,x]));
  for(const ref of input.referenceBindings){
    const row=refMap.get(ref.referenceId);
    if(!row||row.version_key!==ref.versionKey||!['PASS','CURRENT','LOCKED','FROZEN'].includes(row.state))
      throw errorOf('Generation reference is not an exact approved asset version',
        'AIGC_GENERATION_REFERENCE_VERSION_INVALID',409,{referenceId:ref.referenceId,versionKey:ref.versionKey});
    if(row.owner_project_id!==projectId){
      const permission=parseJson(row.permission_policy_json)||{};
      const rights=parseJson(row.rights_policy_json)||{};
      const usageScope=parseJson(row.usage_scope_json)||{};
      if(row.library_scope!=='WORKSPACE'||permission.crossProjectReuse!==true||rights.reuseAllowed===false||
         (Array.isArray(usageScope.allowedProjectIds)&&usageScope.allowedProjectIds.length&&!usageScope.allowedProjectIds.includes(projectId)))
        throw errorOf('Generation reference is outside governed project/workspace reuse scope',
          'AIGC_GENERATION_REFERENCE_SCOPE_DENIED',409,{referenceId:ref.referenceId});
    }
  }
  const generationPreflight={
    status:'PASS',
    parentCallSheetId:callSheet.id,
    callSheetPreflightStatus:'PASS',
    requiredInheritedReferenceCount:requiredCallSheetRefs.length,
    suppliedReferenceCount:input.referenceBindings.length,
    inheritedRequiredReferences:requiredCallSheetRefs.map(x=>({
      referenceId:x.reference_asset_version_id,role:x.reference_role,versionKey:x.version_key
    }))
  };

  const id=randomUUID(),status=upper(input.status||'QUEUED');
  if(!JOB_STATUSES.has(status)||['PASS','FAIL'].includes(status))
    throw errorOf('New Generation Job must start QUEUED/RUNNING/BLOCKED','AIGC_GENERATION_INITIAL_STATUS_INVALID',409);

  await db.execute(
    `INSERT INTO aigc_generation_jobs
      (id,project_id,breakdown_plan_id,shot_id,parent_call_sheet_id,job_key,generation_kind,
       provider,model_tool,model_tool_version,tool_key,skill_key,mcp_key,prompt_text,negative_prompt_text,
       prompt_version,reference_bindings_json,preflight_json,parameters_json,input_fingerprint_sha256,requested_output_count,
       started_at,usage_json,cost_json,status,retry_json,safety_json,provenance_json,evidence_json,
       created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    [
      id,projectId,breakdown.id,input.shotId,input.parentCallSheetId,input.jobKey,generationKind,
      input.provider,input.modelTool,input.modelToolVersion,input.toolKey||null,input.skillKey||null,input.mcpKey||null,
      input.prompt,input.negativePrompt||null,input.promptVersion,asJson(input.referenceBindings),asJson(generationPreflight),asJson(input.parameters),
      String(input.inputFingerprintSha256).toLowerCase(),requestedOutputCount,
      input.startedAt?new Date(input.startedAt):(status==='RUNNING'?new Date():null),
      asJson(input.usage||{}),asJson(input.cost||{}),status,asJson(input.retry),asJson(input.safety),
      asJson(input.provenance),asJson(input.evidence),actorId
    ]
  );
  await insertTrace(db,{projectId,sourceType:'ASSET_CALL_SHEET',sourceId:input.parentCallSheetId,
    targetType:'GENERATION_JOB',targetId:id,linkType:'EXECUTES_AS',actorId,
    evidence:{jobKey:input.jobKey,generationKind,inputFingerprintSha256:input.inputFingerprintSha256}});
  await insertTrace(db,{projectId,sourceType:'SHOT',sourceId:input.shotId,
    targetType:'GENERATION_JOB',targetId:id,linkType:'GENERATES',actorId,
    evidence:{jobKey:input.jobKey,generationKind}});
  return {id,projectId,breakdownPlanId:breakdown.id,shotId:input.shotId,parentCallSheetId:input.parentCallSheetId,
    jobKey:input.jobKey,generationKind,status,requestedOutputCount};
};

export const addAigcGenerationCandidate=async(generationJobId,input={})=>{
  requireFields(input,[
    'candidateKey','outputIndex','contentLocator','outputFingerprintSha256','qa','safety','evidence'
  ],'INVALID_AIGC_GENERATION_CANDIDATE');
  validateSha(input.outputFingerprintSha256,'outputFingerprintSha256');
  validateQa(input.qa);
  const outputIndex=Number(input.outputIndex),candidateVersionNo=Number(input.candidateVersionNo||1);
  if(!Number.isInteger(outputIndex)||outputIndex<1||!Number.isInteger(candidateVersionNo)||candidateVersionNo<1)
    throw errorOf('Candidate output/version index is invalid','AIGC_CANDIDATE_INDEX_INVALID',409);
  if(!nonEmpty(input.contentLocator))throw errorOf('Candidate content locator is required','AIGC_CANDIDATE_LOCATOR_REQUIRED',409);

  const db=getRuntimePool();
  const [jobs]=await db.execute('SELECT * FROM aigc_generation_jobs WHERE id=?',[generationJobId]);
  const job=jobs[0];
  if(!job)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  if(['PASS','FAIL','BLOCKED'].includes(job.status))throw errorOf(
    'Cannot add candidates to terminal Generation Job','AIGC_GENERATION_JOB_TERMINAL',409,{status:job.status}
  );
  const [existing]=await db.execute('SELECT COUNT(*) count FROM aigc_generation_candidates WHERE generation_job_id=?',[generationJobId]);
  if(Number(existing[0].count)>=Number(job.requested_output_count))throw errorOf(
    'Generation candidate count exceeds requested output count','AIGC_GENERATION_OUTPUT_COUNT_EXCEEDED',409
  );

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_generation_candidates
      (id,project_id,generation_job_id,shot_id,candidate_key,output_index,candidate_version_no,
       content_locator_json,output_fingerprint_sha256,qa_json,compare_group,selection_status,is_current,
       rejected_reason,human_comment,safety_json,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'CANDIDATE',FALSE,?,?,?,?)`,
    [
      id,job.project_id,generationJobId,job.shot_id,input.candidateKey,outputIndex,candidateVersionNo,
      asJson(input.contentLocator),String(input.outputFingerprintSha256).toLowerCase(),asJson(input.qa),
      input.compareGroup||null,input.rejectedReason||null,input.humanComment||null,
      asJson(input.safety),asJson(input.evidence)
    ]
  );
  await insertTrace(db,{projectId:job.project_id,sourceType:'GENERATION_JOB',sourceId:generationJobId,
    targetType:'GENERATION_CANDIDATE',targetId:id,linkType:'OUTPUTS',actorId:null,
    evidence:{candidateKey:input.candidateKey,outputIndex}});
  return {id,generationJobId,shotId:job.shot_id,candidateKey:input.candidateKey,outputIndex,
    candidateVersionNo,selectionStatus:'CANDIDATE',qaPass:qaPass(input.qa)};
};

export const completeAigcGenerationJob=async(generationJobId,input={})=>{
  requireFields(input,['status','usage','cost','safety','provenance','evidence'],'INVALID_AIGC_GENERATION_COMPLETION');
  const status=upper(input.status);
  if(!['PASS','FAIL','BLOCKED'].includes(status))throw errorOf(
    'Completion status must be PASS/FAIL/BLOCKED','AIGC_GENERATION_COMPLETION_STATUS_INVALID',409
  );
  const db=getRuntimePool();
  const [jobs]=await db.execute('SELECT * FROM aigc_generation_jobs WHERE id=?',[generationJobId]);
  const job=jobs[0];
  if(!job)throw errorOf('Generation Job not found','AIGC_GENERATION_JOB_NOT_FOUND',404);
  if(['PASS','FAIL','BLOCKED'].includes(job.status)){
    if(job.status===status)return {id:job.id,status:job.status,idempotent:true};
    throw errorOf('Generation Job already terminal with different status','AIGC_GENERATION_TERMINAL_CONFLICT',409,
      {currentStatus:job.status,requestedStatus:status});
  }
  const [candidates]=await db.execute('SELECT * FROM aigc_generation_candidates WHERE generation_job_id=?',[generationJobId]);
  if(status==='PASS'&&!candidates.length)throw errorOf(
    'PASS Generation Job requires at least one candidate','AIGC_GENERATION_CANDIDATE_REQUIRED',409
  );
  if(status!=='PASS'&&!nonEmpty(input.errorCode))
    throw errorOf('Failed/blocked Generation Job requires errorCode','AIGC_GENERATION_ERROR_REQUIRED',409);
  const finishedAt=input.finishedAt?new Date(input.finishedAt):new Date();
  const started=job.started_at?new Date(job.started_at):null;
  const latencyMs=input.latencyMs!=null?Number(input.latencyMs):
    (started?Math.max(0,finishedAt.getTime()-started.getTime()):null);

  await db.execute(
    `UPDATE aigc_generation_jobs
        SET status=?,finished_at=?,latency_ms=?,usage_json=?,cost_json=?,safety_json=?,provenance_json=?,
            error_code=?,error_message=?,retry_json=?,evidence_json=?
      WHERE id=?`,
    [
      status,finishedAt,latencyMs,asJson(input.usage),asJson(input.cost),asJson(input.safety),
      asJson(input.provenance),input.errorCode||null,input.errorMessage||null,asJson(input.retry||parseJson(job.retry_json)||{}),
      asJson(input.evidence),generationJobId
    ]
  );
  return {id:generationJobId,status,candidateCount:candidates.length,latencyMs,idempotent:false};
};

export const selectAigcGenerationCandidate=async(candidateId,input={},actorId=null)=>{
  requireFields(input,['eventType','reason','evidence'],'INVALID_AIGC_CANDIDATE_SELECTION');
  const eventType=upper(input.eventType);
  if(!['SELECT','RESTORE','LOCK'].includes(eventType))throw errorOf(
    'Selection eventType must be SELECT, RESTORE or LOCK','AIGC_CANDIDATE_SELECTION_EVENT_INVALID',409
  );
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.*,j.status AS job_status,j.generation_kind,j.project_id AS job_project_id
       FROM aigc_generation_candidates c
       JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
      WHERE c.id=?`,[candidateId]
  );
  const candidate=rows[0];
  if(!candidate)throw errorOf('Generation Candidate not found','AIGC_GENERATION_CANDIDATE_NOT_FOUND',404);
  if(candidate.job_status!=='PASS')throw errorOf(
    'Candidate can be selected only after Generation Job PASS','AIGC_GENERATION_JOB_PASS_REQUIRED',409
  );
  const qa=parseJson(candidate.qa_json)||{};
  if(!qaPass(qa))throw errorOf(
    'Candidate QA must PASS before selection','AIGC_CANDIDATE_QA_PASS_REQUIRED',409,
    {failedDimensions:QA_DIMENSIONS.filter(key=>upper(qa[key])==='FAIL')}
  );
  const safety=parseJson(candidate.safety_json)||{};
  if(upper(safety.status||'PASS')!=='PASS')throw errorOf(
    'Candidate safety must PASS before selection','AIGC_CANDIDATE_SAFETY_PASS_REQUIRED',409
  );

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [currentRows]=await conn.execute(
      "SELECT * FROM aigc_generation_candidates WHERE shot_id=? AND is_current=TRUE LIMIT 1 FOR UPDATE",
      [candidate.shot_id]
    );
    const current=currentRows[0]||null;

    if(eventType==='LOCK'){
      if(!candidate.is_current||current?.id!==candidateId||!['SELECTED','LOCKED'].includes(candidate.selection_status))
        throw errorOf('Candidate must be current SELECTED before lock','AIGC_CANDIDATE_CURRENT_REQUIRED_FOR_LOCK',409);
      if(candidate.selection_status==='LOCKED'){
        await conn.commit();
        return {id:candidateId,shotId:candidate.shot_id,selectionStatus:'LOCKED',isCurrent:true,
          lockedAt:candidate.locked_at,eventType,idempotent:true};
      }
      const lockedAt=new Date();
      await conn.execute(
        "UPDATE aigc_generation_candidates SET selection_status='LOCKED',locked_at=?,human_comment=? WHERE id=?",
        [lockedAt,input.humanComment||candidate.human_comment||null,candidateId]
      );
      await conn.execute(
        `INSERT INTO aigc_candidate_selection_events
          (id,project_id,shot_id,from_candidate_id,to_candidate_id,event_type,reason,evidence_json,selected_by_identity_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),candidate.project_id,candidate.shot_id,candidateId,candidateId,'LOCK',
         input.reason,asJson(input.evidence),actorId]
      );
      await insertTrace(conn,{projectId:candidate.project_id,sourceType:'GENERATION_CANDIDATE',sourceId:candidateId,
        targetType:'SHOT',targetId:candidate.shot_id,linkType:'LOCKED_FOR',actorId,
        evidence:{eventType:'LOCK',reason:input.reason,generationKind:candidate.generation_kind}});
      await conn.commit();
      return {id:candidateId,shotId:candidate.shot_id,selectionStatus:'LOCKED',isCurrent:true,
        lockedAt,eventType,idempotent:false};
    }

    if(current?.selection_status==='LOCKED'&&current.id!==candidateId)
      throw errorOf('Locked current candidate cannot be replaced without a new governed production version',
        'AIGC_LOCKED_CANDIDATE_REPLACEMENT_FORBIDDEN',409,{currentCandidateId:current.id});
    if(current?.id===candidateId){
      await conn.commit();
      return {id:candidateId,shotId:candidate.shot_id,selectionStatus:current.selection_status,isCurrent:true,
        eventType,idempotent:true};
    }
    if(current){
      await conn.execute(
        "UPDATE aigc_generation_candidates SET is_current=FALSE,selection_status='HISTORICAL' WHERE id=?",
        [current.id]
      );
    }
    await conn.execute(
      "UPDATE aigc_generation_candidates SET is_current=TRUE,selection_status='SELECTED',locked_at=NULL,rejected_reason=NULL,human_comment=? WHERE id=?",
      [input.humanComment||candidate.human_comment||null,candidateId]
    );
    await conn.execute(
      `INSERT INTO aigc_candidate_selection_events
        (id,project_id,shot_id,from_candidate_id,to_candidate_id,event_type,reason,evidence_json,selected_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(),candidate.project_id,candidate.shot_id,current?.id||null,candidateId,eventType,
       input.reason,asJson(input.evidence),actorId]
    );
    await insertTrace(conn,{projectId:candidate.project_id,sourceType:'GENERATION_CANDIDATE',sourceId:candidateId,
      targetType:'SHOT',targetId:candidate.shot_id,linkType:'SELECTED_FOR',actorId,
      evidence:{eventType,reason:input.reason,generationKind:candidate.generation_kind}});
    await conn.commit();
    return {id:candidateId,shotId:candidate.shot_id,selectionStatus:'SELECTED',isCurrent:true,
      previousCandidateId:current?.id||null,eventType,idempotent:false};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const rejectAigcGenerationCandidate=async(candidateId,input={})=>{
  requireFields(input,['reason','evidence'],'INVALID_AIGC_CANDIDATE_REJECTION');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_generation_candidates WHERE id=?',[candidateId]);
  const candidate=rows[0];
  if(!candidate)throw errorOf('Generation Candidate not found','AIGC_GENERATION_CANDIDATE_NOT_FOUND',404);
  if(candidate.is_current)throw errorOf(
    'Current selected candidate cannot be rejected without selecting another candidate',
    'AIGC_CURRENT_CANDIDATE_REJECTION_FORBIDDEN',409
  );
  await db.execute(
    "UPDATE aigc_generation_candidates SET selection_status='REJECTED',rejected_reason=?,human_comment=? WHERE id=?",
    [input.reason,input.humanComment||null,candidateId]
  );
  return {id:candidateId,selectionStatus:'REJECTED',reason:input.reason};
};

export const evaluateAigcImageGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const assetGate=await evaluateAigcAssetGate(projectId,{asOf,persist:false},actorId);
  if(assetGate.status!=='PASS')reasons.push('G_AIGC_ASSET_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.currentBreakdownPlanId=breakdown?.id||null;
  if(!breakdown)reasons.push('AIGC_BREAKDOWN_PLAN_REQUIRED');
  else{
    const [shots,jobs,candidates]=await Promise.all([
      listRows(db,'SELECT id,shot_key FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY id',[breakdown.id]),
      listRows(db,
        `SELECT * FROM aigc_generation_jobs
          WHERE breakdown_plan_id=? AND generation_kind='KEYFRAME' AND status='PASS' ORDER BY created_at,id`,
        [breakdown.id]),
      listRows(db,
        `SELECT c.*,j.breakdown_plan_id,j.generation_kind,j.status AS job_status
           FROM aigc_generation_candidates c
           JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
          WHERE j.breakdown_plan_id=? AND j.generation_kind='KEYFRAME' ORDER BY c.created_at,c.id`,
        [breakdown.id])
    ]);
    const passJobShotIds=new Set(jobs.map(x=>x.shot_id));
    const currentSelected=candidates.filter(x=>x.is_current&&['SELECTED','LOCKED'].includes(x.selection_status)&&x.job_status==='PASS');
    const currentByShot=new Map(currentSelected.map(x=>[x.shot_id,x]));
    const shotsWithoutPassJob=shots.filter(x=>!passJobShotIds.has(x.id));
    const shotsWithoutCurrent=shots.filter(x=>!currentByShot.has(x.id));
    const qaFailed=currentSelected.filter(x=>!qaPass(parseJson(x.qa_json)||{}));
    const safetyFailed=currentSelected.filter(x=>upper((parseJson(x.safety_json)||{}).status||'PASS')!=='PASS');
    const locatorMissing=currentSelected.filter(x=>!nonEmpty(parseJson(x.content_locator_json)));

    if(shotsWithoutPassJob.length)reasons.push('AIGC_KEYFRAME_GENERATION_COVERAGE_INCOMPLETE');
    if(shotsWithoutCurrent.length)reasons.push('AIGC_KEYFRAME_CURRENT_SELECTION_INCOMPLETE');
    if(qaFailed.length)reasons.push('AIGC_KEYFRAME_QA_NOT_PASS');
    if(safetyFailed.length)reasons.push('AIGC_KEYFRAME_SAFETY_NOT_PASS');
    if(locatorMissing.length)reasons.push('AIGC_KEYFRAME_CONTENT_LOCATOR_REQUIRED');

    evidence.shotCount=shots.length;
    evidence.passKeyframeJobCount=jobs.length;
    evidence.passKeyframeShotCount=passJobShotIds.size;
    evidence.currentSelectedKeyframeCount=currentSelected.length;
    evidence.currentSelectedShotCount=currentByShot.size;
    evidence.lockedKeyframeCount=currentSelected.filter(x=>x.selection_status==='LOCKED').length;
    evidence.qaFailedCandidateIds=qaFailed.map(x=>x.id);
    evidence.safetyFailedCandidateIds=safetyFailed.map(x=>x.id);
    evidence.missingLocatorCandidateIds=locatorMissing.map(x=>x.id);
    evidence.videoReferenceReady=
      shots.length>0&&shotsWithoutPassJob.length===0&&shotsWithoutCurrent.length===0&&
      qaFailed.length===0&&safetyFailed.length===0&&locatorMissing.length===0;
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m289_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcGenerationState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const breakdown=await currentBreakdown(projectId,db);
  const [jobs,candidates,events,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_generation_jobs WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_generation_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_candidate_selection_events WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m289_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['生成任务','生成候选','候选选择、恢复与锁定','图像 / 关键帧 / 分镜生产'],
      gateName:'图像 / 关键帧门禁',
      candidateLabels:{CANDIDATE:'候选',SELECTED:'已选择',LOCKED:'已锁定',REJECTED:'已拒绝',HISTORICAL:'历史候选'}
    },
    currentBreakdownPlanId:breakdown?.id||null,
    jobs:jobs.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,shotId:x.shot_id,parentCallSheetId:x.parent_call_sheet_id,
      jobKey:x.job_key,generationKind:x.generation_kind,provider:x.provider,modelTool:x.model_tool,
      modelToolVersion:x.model_tool_version,toolKey:x.tool_key||null,skillKey:x.skill_key||null,mcpKey:x.mcp_key||null,
      promptVersion:x.prompt_version,referenceBindings:parseJson(x.reference_bindings_json),preflight:parseJson(x.preflight_json),
      parameters:parseJson(x.parameters_json),inputFingerprintSha256:x.input_fingerprint_sha256,
      requestedOutputCount:Number(x.requested_output_count),startedAt:x.started_at,finishedAt:x.finished_at,
      latencyMs:x.latency_ms==null?null:Number(x.latency_ms),usage:parseJson(x.usage_json),cost:parseJson(x.cost_json),
      status:x.status,errorCode:x.error_code||null,errorMessage:x.error_message||null,
      retry:parseJson(x.retry_json),safety:parseJson(x.safety_json),provenance:parseJson(x.provenance_json)
    })),
    candidates:candidates.map(x=>({
      id:x.id,generationJobId:x.generation_job_id,shotId:x.shot_id,candidateKey:x.candidate_key,
      outputIndex:Number(x.output_index),candidateVersionNo:Number(x.candidate_version_no),
      contentLocator:parseJson(x.content_locator_json),outputFingerprintSha256:x.output_fingerprint_sha256,
      qa:parseJson(x.qa_json),compareGroup:x.compare_group||null,selectionStatus:x.selection_status,
      isCurrent:Boolean(x.is_current),lockedAt:x.locked_at||null,rejectedReason:x.rejected_reason||null,humanComment:x.human_comment||null,
      safety:parseJson(x.safety_json)
    })),
    selectionEvents:events.map(x=>({
      id:x.id,shotId:x.shot_id,fromCandidateId:x.from_candidate_id||null,toCandidateId:x.to_candidate_id,
      eventType:x.event_type,reason:x.reason,evidence:parseJson(x.evidence_json),createdAt:x.created_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
