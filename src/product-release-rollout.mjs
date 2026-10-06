import { randomUUID, createHash } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateReleaseReadyGate } from './product-release-readiness.mjs';

const GATE='G-PD-RELEASE';
const STRATEGIES=new Set(['DIRECT','STAGED','FEATURE_FLAG','CANARY','PERCENTAGE','INTERNAL','BETA','TENANT_SCOPED','REGION_SCOPED']);
const NON_DIRECT=new Set(['STAGED','FEATURE_FLAG','CANARY','PERCENTAGE','INTERNAL','BETA','TENANT_SCOPED','REGION_SCOPED']);
const SHA40=/^[0-9a-f]{40}$/i;
const SHA64=/^[0-9a-f]{64}$/i;

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
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.keys(value).sort().reduce((o,k)=>{o[k]=stable(value[k]);return o;},{});
  }
  return value;
};
const sha256=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_type FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Release rollout requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const loadCandidate=async(id,db)=>{
  const [rows]=await db.execute('SELECT * FROM product_release_candidates WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Release Candidate not found','RELEASE_CANDIDATE_NOT_FOUND',404);
  return rows[0];
};
const validateVerification=(verification,codePrefix='RELEASE')=>{
  requireFields(verification,['health','readiness','smoke','criticalFlow','evidence'],codePrefix+'_VERIFICATION_REQUIRED');
  const health=upper(verification.health?.status);
  if(!['PASS','HEALTHY'].includes(health))throw errorOf('Health verification must PASS',codePrefix+'_HEALTH_NOT_PASS',409);
  for(const key of ['readiness','smoke','criticalFlow']){
    if(upper(verification[key]?.status)!=='PASS')throw errorOf(
      key+' verification must PASS',
      codePrefix+'_'+key.replace(/([A-Z])/g,'_$1').toUpperCase()+'_NOT_PASS',409
    );
  }
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,actorId,evidence})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};
const insertEvent=async(db,{projectId,rolloutId,eventKey,fromState,toState,waveId,evidence,actorId,occurredAt})=>{
  await db.execute(
    `INSERT INTO product_release_state_events
      (id,project_id,rollout_id,event_key,from_state,to_state,wave_id,evidence_json,actor_identity_id,occurred_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,rolloutId,eventKey,fromState||null,toState,waveId||null,
     asJson(evidence),actorId||null,occurredAt?new Date(occurredAt):new Date()]
  );
};
const validateManifestIntegrity=async(db,candidate)=>{
  const [rows]=await db.execute(
    'SELECT * FROM product_release_evidence_manifests WHERE release_candidate_id=?',[candidate.id]
  );
  if(!rows.length)throw errorOf('Release Evidence Manifest is required','RELEASE_EVIDENCE_MANIFEST_REQUIRED',409);
  const manifest=rows[0],parsed=parseJson(manifest.manifest_json);
  const digest=sha256(parsed);
  if(digest!==manifest.manifest_sha256||digest!==candidate.manifest_sha256)throw errorOf(
    'Release Evidence Manifest integrity failed','RELEASE_MANIFEST_INTEGRITY_FAILED',409
  );
  return manifest;
};
const validateWaveDefinitions=(strategy,waves)=>{
  if(strategy==='DIRECT'){
    if(Array.isArray(waves)&&waves.length)throw errorOf(
      'DIRECT rollout must not define staged waves','DIRECT_ROLLOUT_WAVES_NOT_ALLOWED',409
    );
    return [];
  }
  if(!Array.isArray(waves)||!waves.length)throw errorOf(
    'Non-direct rollout requires at least one wave','RELEASE_WAVES_REQUIRED',409
  );
  const keys=new Set(),seq=new Set();
  let finalCount=0;
  const normalized=[...waves].map(w=>{
    requireFields(w,['waveKey','sequenceNo','scope'],'INVALID_RELEASE_WAVE');
    const sequenceNo=Number(w.sequenceNo);
    if(!Number.isInteger(sequenceNo)||sequenceNo<1)throw errorOf('wave sequenceNo must be positive integer','INVALID_RELEASE_WAVE_SEQUENCE',409);
    if(keys.has(w.waveKey)||seq.has(sequenceNo))throw errorOf('Duplicate rollout wave key or sequence','DUPLICATE_RELEASE_WAVE',409);
    keys.add(w.waveKey);seq.add(sequenceNo);
    if(w.isFinalWave===true)finalCount++;
    const pct=w.targetPercentage==null?null:Number(w.targetPercentage);
    if(['CANARY','PERCENTAGE'].includes(strategy)){
      if(!Number.isFinite(pct)||pct<=0||pct>100)throw errorOf(
        'CANARY/PERCENTAGE wave requires targetPercentage in (0,100]','INVALID_RELEASE_WAVE_PERCENTAGE',409,{waveKey:w.waveKey}
      );
    }
    return {...w,sequenceNo,targetPercentage:pct};
  }).sort((a,b)=>a.sequenceNo-b.sequenceNo);
  normalized.forEach((w,i)=>{
    if(w.sequenceNo!==i+1)throw errorOf('Release wave sequence must be contiguous from 1','RELEASE_WAVE_SEQUENCE_GAP',409);
  });
  if(finalCount!==1||normalized.at(-1)?.isFinalWave!==true)throw errorOf(
    'Exactly the last rollout wave must be marked final','RELEASE_FINAL_WAVE_REQUIRED',409
  );
  if(['CANARY','PERCENTAGE'].includes(strategy)&&Number(normalized.at(-1).targetPercentage)!==100)throw errorOf(
    'Final CANARY/PERCENTAGE wave must target 100% of planned scope','RELEASE_FINAL_WAVE_PERCENT_100_REQUIRED',409
  );
  return normalized;
};

export const resolveReleaseRolloutScope=async rolloutId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,p.workspace_id FROM product_release_rollouts r
      JOIN projects p ON p.id=r.project_id WHERE r.id=?`,[rolloutId]
  );
  if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
  return {releaseRolloutId:rolloutId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createReleaseRollout=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'releaseCandidateId','rolloutKey','strategy','targetEnvironment','deploymentId',
    'exactCommitSha','artifactSha256','targetScope','deploymentEvidence'
  ],'INVALID_RELEASE_ROLLOUT');
  const strategy=upper(input.strategy);
  if(!STRATEGIES.has(strategy))throw errorOf('Unsupported rollout strategy','INVALID_ROLLOUT_STRATEGY',409,{strategy});
  if(!SHA40.test(input.exactCommitSha)||!SHA64.test(input.artifactSha256))throw errorOf(
    'Exact commit SHA and artifact SHA-256 are required','INVALID_RELEASE_ARTIFACT_IDENTITY',409
  );
  const db=getRuntimePool(),candidate=await loadCandidate(input.releaseCandidateId,db);
  if(candidate.project_id!==projectId||candidate.status!=='FROZEN')throw errorOf(
    'Rollout requires FROZEN Release Candidate from same project','FROZEN_RELEASE_CANDIDATE_REQUIRED',409
  );
  await validateManifestIntegrity(db,candidate);
  const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[candidate.release_version_id]);
  const version=versions[0];
  if(!version||version.status!=='LOCKED'||version.version_type!=='RELEASE_DISTRIBUTION')throw errorOf(
    'Release Version must be LOCKED before rollout starts','RELEASE_VERSION_LOCKED_REQUIRED',409
  );
  const readiness=await evaluateReleaseReadyGate(projectId,{persist:false},actorId);
  if(readiness.status!=='PASS')throw errorOf(
    'G-PD-RELEASE-READY must PASS before rollout starts','RELEASE_READY_GATE_REQUIRED',409,{reasonCodes:readiness.reasonCodes}
  );
  if(input.exactCommitSha.toLowerCase()!==candidate.exact_commit_sha.toLowerCase()||
     input.artifactSha256.toLowerCase()!==candidate.artifact_sha256.toLowerCase())throw errorOf(
    'Deployment must use exact frozen Release Candidate artifact','RELEASE_ARTIFACT_IDENTITY_MISMATCH',409
  );
  const frozenPlan=parseJson(candidate.rollout_plan_json)||{};
  if(upper(frozenPlan.strategy)!==strategy)throw errorOf(
    'Runtime rollout strategy must match frozen Release Candidate strategy','ROLLOUT_STRATEGY_FROZEN_MISMATCH',409,
    {expected:upper(frozenPlan.strategy),actual:strategy}
  );
  const frozenEnv=parseJson(candidate.environment_json)||{};
  if(frozenEnv.targetEnvironment!==input.targetEnvironment)throw errorOf(
    'Target environment must match frozen Release Candidate','RELEASE_TARGET_ENVIRONMENT_MISMATCH',409
  );
  const waves=validateWaveDefinitions(strategy,input.waves||[]);

  const conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    const [active]=await conn.execute(
      "SELECT id FROM product_release_rollouts WHERE project_id=? AND lifecycle_status='ACTIVE'",[projectId]
    );
    if(active.length)throw errorOf('Only one active release rollout is allowed per project','ACTIVE_RELEASE_ROLLOUT_EXISTS',409);
    await conn.execute(
      `INSERT INTO product_release_rollouts
        (id,project_id,release_candidate_id,release_version_id,rollout_key,strategy,release_state,lifecycle_status,
         target_environment,deployment_id,exact_commit_sha,artifact_sha256,target_scope_json,deployment_evidence_json,
         started_by_identity_id,deployed_at)
       VALUES (?,?,?,?,?,?,'DEPLOYED','ACTIVE',?,?,?,?,?,?,?,?)`,
      [id,projectId,candidate.id,candidate.release_version_id,input.rolloutKey,strategy,input.targetEnvironment,
       input.deploymentId,input.exactCommitSha.toLowerCase(),input.artifactSha256.toLowerCase(),
       asJson(input.targetScope),asJson(input.deploymentEvidence),actorId,
       input.deployedAt?new Date(input.deployedAt):new Date()]
    );
    const waveIds={};
    for(const wave of waves){
      const waveId=randomUUID();waveIds[wave.waveKey]=waveId;
      await conn.execute(
        `INSERT INTO product_release_waves
          (id,project_id,rollout_id,wave_key,sequence_no,scope_json,target_percentage,is_final_wave,status)
         VALUES (?,?,?,?,?,?,?,?, 'PLANNED')`,
        [waveId,projectId,id,wave.waveKey,wave.sequenceNo,asJson(wave.scope),
         wave.targetPercentage==null?null:wave.targetPercentage,wave.isFinalWave===true]
      );
    }
    await insertEvent(conn,{projectId,rolloutId:id,eventKey:'DEPLOYED',fromState:null,toState:'DEPLOYED',
      evidence:{deploymentId:input.deploymentId,targetEnvironment:input.targetEnvironment,
        exactCommitSha:input.exactCommitSha.toLowerCase(),artifactSha256:input.artifactSha256.toLowerCase(),
        deploymentEvidence:input.deploymentEvidence},actorId,occurredAt:input.deployedAt});
    await insertTrace(conn,{projectId,sourceType:'RELEASE_CANDIDATE',sourceId:candidate.id,
      targetType:'RELEASE_ROLLOUT',targetId:id,linkType:'DEPLOYED_AS',actorId,
      evidence:{strategy,targetEnvironment:input.targetEnvironment}});
    await conn.commit();
    return {id,projectId,releaseCandidateId:candidate.id,releaseVersionId:candidate.release_version_id,
      rolloutKey:input.rolloutKey,strategy,releaseState:'DEPLOYED',lifecycleStatus:'ACTIVE',
      targetEnvironment:input.targetEnvironment,deploymentId:input.deploymentId,waveIds};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const verifyReleaseRollout=async(rolloutId,input={},actorId=null)=>{
  validateVerification(input,'RELEASE');
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_release_rollouts WHERE id=? FOR UPDATE',[rolloutId]);
    if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
    const row=rows[0];
    if(row.lifecycle_status!=='ACTIVE'||row.release_state!=='DEPLOYED')throw errorOf(
      'Only active DEPLOYED rollout can be verified','RELEASE_VERIFY_STATE_INVALID',409,{state:row.release_state}
    );
    if(input.exactCommitSha&&input.exactCommitSha.toLowerCase()!==row.exact_commit_sha)throw errorOf(
      'Verification commit does not match deployed commit','RELEASE_VERIFY_COMMIT_MISMATCH',409
    );
    if(input.artifactSha256&&input.artifactSha256.toLowerCase()!==row.artifact_sha256)throw errorOf(
      'Verification artifact does not match deployed artifact','RELEASE_VERIFY_ARTIFACT_MISMATCH',409
    );
    await conn.execute(
      `UPDATE product_release_rollouts
          SET release_state='VERIFIED',verification_json=?,verified_at=?
        WHERE id=?`,
      [asJson(input),input.verifiedAt?new Date(input.verifiedAt):new Date(),rolloutId]
    );
    await insertEvent(conn,{projectId:row.project_id,rolloutId,eventKey:'VERIFIED',
      fromState:'DEPLOYED',toState:'VERIFIED',evidence:input,actorId,occurredAt:input.verifiedAt});
    await conn.commit();
    return {id:rolloutId,projectId:row.project_id,releaseState:'VERIFIED',lifecycleStatus:'ACTIVE'};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const verifyWaveInput=input=>{
  requireFields(input,['waveKey','verification'],'INVALID_RELEASE_WAVE_VERIFICATION');
  validateVerification(input.verification,'RELEASE_WAVE');
  if(input.verification.scopeVerified!==true)throw errorOf(
    'Wave verification must confirm target scope','RELEASE_WAVE_SCOPE_NOT_VERIFIED',409
  );
};
const nextPlannedWave=async(db,rolloutId)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_release_waves WHERE rollout_id=? AND status='PLANNED' ORDER BY sequence_no LIMIT 1",[rolloutId]
  );
  return rows[0]||null;
};
const releaseWave=async(db,row,input,actorId,eventPrefix)=>{
  verifyWaveInput(input);
  const next=await nextPlannedWave(db,row.id);
  if(!next)throw errorOf('No planned rollout wave remains','RELEASE_WAVE_NONE_PLANNED',409);
  if(next.wave_key!==input.waveKey)throw errorOf(
    'Rollout waves must execute in sequence','RELEASE_WAVE_OUT_OF_SEQUENCE',409,
    {expectedWaveKey:next.wave_key,actualWaveKey:input.waveKey}
  );
  await db.execute(
    `UPDATE product_release_waves
        SET status='VERIFIED',verification_json=?,released_at=?,verified_at=?
      WHERE id=?`,
    [asJson(input.verification),input.releasedAt?new Date(input.releasedAt):new Date(),
     input.verifiedAt?new Date(input.verifiedAt):new Date(),next.id]
  );
  await insertEvent(db,{projectId:row.project_id,rolloutId:row.id,
    eventKey:eventPrefix+':'+next.wave_key,fromState:row.release_state,toState:row.release_state,
    waveId:next.id,evidence:input,actorId,occurredAt:input.verifiedAt||input.releasedAt});
  return next;
};

export const releaseReleaseRollout=async(rolloutId,input={},actorId=null)=>{
  requireFields(input,['approval','releaseEvidence'],'INVALID_RELEASE_ACTION');
  if(upper(input.approval.status)!=='APPROVED'||!input.approval.approverIdentityId)throw errorOf(
    'Release requires explicit APPROVED evidence and approver','RELEASE_APPROVAL_REQUIRED',409
  );
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_release_rollouts WHERE id=? FOR UPDATE',[rolloutId]);
    if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
    const row=rows[0];
    if(row.lifecycle_status!=='ACTIVE'||row.release_state!=='VERIFIED')throw errorOf(
      'Only active VERIFIED rollout can be released','RELEASE_STATE_INVALID',409,{state:row.release_state}
    );
    const candidate=await loadCandidate(row.release_candidate_id,conn);
    if(input.approval.approverIdentityId!==candidate.approver_identity_id)throw errorOf(
      'Release approval must come from frozen Release Candidate approver','RELEASE_APPROVER_MISMATCH',409
    );

    let wave=null;
    if(NON_DIRECT.has(row.strategy)){
      wave=await releaseWave(conn,row,input,actorId,'WAVE_RELEASED');
    }else if(input.waveKey||input.verification){
      throw errorOf('DIRECT release must not use rollout wave','DIRECT_RELEASE_WAVE_NOT_ALLOWED',409);
    }

    await conn.execute(
      `UPDATE product_release_rollouts
          SET release_state='RELEASED',release_evidence_json=?,released_by_identity_id=?,released_at=?
        WHERE id=?`,
      [asJson({approval:input.approval,releaseEvidence:input.releaseEvidence,
        initialWaveKey:wave?.wave_key||null}),
       input.approval.approverIdentityId,input.releasedAt?new Date(input.releasedAt):new Date(),rolloutId]
    );
    await conn.execute(
      `UPDATE project_versions SET status='RELEASED',effective_at=COALESCE(effective_at,CURRENT_TIMESTAMP(6))
        WHERE id=? AND status='LOCKED'`,[row.release_version_id]
    );
    await insertEvent(conn,{projectId:row.project_id,rolloutId,eventKey:'RELEASED',
      fromState:'VERIFIED',toState:'RELEASED',waveId:wave?.id||null,
      evidence:{approval:input.approval,releaseEvidence:input.releaseEvidence,initialWaveKey:wave?.wave_key||null},
      actorId,occurredAt:input.releasedAt});
    await insertTrace(conn,{projectId:row.project_id,sourceType:'RELEASE_ROLLOUT',sourceId:rolloutId,
      targetType:'PROJECT_VERSION',targetId:row.release_version_id,linkType:'RELEASES',actorId,
      evidence:{releaseState:'RELEASED'}});
    await conn.commit();
    return {id:rolloutId,projectId:row.project_id,releaseVersionId:row.release_version_id,
      releaseState:'RELEASED',lifecycleStatus:'ACTIVE',initialWaveKey:wave?.wave_key||null};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const advanceReleaseWave=async(rolloutId,input={},actorId=null)=>{
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_release_rollouts WHERE id=? FOR UPDATE',[rolloutId]);
    if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
    const row=rows[0];
    if(row.lifecycle_status!=='ACTIVE'||row.release_state!=='RELEASED'||!NON_DIRECT.has(row.strategy))throw errorOf(
      'Wave advancement requires active non-direct RELEASED rollout','RELEASE_WAVE_ADVANCE_STATE_INVALID',409
    );
    const wave=await releaseWave(conn,row,input,actorId,'WAVE_VERIFIED');
    await conn.commit();
    return {id:rolloutId,projectId:row.project_id,releaseState:'RELEASED',
      waveId:wave.id,waveKey:wave.wave_key,waveStatus:'VERIFIED',isFinalWave:Boolean(wave.is_final_wave)};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const completeReleaseRollout=async(rolloutId,input={},actorId=null)=>{
  requireFields(input,['finalVerification','evidence'],'INVALID_FULL_ROLLOUT');
  validateVerification(input.finalVerification,'FULL_ROLLOUT');
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_release_rollouts WHERE id=? FOR UPDATE',[rolloutId]);
    if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
    const row=rows[0];
    if(row.lifecycle_status!=='ACTIVE'||row.release_state!=='RELEASED')throw errorOf(
      'Only active RELEASED rollout can become FULLY_ROLLED_OUT','FULL_ROLLOUT_STATE_INVALID',409,{state:row.release_state}
    );
    if(NON_DIRECT.has(row.strategy)){
      const [waves]=await conn.execute('SELECT * FROM product_release_waves WHERE rollout_id=? ORDER BY sequence_no',[rolloutId]);
      if(!waves.length||waves.some(w=>w.status!=='VERIFIED')||!waves.some(w=>Boolean(w.is_final_wave))){
        throw errorOf('All planned rollout waves, including final wave, must be VERIFIED','FULL_ROLLOUT_WAVES_INCOMPLETE',409,
          {waves:waves.map(w=>({waveKey:w.wave_key,status:w.status,isFinalWave:Boolean(w.is_final_wave)}))}
        );
      }
    }
    await conn.execute(
      `UPDATE product_release_rollouts
          SET release_state='FULLY_ROLLED_OUT',lifecycle_status='COMPLETED',
              full_rollout_evidence_json=?,fully_rolled_out_at=?
        WHERE id=?`,
      [asJson({finalVerification:input.finalVerification,evidence:input.evidence}),
       input.completedAt?new Date(input.completedAt):new Date(),rolloutId]
    );
    await insertEvent(conn,{projectId:row.project_id,rolloutId,eventKey:'FULLY_ROLLED_OUT',
      fromState:'RELEASED',toState:'FULLY_ROLLED_OUT',
      evidence:{finalVerification:input.finalVerification,evidence:input.evidence},
      actorId,occurredAt:input.completedAt});
    await conn.commit();
    return {id:rolloutId,projectId:row.project_id,releaseVersionId:row.release_version_id,
      releaseState:'FULLY_ROLLED_OUT',lifecycleStatus:'COMPLETED'};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateReleaseGate=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const [candidates]=await db.execute(
    "SELECT * FROM product_release_candidates WHERE project_id=? AND status='FROZEN' ORDER BY frozen_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const candidate=candidates[0]||null;
  evidence.releaseCandidateId=candidate?.id||null;
  if(!candidate)reasons.push('FROZEN_RELEASE_CANDIDATE_REQUIRED');
  else{
    try{await validateManifestIntegrity(db,candidate);}catch{reasons.push('RELEASE_MANIFEST_INTEGRITY_FAILED');}
  }

  const [rollouts]=await db.execute(
    'SELECT * FROM product_release_rollouts WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1',[projectId]
  );
  const rollout=rollouts[0]||null;
  evidence.releaseRolloutId=rollout?.id||null;
  evidence.releaseVersionId=rollout?.release_version_id||null;
  evidence.releaseState=rollout?.release_state||null;
  evidence.strategy=rollout?.strategy||null;
  evidence.targetEnvironment=rollout?.target_environment||null;
  evidence.deploymentId=rollout?.deployment_id||null;
  evidence.exactCommitSha=rollout?.exact_commit_sha||null;
  evidence.artifactSha256=rollout?.artifact_sha256||null;
  if(!rollout)reasons.push('RELEASE_ROLLOUT_REQUIRED');
  else{
    if(candidate&&rollout.release_candidate_id!==candidate.id)reasons.push('RELEASE_ROLLOUT_CANDIDATE_STALE');
    if(!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))reasons.push('RELEASE_NOT_RELEASED');
    if(!['ACTIVE','COMPLETED'].includes(rollout.lifecycle_status))reasons.push('RELEASE_ROLLOUT_NOT_ACTIVE_OR_COMPLETED');
    const [events,waves,versions]=await Promise.all([
      db.execute('SELECT * FROM product_release_state_events WHERE rollout_id=? ORDER BY occurred_at,id',[rollout.id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_release_waves WHERE rollout_id=? ORDER BY sequence_no',[rollout.id]).then(x=>x[0]),
      db.execute('SELECT * FROM project_versions WHERE id=?',[rollout.release_version_id]).then(x=>x[0])
    ]);
    evidence.stateEvents=events.map(x=>({fromState:x.from_state,toState:x.to_state,eventKey:x.event_key}));
    evidence.waves=waves.map(x=>({waveKey:x.wave_key,sequenceNo:x.sequence_no,status:x.status,
      isFinalWave:Boolean(x.is_final_wave),targetPercentage:x.target_percentage==null?null:Number(x.target_percentage)}));
    for(const state of ['DEPLOYED','VERIFIED','RELEASED']){
      if(!events.some(e=>e.to_state===state&&e.event_key===state))reasons.push('RELEASE_STATE_EVENT_REQUIRED:'+state);
    }
    if(rollout.release_state==='FULLY_ROLLED_OUT'&&!events.some(e=>e.to_state==='FULLY_ROLLED_OUT'&&e.event_key==='FULLY_ROLLED_OUT'))
      reasons.push('RELEASE_STATE_EVENT_REQUIRED:FULLY_ROLLED_OUT');
    if(!versions.length||versions[0].status!=='RELEASED')reasons.push('RELEASE_VERSION_NOT_RELEASED');
    if(NON_DIRECT.has(rollout.strategy)){
      if(!waves.length||!waves.some(w=>w.status==='VERIFIED'))reasons.push('RELEASE_INITIAL_WAVE_NOT_VERIFIED');
      if(rollout.release_state==='FULLY_ROLLED_OUT'&&waves.some(w=>w.status!=='VERIFIED'))reasons.push('FULL_ROLLOUT_WAVES_INCOMPLETE');
    }
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m277_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getReleaseRolloutState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [rollouts,waves,events,gates]=await Promise.all([
    db.execute('SELECT * FROM product_release_rollouts WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_release_waves WHERE project_id=? ORDER BY rollout_id,sequence_no',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_release_state_events WHERE project_id=? ORDER BY occurred_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m277_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    rollouts:rollouts.map(x=>({
      id:x.id,releaseCandidateId:x.release_candidate_id,releaseVersionId:x.release_version_id,
      rolloutKey:x.rollout_key,strategy:x.strategy,releaseState:x.release_state,lifecycleStatus:x.lifecycle_status,
      targetEnvironment:x.target_environment,deploymentId:x.deployment_id,exactCommitSha:x.exact_commit_sha,
      artifactSha256:x.artifact_sha256,targetScope:parseJson(x.target_scope_json),
      deployedAt:x.deployed_at,verifiedAt:x.verified_at||null,releasedAt:x.released_at||null,
      fullyRolledOutAt:x.fully_rolled_out_at||null
    })),
    waves:waves.map(x=>({
      id:x.id,rolloutId:x.rollout_id,waveKey:x.wave_key,sequenceNo:x.sequence_no,
      scope:parseJson(x.scope_json),targetPercentage:x.target_percentage==null?null:Number(x.target_percentage),
      isFinalWave:Boolean(x.is_final_wave),status:x.status,verification:parseJson(x.verification_json),
      releasedAt:x.released_at||null,verifiedAt:x.verified_at||null
    })),
    stateEvents:events.map(x=>({
      id:x.id,rolloutId:x.rollout_id,eventKey:x.event_key,fromState:x.from_state||null,toState:x.to_state,
      waveId:x.wave_id||null,evidence:parseJson(x.evidence_json),occurredAt:x.occurred_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
