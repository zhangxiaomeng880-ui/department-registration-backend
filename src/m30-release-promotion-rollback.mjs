import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { createApprovalRequest } from './competitive-collaboration.mjs';

const SHA40=/^[0-9a-f]{40}$/i;
const SHA64=/^[0-9a-f]{64}$/i;
const GATE='G-M30-RELEASE-ROLLBACK';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const nonEmpty=v=>{
  if(v==null)return false;if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const secretKeyPattern=/(api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;
const secretValuePattern=/^(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/i;
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(node==null)return;
    if(typeof node==='string'){
      if(secretValuePattern.test(node.trim()))throw errorOf(
        'Release evidence must not persist raw credentials or secrets','M30_RELEASE_RAW_SECRET_NOT_ALLOWED',400,{field:path}
      );
      return;
    }
    if(typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      const next=path?path+'.'+key:key;
      if(secretKeyPattern.test(key))throw errorOf(
        'Release evidence must not persist raw credentials or secrets','M30_RELEASE_RAW_SECRET_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};

const loadEnvironment=async(id,db=getRuntimePool())=>{
  const row=await one(db,`SELECT e.*,w.tenant_id workspace_tenant_id
    FROM platform_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE e.id=?`,[id]);
  if(!row)throw errorOf('Platform environment not found','M30_ENVIRONMENT_NOT_FOUND',404);
  return row;
};
const loadCandidate=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_release_candidates WHERE id=?',[id]);
  if(!row)throw errorOf('Platform release candidate not found','M30_RELEASE_CANDIDATE_NOT_FOUND',404);
  return row;
};
const loadPromotion=async(id,db=getRuntimePool())=>{
  const row=await one(db,`SELECT p.*,e.environment_type target_environment_type
    FROM platform_release_promotions p
    JOIN platform_environments e ON e.id=p.target_environment_id WHERE p.id=?`,[id]);
  if(!row)throw errorOf('Platform promotion not found','M30_PROMOTION_NOT_FOUND',404);
  return row;
};
const loadRollback=async(id,db=getRuntimePool())=>{
  const row=await one(db,`SELECT r.*,p.target_environment_id,e.environment_type target_environment_type
    FROM platform_rollback_requests r
    JOIN platform_release_promotions p ON p.id=r.promotion_id
    JOIN platform_environments e ON e.id=p.target_environment_id WHERE r.id=?`,[id]);
  if(!row)throw errorOf('Platform rollback request not found','M30_ROLLBACK_NOT_FOUND',404);
  return row;
};

export const resolveM30ReleaseCandidateScope=async id=>{
  const x=await loadCandidate(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};
export const resolveM30PromotionScope=async id=>{
  const x=await loadPromotion(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};
export const resolveM30RollbackScope=async id=>{
  const x=await loadRollback(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};

export const createPlatformReleaseCandidate=async(workspaceId,input={},actorId=null)=>{
  requireFields(input,['candidateKey','sourceEnvironmentId','versionLabel','exactRuntimeSha',
    'artifactSha256','migrationFingerprint','sourceEvidence'],'INVALID_M30_RELEASE_CANDIDATE');
  if(!SHA40.test(String(input.exactRuntimeSha)))throw errorOf(
    'exactRuntimeSha must be a 40-character commit SHA','M30_RELEASE_RUNTIME_SHA_REQUIRED',409
  );
  if(!SHA64.test(String(input.artifactSha256)))throw errorOf(
    'artifactSha256 must be a 64-character SHA-256','M30_RELEASE_ARTIFACT_SHA_REQUIRED',409
  );
  rejectSecrets(input);
  const db=getRuntimePool(),env=await loadEnvironment(input.sourceEnvironmentId,db);
  if(env.workspace_id!==workspaceId)throw errorOf(
    'Source environment must belong to workspace','M30_RELEASE_ENVIRONMENT_SCOPE_MISMATCH',409
  );
  if(env.status!=='ACTIVE'||env.health_status!=='HEALTHY')throw errorOf(
    'Source environment must be ACTIVE and HEALTHY','M30_RELEASE_SOURCE_ENVIRONMENT_NOT_READY',409
  );
  const id=randomUUID(),frozenAt=input.frozenAt?asDate(input.frozenAt):new Date();
  await db.execute(`INSERT INTO platform_release_candidates
    (id,tenant_id,workspace_id,candidate_key,source_environment_id,release_type,version_label,
     exact_runtime_sha,artifact_sha256,migration_fingerprint,source_evidence_json,status,frozen_at,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
    [id,env.tenant_id,workspaceId,input.candidateKey,input.sourceEnvironmentId,upper(input.releaseType||'RUNTIME'),
     input.versionLabel,String(input.exactRuntimeSha).toLowerCase(),String(input.artifactSha256).toLowerCase(),
     input.migrationFingerprint,asJson(input.sourceEvidence),frozenAt,actorId]);
  return {id,workspaceId,candidateKey:input.candidateKey,status:'FROZEN',
    versionLabel:input.versionLabel,exactRuntimeSha:String(input.exactRuntimeSha).toLowerCase(),
    artifactSha256:String(input.artifactSha256).toLowerCase(),sourceEnvironmentId:input.sourceEnvironmentId,frozenAt};
};

export const requestPlatformPromotion=async(candidateId,input={},actorId=null)=>{
  requireFields(input,['promotionKey','targetEnvironmentId','rollbackRuntimeSha','evidence'],'INVALID_M30_PROMOTION');
  if(!SHA40.test(String(input.rollbackRuntimeSha)))throw errorOf(
    'rollbackRuntimeSha must be a 40-character commit SHA','M30_ROLLBACK_RUNTIME_SHA_REQUIRED',409
  );
  rejectSecrets(input);
  const db=getRuntimePool(),candidate=await loadCandidate(candidateId,db);
  if(candidate.status!=='FROZEN')throw errorOf('Release candidate must be FROZEN','M30_RELEASE_CANDIDATE_NOT_FROZEN',409);
  const source=await loadEnvironment(candidate.source_environment_id,db);
  const target=await loadEnvironment(input.targetEnvironmentId,db);
  if(target.workspace_id!==candidate.workspace_id||source.workspace_id!==candidate.workspace_id)
    throw errorOf('Promotion environments must belong to candidate workspace','M30_RELEASE_ENVIRONMENT_SCOPE_MISMATCH',409);
  if(target.id===source.id)throw errorOf('Source and target environment must differ','M30_RELEASE_TARGET_EQUALS_SOURCE',409);
  if(target.status!=='ACTIVE'||target.health_status==='DOWN')
    throw errorOf('Target environment is not available for promotion','M30_RELEASE_TARGET_ENVIRONMENT_NOT_READY',409);
  const production=target.environment_type==='PRODUCTION';
  const id=randomUUID(),requestedAt=input.requestedAt?asDate(input.requestedAt):new Date();
  await db.execute(`INSERT INTO platform_release_promotions
    (id,tenant_id,workspace_id,candidate_id,source_environment_id,target_environment_id,promotion_key,
     risk_level,approval_request_id,rollback_runtime_sha,status,requested_by_identity_id,requested_at)
    VALUES (?,?,?,?,?,?,?, ?,NULL,?,?,?,?)`,
    [id,candidate.tenant_id,candidate.workspace_id,candidate.id,source.id,target.id,input.promotionKey,
     production?'HIGH':upper(input.riskLevel||'MEDIUM'),String(input.rollbackRuntimeSha).toLowerCase(),
     production?'PENDING_APPROVAL':'READY',actorId,requestedAt]);
  let approvalRequestId=null;
  if(production){
    const approval=await createApprovalRequest({
      workspaceId:candidate.workspace_id,requestKey:'M302-PROMOTION-'+id,targetType:'PLATFORM_RELEASE_PROMOTION',
      targetId:id,requestedAction:'PRODUCTION_RELEASE_PROMOTION',requiredRole:'WORKSPACE_ADMIN',riskLevel:'HIGH',
      context:{candidateId:candidate.id,sourceEnvironmentId:source.id,targetEnvironmentId:target.id,
        exactRuntimeSha:candidate.exact_runtime_sha,rollbackRuntimeSha:String(input.rollbackRuntimeSha).toLowerCase()},
      evidence:input.evidence,effectiveObjectType:'PLATFORM_RELEASE_CANDIDATE',
      effectiveObjectId:candidate.id,effectiveVersion:candidate.version_label,requestedByIdentityId:actorId
    });
    approvalRequestId=approval.id;
    await db.execute('UPDATE platform_release_promotions SET approval_request_id=? WHERE id=?',[approval.id,id]);
  }
  return {id,candidateId:candidate.id,promotionKey:input.promotionKey,
    sourceEnvironmentId:source.id,targetEnvironmentId:target.id,targetEnvironmentType:target.environment_type,
    riskLevel:production?'HIGH':upper(input.riskLevel||'MEDIUM'),
    approvalRequestId,status:production?'PENDING_APPROVAL':'READY',requestedAt};
};

const validateExecutionReceipt=(input,expectedSha,codePrefix)=>{
  requireFields(input,['executionMode','externalDeploymentRef','deployedRuntimeSha','healthStatus','smokeStatus','evidence'],
    'INVALID_'+codePrefix+'_EXECUTION_RECEIPT');
  if(!SHA40.test(String(input.deployedRuntimeSha))||String(input.deployedRuntimeSha).toLowerCase()!==String(expectedSha).toLowerCase())
    throw errorOf('Execution receipt Runtime SHA must equal exact candidate/rollback SHA',codePrefix+'_EXACT_SHA_MISMATCH',409);
  if(!['PASS','HEALTHY'].includes(upper(input.healthStatus)))throw errorOf('Health must PASS',codePrefix+'_HEALTH_NOT_PASS',409);
  if(upper(input.smokeStatus)!=='PASS')throw errorOf('Smoke verification must PASS',codePrefix+'_SMOKE_NOT_PASS',409);
  rejectSecrets(input);
};

export const executePlatformPromotion=async(promotionId,input={},actorId=null)=>{
  const db=getRuntimePool(),promotion=await loadPromotion(promotionId,db);
  const candidate=await loadCandidate(promotion.candidate_id,db);
  if(promotion.status==='PROMOTED')return {id:promotion.id,status:'PROMOTED',idempotent:true};
  if(!['READY','PENDING_APPROVAL'].includes(promotion.status))throw errorOf(
    'Promotion is not executable','M30_PROMOTION_STATE_INVALID',409,{status:promotion.status}
  );
  validateExecutionReceipt(input,candidate.exact_runtime_sha,'M30_PROMOTION');
  const production=promotion.target_environment_type==='PRODUCTION';
  if(production){
    const approval=promotion.approval_request_id
      ? await one(db,'SELECT status FROM approval_requests WHERE id=?',[promotion.approval_request_id]):null;
    if(approval?.status!=='APPROVED')throw errorOf('Production promotion requires approved Human Gate','M30_PRODUCTION_APPROVAL_REQUIRED',409);
    if(upper(input.executionMode)!=='HUMAN'||input.isSynthetic===true)throw errorOf(
      'Production promotion execution must be HUMAN and non-synthetic','M30_PRODUCTION_HUMAN_EXECUTION_REQUIRED',409
    );
  }
  const promotedAt=input.promotedAt?asDate(input.promotedAt):new Date();
  await db.execute(`UPDATE platform_release_promotions
    SET status='PROMOTED',execution_mode=?,execution_receipt_json=?,promoted_by_identity_id=?,promoted_at=?
    WHERE id=?`,
    [upper(input.executionMode),asJson(input),actorId,promotedAt,promotionId]);
  await db.execute(`UPDATE platform_environments
    SET external_ref_json=JSON_SET(external_ref_json,'$.activeRuntimeSha',?,'$.lastPromotionId',?),
        last_health_at=?,health_status='HEALTHY'
    WHERE id=?`,
    [candidate.exact_runtime_sha,promotionId,promotedAt,promotion.target_environment_id]);
  return {id:promotion.id,status:'PROMOTED',targetEnvironmentId:promotion.target_environment_id,
    exactRuntimeSha:candidate.exact_runtime_sha,executionMode:upper(input.executionMode),promotedAt,idempotent:false};
};

export const requestPlatformRollback=async(promotionId,input={},actorId=null)=>{
  requireFields(input,['rollbackKey','evidence'],'INVALID_M30_ROLLBACK_REQUEST');
  rejectSecrets(input);
  const db=getRuntimePool(),promotion=await loadPromotion(promotionId,db);
  if(promotion.status!=='PROMOTED')throw errorOf('Rollback requires a PROMOTED release','M30_ROLLBACK_PROMOTION_NOT_ACTIVE',409);
  const production=promotion.target_environment_type==='PRODUCTION';
  const id=randomUUID(),requestedAt=input.requestedAt?asDate(input.requestedAt):new Date();
  await db.execute(`INSERT INTO platform_rollback_requests
    (id,tenant_id,workspace_id,promotion_id,rollback_key,rollback_runtime_sha,approval_request_id,
     risk_level,status,requested_by_identity_id,requested_at)
    VALUES (?,?,?,?,?,?,NULL,?,?,?,?)`,
    [id,promotion.tenant_id,promotion.workspace_id,promotion.id,input.rollbackKey,promotion.rollback_runtime_sha,
     production?'HIGH':upper(input.riskLevel||'MEDIUM'),production?'PENDING_APPROVAL':'READY',actorId,requestedAt]);
  let approvalRequestId=null;
  if(production){
    const approval=await createApprovalRequest({
      workspaceId:promotion.workspace_id,requestKey:'M302-ROLLBACK-'+id,targetType:'PLATFORM_ROLLBACK',
      targetId:id,requestedAction:'PRODUCTION_RELEASE_ROLLBACK',requiredRole:'WORKSPACE_ADMIN',riskLevel:'HIGH',
      context:{promotionId:promotion.id,targetEnvironmentId:promotion.target_environment_id,
        rollbackRuntimeSha:promotion.rollback_runtime_sha},
      evidence:input.evidence,effectiveObjectType:'PLATFORM_RELEASE_PROMOTION',
      effectiveObjectId:promotion.id,effectiveVersion:promotion.rollback_runtime_sha,requestedByIdentityId:actorId
    });
    approvalRequestId=approval.id;
    await db.execute('UPDATE platform_rollback_requests SET approval_request_id=? WHERE id=?',[approval.id,id]);
  }
  return {id,promotionId:promotion.id,rollbackKey:input.rollbackKey,rollbackRuntimeSha:promotion.rollback_runtime_sha,
    approvalRequestId,riskLevel:production?'HIGH':upper(input.riskLevel||'MEDIUM'),
    status:production?'PENDING_APPROVAL':'READY',requestedAt};
};

export const executePlatformRollback=async(rollbackId,input={},actorId=null)=>{
  const db=getRuntimePool(),rollback=await loadRollback(rollbackId,db);
  if(rollback.status==='COMPLETED')return {id:rollback.id,status:'COMPLETED',idempotent:true};
  if(!['READY','PENDING_APPROVAL'].includes(rollback.status))throw errorOf(
    'Rollback is not executable','M30_ROLLBACK_STATE_INVALID',409,{status:rollback.status}
  );
  validateExecutionReceipt(input,rollback.rollback_runtime_sha,'M30_ROLLBACK');
  const production=rollback.target_environment_type==='PRODUCTION';
  if(production){
    const approval=rollback.approval_request_id
      ? await one(db,'SELECT status FROM approval_requests WHERE id=?',[rollback.approval_request_id]):null;
    if(approval?.status!=='APPROVED')throw errorOf('Production rollback requires approved Human Gate','M30_PRODUCTION_ROLLBACK_APPROVAL_REQUIRED',409);
    if(upper(input.executionMode)!=='HUMAN'||input.isSynthetic===true)throw errorOf(
      'Production rollback execution must be HUMAN and non-synthetic','M30_PRODUCTION_ROLLBACK_HUMAN_EXECUTION_REQUIRED',409
    );
  }
  const completedAt=input.completedAt?asDate(input.completedAt):new Date();
  await db.execute(`UPDATE platform_rollback_requests
    SET status='COMPLETED',execution_mode=?,execution_receipt_json=?,completed_by_identity_id=?,completed_at=?
    WHERE id=?`,
    [upper(input.executionMode),asJson(input),actorId,completedAt,rollbackId]);
  await db.execute(`UPDATE platform_release_promotions SET status='ROLLED_BACK' WHERE id=?`,[rollback.promotion_id]);
  await db.execute(`UPDATE platform_environments
    SET external_ref_json=JSON_SET(external_ref_json,'$.activeRuntimeSha',?,'$.lastRollbackId',?),
        last_health_at=?,health_status='HEALTHY'
    WHERE id=?`,
    [rollback.rollback_runtime_sha,rollbackId,completedAt,rollback.target_environment_id]);
  return {id:rollback.id,promotionId:rollback.promotion_id,status:'COMPLETED',
    targetEnvironmentId:rollback.target_environment_id,rollbackRuntimeSha:rollback.rollback_runtime_sha,
    executionMode:upper(input.executionMode),completedAt,idempotent:false};
};

export const evaluateM30ReleaseRollbackGate=async(workspaceId,input={})=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();
  const upstream=await one(db,`SELECT status FROM m30_ops_foundation_gate_evaluations
    WHERE workspace_id=? AND gate_key='G-M30-OPS-FOUNDATION' ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]);
  const [candidateCount,nonProdPromotionCount,rollbackCount,productionGuardCount]=await Promise.all([
    count(db,"SELECT COUNT(*) count FROM platform_release_candidates WHERE workspace_id=? AND status='FROZEN'",[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_release_promotions p
      JOIN platform_environments e ON e.id=p.target_environment_id
      WHERE p.workspace_id=? AND e.environment_type<>'PRODUCTION' AND p.status IN ('PROMOTED','ROLLED_BACK')`,[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_rollback_requests r
      JOIN platform_release_promotions p ON p.id=r.promotion_id
      JOIN platform_environments e ON e.id=p.target_environment_id
      WHERE r.workspace_id=? AND e.environment_type<>'PRODUCTION' AND r.status='COMPLETED'`,[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_release_promotions p
      JOIN platform_environments e ON e.id=p.target_environment_id
      JOIN approval_requests a ON a.id=p.approval_request_id
      WHERE p.workspace_id=? AND e.environment_type='PRODUCTION'
        AND p.status='PENDING_APPROVAL' AND a.status='PENDING' AND a.requested_action='PRODUCTION_RELEASE_PROMOTION'`,[workspaceId])
  ]);
  const reasons=[];
  if(upstream?.status!=='PASS')reasons.push('M30_OPS_FOUNDATION_PASS_REQUIRED');
  if(candidateCount<1)reasons.push('M30_FROZEN_RELEASE_CANDIDATE_REQUIRED');
  if(nonProdPromotionCount<1)reasons.push('M30_NON_PRODUCTION_PROMOTION_REQUIRED');
  if(rollbackCount<1)reasons.push('M30_NON_PRODUCTION_ROLLBACK_REQUIRED');
  if(productionGuardCount<1)reasons.push('M30_PRODUCTION_HUMAN_GATE_CONTRACT_REQUIRED');
  const evidence={upstreamOpsFoundationStatus:upstream?.status||null,candidateCount,nonProdPromotionCount,
    rollbackCount,productionGuardCount,productionPromotionExecuted:false,
    exactVersionRequired:true,productionHumanGateRequired:true};
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_release_rollback_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30ReleaseRollbackState=async workspaceId=>{
  const db=getRuntimePool();
  const [candidates,promotions,rollbacks,gates]=await Promise.all([
    list(db,'SELECT * FROM platform_release_candidates WHERE workspace_id=? ORDER BY frozen_at DESC,created_at DESC',[workspaceId]),
    list(db,`SELECT p.*,s.environment_key source_environment_key,t.environment_key target_environment_key,
      t.environment_type target_environment_type FROM platform_release_promotions p
      JOIN platform_environments s ON s.id=p.source_environment_id
      JOIN platform_environments t ON t.id=p.target_environment_id
      WHERE p.workspace_id=? ORDER BY p.requested_at DESC,p.created_at DESC`,[workspaceId]),
    list(db,'SELECT * FROM platform_rollback_requests WHERE workspace_id=? ORDER BY requested_at DESC,created_at DESC',[workspaceId]),
    list(db,`SELECT * FROM m30_release_rollback_gate_evaluations
      WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId])
  ]);
  return {
    frontend:{language:'zh-CN',title:'环境 / 发布晋级 / 回滚',
      policy:'非生产环境可由受控自动化执行并记录 exact-version 回执；Production 晋级与回滚必须 Human Approval + HUMAN non-synthetic execution receipt。'},
    candidates:candidates.map(x=>({id:x.id,candidateKey:x.candidate_key,versionLabel:x.version_label,
      exactRuntimeSha:x.exact_runtime_sha,artifactSha256:x.artifact_sha256,migrationFingerprint:x.migration_fingerprint,
      sourceEnvironmentId:x.source_environment_id,status:x.status,frozenAt:x.frozen_at})),
    promotions:promotions.map(x=>({id:x.id,promotionKey:x.promotion_key,candidateId:x.candidate_id,
      sourceEnvironmentId:x.source_environment_id,sourceEnvironmentKey:x.source_environment_key,
      targetEnvironmentId:x.target_environment_id,targetEnvironmentKey:x.target_environment_key,
      targetEnvironmentType:x.target_environment_type,approvalRequestId:x.approval_request_id,
      rollbackRuntimeSha:x.rollback_runtime_sha,status:x.status,executionMode:x.execution_mode,
      executionReceipt:parseJson(x.execution_receipt_json),requestedAt:x.requested_at,promotedAt:x.promoted_at})),
    rollbacks:rollbacks.map(x=>({id:x.id,rollbackKey:x.rollback_key,promotionId:x.promotion_id,
      rollbackRuntimeSha:x.rollback_runtime_sha,approvalRequestId:x.approval_request_id,status:x.status,
      executionMode:x.execution_mode,executionReceipt:parseJson(x.execution_receipt_json),
      requestedAt:x.requested_at,completedAt:x.completed_at})),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,
      reasonCodes:parseJson(gates[0].reason_codes_json),evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),
      asOf:gates[0].as_of}:null
  };
};
