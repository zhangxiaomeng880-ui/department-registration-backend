import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5019';
const token=must('RUNTIME_API_TOKEN');
const runtimeSha=must('RUNTIME_COMMIT_SHA').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/);
const manifestSha='d'.repeat(64);
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body.data;};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[workspaceGate]]=await db.execute(
  `SELECT workspace_id FROM m30_alert_incident_gate_evaluations
    WHERE gate_key='G-M30-ALERT-INCIDENT' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`
);
assert.ok(workspaceGate,'M30.3 PASS workspace required');
const workspaceId=workspaceGate.workspace_id;
const [[sourceEnv]]=await db.execute(
  `SELECT * FROM platform_environments WHERE workspace_id=? AND environment_type='STAGING'
    ORDER BY updated_at DESC LIMIT 1`,[workspaceId]
);
const [[previewEnv]]=await db.execute(
  `SELECT * FROM platform_environments WHERE workspace_id=? AND environment_type='PREVIEW'
    ORDER BY updated_at DESC LIMIT 1`,[workspaceId]
);
const [[prodEnv]]=await db.execute(
  `SELECT * FROM platform_environments WHERE workspace_id=? AND environment_type='PRODUCTION'
    ORDER BY updated_at DESC LIMIT 1`,[workspaceId]
);
assert.ok(sourceEnv&&previewEnv&&prodEnv,'STAGING/PREVIEW/PRODUCTION environment contracts required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_RETENTION_POLICY,'平台保留策略');
assert.equal(modules.M30_BACKUP_SNAPSHOT,'备份快照');
assert.equal(modules.M30_RESTORE_REHEARSAL,'恢复演练');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-RETENTION-BACKUP').displayName,'保留 / 备份 / 恢复门禁');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-retention-policies`,{
  policyKey:'M304-RUNTIME-EVIDENCE',displayName:'运行与证据保留策略',scopeType:'ALL',
  retentionDays:30,backupRetentionDays:90,legalHoldSupported:true,deletionMode:'POLICY_CONTROLLED',
  policy:{runtimeDays:30,evidenceDays:90,legalHoldBlocksDeletion:true,backupDataExternal:true},
  evidence:{test:true,source:'M30.4'}
});
const policy=expect(r,201);
assert.equal(policy.status,'ACTIVE');
assert.equal(policy.backupRetentionDays,90);

// Reject raw credentials in storage references/evidence.
r=await request('POST',`/api/runtime/platform-retention-policies/${policy.id}/backups`,{
  backupKey:'M304-BAD-SECRET',environmentId:sourceEnv.id,backupType:'LOGICAL',
  exactRuntimeSha:runtimeSha,manifestSha256:manifestSha,storageRef:'sk-secret-should-fail',
  backupScope:{tables:['runtime']},verification:{status:'PASS',checksumStatus:'PASS',readabilityStatus:'PASS'},
  capturedAt:'2026-10-07T08:40:00Z',isSynthetic:true,evidence:{test:true}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_BACKUP_RAW_SECRET_NOT_ALLOWED');

r=await request('POST',`/api/runtime/platform-retention-policies/${policy.id}/backups`,{
  backupKey:'M304-STAGING-BACKUP',environmentId:sourceEnv.id,backupType:'LOGICAL',
  exactRuntimeSha:runtimeSha,manifestSha256:manifestSha,storageRef:'fixture://external-backup/m304/staging',
  backupScope:{database:'ai_native_runtime',objects:['runtime','evidence','config']},
  verification:{status:'PASS',checksumStatus:'PASS',readabilityStatus:'PASS',manifestEntries:42},
  capturedAt:'2026-10-07T08:40:00Z',isSynthetic:true,
  evidence:{test:true,externalStorageContract:true}
});
const backup=expect(r,201);
assert.equal(backup.status,'VERIFIED');
assert.equal(backup.exactRuntimeSha,runtimeSha);
assert.equal(backup.isSynthetic,true);

// Production restore is structurally forbidden for CI/synthetic execution.
r=await request('POST',`/api/runtime/platform-backups/${backup.id}/restore-rehearsals`,{
  rehearsalKey:'M304-PROD-MUST-BLOCK',targetEnvironmentId:prodEnv.id,executionMode:'CI',isSynthetic:true,
  restoreReceipt:{externalRestoreRef:'ci://must-not-restore-production',restoredRuntimeSha:runtimeSha},
  verification:{status:'PASS',healthStatus:'PASS',smokeStatus:'PASS'},
  startedAt:'2026-10-07T08:41:00Z',completedAt:'2026-10-07T08:41:30Z',
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_PRODUCTION_RESTORE_HUMAN_REQUIRED');

// Non-production restore rehearsal proves the contract without touching Production.
r=await request('POST',`/api/runtime/platform-backups/${backup.id}/restore-rehearsals`,{
  rehearsalKey:'M304-PREVIEW-RESTORE',targetEnvironmentId:previewEnv.id,executionMode:'CI',isSynthetic:true,
  restoreReceipt:{externalRestoreRef:'ci://m304/preview/restore',restoredRuntimeSha:runtimeSha},
  verification:{status:'PASS',healthStatus:'PASS',smokeStatus:'PASS',readability:'PASS'},
  startedAt:'2026-10-07T08:42:00Z',completedAt:'2026-10-07T08:42:30Z',
  evidence:{test:true,rehearsal:true}
});
const restore=expect(r,201);
assert.equal(restore.status,'PASS');
assert.equal(restore.targetEnvironmentId,previewEnv.id);

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-gates/G-M30-RETENTION-BACKUP/evaluate`,{
  asOf:'2026-10-07T08:43:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.upstreamAlertIncidentStatus,'PASS');
assert.ok(gate.evidenceSnapshot.activeRetentionPolicyCount>=1);
assert.ok(gate.evidenceSnapshot.verifiedBackupCount>=1);
assert.ok(gate.evidenceSnapshot.nonProductionRestorePassCount>=1);
assert.equal(gate.evidenceSnapshot.productionSyntheticRestoreCount,0);
assert.equal(gate.evidenceSnapshot.backupDataStoredExternally,true);
assert.equal(gate.evidenceSnapshot.productionRestoreRequiresHuman,true);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/m30-retention-backup`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.match(state.frontend.policy,/外部存储/);
assert.ok(state.policies.some(x=>x.id===policy.id&&x.status==='ACTIVE'));
assert.ok(state.backups.some(x=>x.id===backup.id&&x.status==='VERIFIED'));
assert.ok(state.restores.some(x=>x.id===restore.id&&x.status==='PASS'));
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM platform_restore_rehearsals r JOIN platform_environments e ON e.id=r.target_environment_id
      WHERE r.workspace_id=? AND e.environment_type='PRODUCTION') production_restores,
    (SELECT COUNT(*) FROM platform_restore_rehearsals WHERE workspace_id=? AND status='PASS') restore_pass,
    (SELECT COUNT(*) FROM platform_backup_snapshots WHERE workspace_id=? AND verification_status='VERIFIED') backups`,
  [workspaceId,workspaceId,workspaceId]
);
assert.equal(Number(truth.production_restores),0);
assert.ok(Number(truth.restore_pass)>=1);
assert.ok(Number(truth.backups)>=1);

await db.end();
console.log('M30_4_RETENTION_BACKUP_RESTORE_PASS_PRODUCTION_RESTORE_HOLD');
