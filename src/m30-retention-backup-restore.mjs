import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SHA40=/^[0-9a-f]{40}$/i;
const SHA64=/^[0-9a-f]{64}$/i;
const GATE='G-M30-RETENTION-BACKUP';
const SCOPES=new Set(['RUNTIME_DATA','EVIDENCE','CONFIG','ALL']);

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
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
        'Retention/backup records must not persist raw credentials','M30_BACKUP_RAW_SECRET_NOT_ALLOWED',400,{field:path}
      );
      return;
    }
    if(typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      const next=path?path+'.'+key:key;
      if(secretKeyPattern.test(key))throw errorOf(
        'Retention/backup records must not persist raw credentials','M30_BACKUP_RAW_SECRET_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const row=await one(db,'SELECT id,tenant_id,workspace_key,name FROM workspaces WHERE id=?',[workspaceId]);
  if(!row)throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return row;
};
const loadPolicy=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_retention_policies WHERE id=?',[id]);
  if(!row)throw errorOf('Retention policy not found','M30_RETENTION_POLICY_NOT_FOUND',404);
  return row;
};
const loadBackup=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_backup_snapshots WHERE id=?',[id]);
  if(!row)throw errorOf('Backup snapshot not found','M30_BACKUP_NOT_FOUND',404);
  return row;
};
const loadEnvironment=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_environments WHERE id=?',[id]);
  if(!row)throw errorOf('Platform environment not found','M30_ENVIRONMENT_NOT_FOUND',404);
  return row;
};

export const resolveM30RetentionPolicyScope=async id=>{
  const x=await loadPolicy(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};
export const resolveM30BackupScope=async id=>{
  const x=await loadBackup(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};

export const createPlatformRetentionPolicy=async(workspaceId,input={},actorId=null)=>{
  requireFields(input,['policyKey','displayName','scopeType','retentionDays','backupRetentionDays','policy','evidence'],
    'INVALID_M30_RETENTION_POLICY');
  const scope=upper(input.scopeType);
  if(!SCOPES.has(scope))throw errorOf('Invalid retention scope','M30_RETENTION_SCOPE_INVALID');
  const retentionDays=Number(input.retentionDays),backupRetentionDays=Number(input.backupRetentionDays);
  if(!Number.isInteger(retentionDays)||retentionDays<1||!Number.isInteger(backupRetentionDays)||backupRetentionDays<retentionDays)
    throw errorOf('backupRetentionDays must be an integer >= retentionDays >= 1','M30_RETENTION_DAYS_INVALID',409);
  rejectSecrets(input);
  const db=getRuntimePool(),w=await loadWorkspace(workspaceId,db),id=randomUUID();
  await db.execute(`INSERT INTO platform_retention_policies
    (id,tenant_id,workspace_id,policy_key,display_name,scope_type,retention_days,backup_retention_days,
     legal_hold_supported,deletion_mode,policy_json,status,evidence_json,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
    [id,w.tenant_id,workspaceId,input.policyKey,input.displayName,scope,retentionDays,backupRetentionDays,
     input.legalHoldSupported!==false,upper(input.deletionMode||'POLICY_CONTROLLED'),asJson(input.policy),
     asJson(input.evidence),actorId]);
  return {id,workspaceId,policyKey:input.policyKey,displayName:input.displayName,scopeType:scope,
    retentionDays,backupRetentionDays,legalHoldSupported:input.legalHoldSupported!==false,
    deletionMode:upper(input.deletionMode||'POLICY_CONTROLLED'),status:'ACTIVE'};
};

export const recordPlatformBackupSnapshot=async(policyId,input={},actorId=null)=>{
  requireFields(input,['backupKey','environmentId','backupType','exactRuntimeSha','manifestSha256','storageRef',
    'backupScope','verification','capturedAt','evidence'],'INVALID_M30_BACKUP');
  if(!SHA40.test(String(input.exactRuntimeSha)))throw errorOf('Invalid exactRuntimeSha','M30_BACKUP_RUNTIME_SHA_REQUIRED',409);
  if(!SHA64.test(String(input.manifestSha256)))throw errorOf('Invalid manifestSha256','M30_BACKUP_MANIFEST_SHA_REQUIRED',409);
  rejectSecrets(input);
  const db=getRuntimePool(),policy=await loadPolicy(policyId,db),env=await loadEnvironment(input.environmentId,db);
  if(env.workspace_id!==policy.workspace_id)throw errorOf('Backup environment must belong to policy workspace',
    'M30_BACKUP_ENVIRONMENT_SCOPE_MISMATCH',409);
  if(policy.status!=='ACTIVE')throw errorOf('Retention policy must be ACTIVE','M30_RETENTION_POLICY_NOT_ACTIVE',409);
  const verification=input.verification||{};
  if(upper(verification.status)!=='PASS'||upper(verification.checksumStatus)!=='PASS'||
     upper(verification.readabilityStatus)!=='PASS')
    throw errorOf('Backup verification, checksum and readability must PASS','M30_BACKUP_VERIFICATION_REQUIRED',409);
  const capturedAt=asDate(input.capturedAt);
  const expiresAt=input.expiresAt?asDate(input.expiresAt):
    new Date(capturedAt.getTime()+policy.backup_retention_days*86400000);
  if(expiresAt<=capturedAt)throw errorOf('Backup expiresAt must be after capturedAt','M30_BACKUP_EXPIRY_INVALID',409);
  const id=randomUUID();
  await db.execute(`INSERT INTO platform_backup_snapshots
    (id,tenant_id,workspace_id,retention_policy_id,environment_id,backup_key,backup_type,exact_runtime_sha,
     manifest_sha256,storage_ref,backup_scope_json,verification_json,verification_status,is_synthetic,
     captured_at,expires_at,evidence_json,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'VERIFIED',?,?,?,?,?)`,
    [id,policy.tenant_id,policy.workspace_id,policy.id,env.id,input.backupKey,upper(input.backupType),
     String(input.exactRuntimeSha).toLowerCase(),String(input.manifestSha256).toLowerCase(),input.storageRef,
     asJson(input.backupScope),asJson(verification),input.isSynthetic===true?1:0,capturedAt,expiresAt,
     asJson(input.evidence),actorId]);
  return {id,workspaceId:policy.workspace_id,policyId:policy.id,environmentId:env.id,backupKey:input.backupKey,
    status:'VERIFIED',exactRuntimeSha:String(input.exactRuntimeSha).toLowerCase(),
    manifestSha256:String(input.manifestSha256).toLowerCase(),isSynthetic:input.isSynthetic===true,capturedAt,expiresAt};
};

export const recordPlatformRestoreRehearsal=async(backupId,input={},actorId=null)=>{
  requireFields(input,['rehearsalKey','targetEnvironmentId','executionMode','restoreReceipt','verification',
    'startedAt','completedAt','evidence'],'INVALID_M30_RESTORE_REHEARSAL');
  rejectSecrets(input);
  const db=getRuntimePool(),backup=await loadBackup(backupId,db),env=await loadEnvironment(input.targetEnvironmentId,db);
  if(env.workspace_id!==backup.workspace_id)throw errorOf('Restore environment must belong to backup workspace',
    'M30_RESTORE_ENVIRONMENT_SCOPE_MISMATCH',409);
  if(backup.verification_status!=='VERIFIED')throw errorOf('Restore requires VERIFIED backup','M30_RESTORE_BACKUP_NOT_VERIFIED',409);
  const mode=upper(input.executionMode),synthetic=input.isSynthetic===true;
  if(env.environment_type==='PRODUCTION'&&(mode!=='HUMAN'||synthetic))throw errorOf(
    'Production restore requires HUMAN non-synthetic execution','M30_PRODUCTION_RESTORE_HUMAN_REQUIRED',409
  );
  const receipt=input.restoreReceipt||{},verification=input.verification||{};
  if(!SHA40.test(String(receipt.restoredRuntimeSha||''))||
     String(receipt.restoredRuntimeSha).toLowerCase()!==String(backup.exact_runtime_sha).toLowerCase())
    throw errorOf('Restore receipt must match backup exact Runtime SHA','M30_RESTORE_EXACT_SHA_MISMATCH',409);
  if(upper(verification.status)!=='PASS'||upper(verification.healthStatus)!=='PASS'||upper(verification.smokeStatus)!=='PASS')
    throw errorOf('Restore health and smoke verification must PASS','M30_RESTORE_VERIFICATION_REQUIRED',409);
  const startedAt=asDate(input.startedAt),completedAt=asDate(input.completedAt);
  if(completedAt<startedAt)throw errorOf('completedAt must be >= startedAt','M30_RESTORE_TIME_INVALID',409);
  const id=randomUUID();
  await db.execute(`INSERT INTO platform_restore_rehearsals
    (id,tenant_id,workspace_id,backup_snapshot_id,target_environment_id,rehearsal_key,execution_mode,is_synthetic,
     restore_receipt_json,verification_json,status,started_at,completed_at,evidence_json,executed_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,'PASS',?,?,?,?)`,
    [id,backup.tenant_id,backup.workspace_id,backup.id,env.id,input.rehearsalKey,mode,synthetic?1:0,
     asJson(receipt),asJson(verification),startedAt,completedAt,asJson(input.evidence),actorId]);
  return {id,workspaceId:backup.workspace_id,backupSnapshotId:backup.id,targetEnvironmentId:env.id,
    rehearsalKey:input.rehearsalKey,executionMode:mode,isSynthetic:synthetic,status:'PASS',
    exactRuntimeSha:backup.exact_runtime_sha,startedAt,completedAt};
};

export const evaluateM30RetentionBackupGate=async(workspaceId,input={})=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();
  const upstream=await one(db,`SELECT status FROM m30_alert_incident_gate_evaluations
    WHERE workspace_id=? AND gate_key='G-M30-ALERT-INCIDENT' ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]);
  const [policies,verifiedBackups,restorePass,productionSyntheticRestore]=await Promise.all([
    count(db,"SELECT COUNT(*) count FROM platform_retention_policies WHERE workspace_id=? AND status='ACTIVE'",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM platform_backup_snapshots WHERE workspace_id=? AND verification_status='VERIFIED'",[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_restore_rehearsals r
      JOIN platform_environments e ON e.id=r.target_environment_id
      WHERE r.workspace_id=? AND r.status='PASS' AND e.environment_type<>'PRODUCTION'`,[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_restore_rehearsals r
      JOIN platform_environments e ON e.id=r.target_environment_id
      WHERE r.workspace_id=? AND e.environment_type='PRODUCTION' AND (r.execution_mode<>'HUMAN' OR r.is_synthetic=TRUE)`,[workspaceId])
  ]);
  const reasons=[];
  if(upstream?.status!=='PASS')reasons.push('M30_ALERT_INCIDENT_PASS_REQUIRED');
  if(policies<1)reasons.push('M30_RETENTION_POLICY_REQUIRED');
  if(verifiedBackups<1)reasons.push('M30_VERIFIED_BACKUP_REQUIRED');
  if(restorePass<1)reasons.push('M30_NON_PRODUCTION_RESTORE_REHEARSAL_REQUIRED');
  if(productionSyntheticRestore>0)reasons.push('M30_PRODUCTION_SYNTHETIC_RESTORE_FORBIDDEN');
  const evidence={upstreamAlertIncidentStatus:upstream?.status||null,activeRetentionPolicyCount:policies,
    verifiedBackupCount:verifiedBackups,nonProductionRestorePassCount:restorePass,
    productionSyntheticRestoreCount:productionSyntheticRestore,backupDataStoredExternally:true,
    productionRestoreRequiresHuman:true};
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_retention_backup_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30RetentionBackupState=async workspaceId=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const [policies,backups,restores,gates]=await Promise.all([
    list(db,'SELECT * FROM platform_retention_policies WHERE workspace_id=? ORDER BY created_at,id',[workspaceId]),
    list(db,'SELECT * FROM platform_backup_snapshots WHERE workspace_id=? ORDER BY captured_at DESC,created_at DESC',[workspaceId]),
    list(db,'SELECT * FROM platform_restore_rehearsals WHERE workspace_id=? ORDER BY completed_at DESC,created_at DESC',[workspaceId]),
    list(db,`SELECT * FROM m30_retention_backup_gate_evaluations
      WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId])
  ]);
  return {
    frontend:{language:'zh-CN',title:'保留 / 备份 / 恢复',
      policy:'数据库只保存 Retention/Backup/Restore 控制面与校验证据，备份实体保存在外部存储；Production Restore 必须 HUMAN non-synthetic。'},
    policies:policies.map(x=>({id:x.id,policyKey:x.policy_key,displayName:x.display_name,scopeType:x.scope_type,
      retentionDays:x.retention_days,backupRetentionDays:x.backup_retention_days,
      legalHoldSupported:Boolean(x.legal_hold_supported),deletionMode:x.deletion_mode,status:x.status,
      policy:parseJson(x.policy_json)})),
    backups:backups.map(x=>({id:x.id,policyId:x.retention_policy_id,environmentId:x.environment_id,
      backupKey:x.backup_key,backupType:x.backup_type,exactRuntimeSha:x.exact_runtime_sha,
      manifestSha256:x.manifest_sha256,storageRef:x.storage_ref,backupScope:parseJson(x.backup_scope_json),
      verification:parseJson(x.verification_json),status:x.verification_status,isSynthetic:Boolean(x.is_synthetic),
      capturedAt:x.captured_at,expiresAt:x.expires_at})),
    restores:restores.map(x=>({id:x.id,backupSnapshotId:x.backup_snapshot_id,targetEnvironmentId:x.target_environment_id,
      rehearsalKey:x.rehearsal_key,executionMode:x.execution_mode,isSynthetic:Boolean(x.is_synthetic),
      restoreReceipt:parseJson(x.restore_receipt_json),verification:parseJson(x.verification_json),
      status:x.status,startedAt:x.started_at,completedAt:x.completed_at})),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,
      reasonCodes:parseJson(gates[0].reason_codes_json),evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),
      asOf:gates[0].as_of}:null
  };
};
