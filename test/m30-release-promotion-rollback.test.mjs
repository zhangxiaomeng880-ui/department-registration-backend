import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5017';
const token=must('RUNTIME_API_TOKEN');
const runtimeSha=must('RUNTIME_COMMIT_SHA').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/);
const artifactSha='c'.repeat(64);
const rollbackSha='b'.repeat(40);
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

const [[gateWorkspace]]=await db.execute(
  `SELECT g.workspace_id FROM m30_ops_foundation_gate_evaluations g
    WHERE g.gate_key='G-M30-OPS-FOUNDATION' AND g.status='PASS'
    ORDER BY g.as_of DESC,g.created_at DESC LIMIT 1`
);
assert.ok(gateWorkspace,'M30.1 PASS workspace required');
const workspaceId=gateWorkspace.workspace_id;
const [[sourceEnv]]=await db.execute(
  `SELECT * FROM platform_environments
    WHERE workspace_id=? AND environment_type='STAGING' AND health_status='HEALTHY' AND status='ACTIVE'
    ORDER BY updated_at DESC LIMIT 1`,[workspaceId]
);
assert.ok(sourceEnv,'Healthy STAGING environment required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_RELEASE_CANDIDATE,'平台发布候选');
assert.equal(modules.M30_RELEASE_PROMOTION,'环境晋级');
assert.equal(modules.M30_RELEASE_ROLLBACK,'环境回滚');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-environments`,{
  environmentKey:'preview-m302',displayName:'M30.2 验证环境',environmentType:'PREVIEW',
  releaseChannel:'validation',externalRef:{platform:'CI',activeRuntimeSha:rollbackSha},
  healthStatus:'UNKNOWN',metadata:{synthetic:true},evidence:{test:true,source:'M30.2'}
});
const preview=expect(r,201);
r=await request('POST',`/api/runtime/platform-environments/${preview.id}/health`,{
  healthStatus:'HEALTHY',reasonCode:'PREVIEW_READY',latencyMs:12,
  observedAt:'2026-10-07T08:20:00Z',source:'M30_CI',evidence:{test:true}
});
expect(r,200);

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-environments`,{
  environmentKey:'production-m302',displayName:'M30.2 生产环境契约',environmentType:'PRODUCTION',
  releaseChannel:'stable',externalRef:{platform:'EXTERNAL_CONTROL_PLANE',activeRuntimeSha:rollbackSha},
  healthStatus:'UNKNOWN',metadata:{contractOnly:true},evidence:{test:true,source:'M30.2'}
});
const production=expect(r,201);
r=await request('POST',`/api/runtime/platform-environments/${production.id}/health`,{
  healthStatus:'HEALTHY',reasonCode:'CONTROL_PLANE_REACHABLE',latencyMs:25,
  observedAt:'2026-10-07T08:20:10Z',source:'M30_CI',evidence:{test:true,contractOnly:true}
});
expect(r,200);

// Candidate must be exact-version and secret-free.
r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-release-candidates`,{
  candidateKey:'M302-RUNTIME-CANDIDATE',sourceEnvironmentId:sourceEnv.id,
  versionLabel:'runtime-m30.2-ci',exactRuntimeSha:'not-a-sha',artifactSha256:artifactSha,
  migrationFingerprint:'migrations=71',sourceEvidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_RELEASE_RUNTIME_SHA_REQUIRED');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-release-candidates`,{
  candidateKey:'M302-RUNTIME-CANDIDATE',sourceEnvironmentId:sourceEnv.id,
  versionLabel:'runtime-m30.2-ci',exactRuntimeSha:runtimeSha,artifactSha256:artifactSha,
  migrationFingerprint:'070_m30_release_promotion_rollback.sql',
  sourceEvidence:{test:true,gitHubRun:'M30.2'}
});
const candidate=expect(r,201);
assert.equal(candidate.status,'FROZEN');
assert.equal(candidate.exactRuntimeSha,runtimeSha);

// Controlled non-production promotion.
r=await request('POST',`/api/runtime/platform-release-candidates/${candidate.id}/promotions`,{
  promotionKey:'M302-STAGING-TO-PREVIEW',targetEnvironmentId:preview.id,
  rollbackRuntimeSha:rollbackSha,riskLevel:'MEDIUM',evidence:{test:true,scope:'NON_PRODUCTION'}
});
const promotion=expect(r,201);
assert.equal(promotion.status,'READY');
assert.equal(promotion.approvalRequestId,null);

r=await request('POST',`/api/runtime/platform-promotions/${promotion.id}/execute`,{
  executionMode:'CI',externalDeploymentRef:'ci://m302/preview/1',
  deployedRuntimeSha:runtimeSha,healthStatus:'PASS',smokeStatus:'PASS',isSynthetic:true,
  promotedAt:'2026-10-07T08:21:00Z',evidence:{test:true,nonProduction:true}
});
const promoted=expect(r,200);
assert.equal(promoted.status,'PROMOTED');
assert.equal(promoted.exactRuntimeSha,runtimeSha);

// Rollback rehearsal returns the target environment to its exact prior SHA.
r=await request('POST',`/api/runtime/platform-promotions/${promotion.id}/rollbacks`,{
  rollbackKey:'M302-PREVIEW-ROLLBACK',riskLevel:'MEDIUM',evidence:{test:true,reason:'rollback rehearsal'}
});
const rollback=expect(r,201);
assert.equal(rollback.status,'READY');
assert.equal(rollback.rollbackRuntimeSha,rollbackSha);

r=await request('POST',`/api/runtime/platform-rollbacks/${rollback.id}/execute`,{
  executionMode:'CI',externalDeploymentRef:'ci://m302/preview/rollback/1',
  deployedRuntimeSha:rollbackSha,healthStatus:'PASS',smokeStatus:'PASS',isSynthetic:true,
  completedAt:'2026-10-07T08:22:00Z',evidence:{test:true,rehearsal:true}
});
const rolled=expect(r,200);
assert.equal(rolled.status,'COMPLETED');
assert.equal(rolled.rollbackRuntimeSha,rollbackSha);

// Production request must create a real Human Gate and remain unexecuted in CI.
r=await request('POST',`/api/runtime/platform-release-candidates/${candidate.id}/promotions`,{
  promotionKey:'M302-PRODUCTION-GUARD',targetEnvironmentId:production.id,
  rollbackRuntimeSha:rollbackSha,evidence:{test:true,contractOnly:true}
});
const prodPromotion=expect(r,201);
assert.equal(prodPromotion.status,'PENDING_APPROVAL');
assert.ok(prodPromotion.approvalRequestId);
assert.equal(prodPromotion.riskLevel,'HIGH');

r=await request('POST',`/api/runtime/platform-promotions/${prodPromotion.id}/execute`,{
  executionMode:'CI',externalDeploymentRef:'ci://must-not-deploy-production',
  deployedRuntimeSha:runtimeSha,healthStatus:'PASS',smokeStatus:'PASS',isSynthetic:true,
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_PRODUCTION_APPROVAL_REQUIRED');

const [[approval]]=await db.execute('SELECT * FROM approval_requests WHERE id=?',[prodPromotion.approvalRequestId]);
assert.equal(approval.status,'PENDING');
assert.equal(approval.requested_action,'PRODUCTION_RELEASE_PROMOTION');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-gates/G-M30-RELEASE-ROLLBACK/evaluate`,{
  asOf:'2026-10-07T08:23:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.upstreamOpsFoundationStatus,'PASS');
assert.ok(gate.evidenceSnapshot.nonProdPromotionCount>=1);
assert.ok(gate.evidenceSnapshot.rollbackCount>=1);
assert.ok(gate.evidenceSnapshot.productionGuardCount>=1);
assert.equal(gate.evidenceSnapshot.productionPromotionExecuted,false);
assert.equal(gate.evidenceSnapshot.productionHumanGateRequired,true);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/m30-release-rollback`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.match(state.frontend.policy,/Production/);
assert.ok(state.candidates.length>=1);
assert.ok(state.promotions.some(x=>x.status==='ROLLED_BACK'));
assert.ok(state.promotions.some(x=>x.status==='PENDING_APPROVAL'&&x.targetEnvironmentType==='PRODUCTION'));
assert.ok(state.rollbacks.some(x=>x.status==='COMPLETED'));
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM platform_release_promotions p JOIN platform_environments e ON e.id=p.target_environment_id
      WHERE p.workspace_id=? AND e.environment_type='PRODUCTION' AND p.status='PROMOTED') production_promoted,
    (SELECT COUNT(*) FROM platform_rollback_requests r JOIN platform_release_promotions p ON p.id=r.promotion_id
      WHERE r.workspace_id=? AND r.status='COMPLETED' AND p.status='ROLLED_BACK') rollback_completed,
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(external_ref_json,'$.activeRuntimeSha')) FROM platform_environments WHERE id=?) preview_sha`,
  [workspaceId,workspaceId,preview.id]
);
assert.equal(Number(truth.production_promoted),0);
assert.ok(Number(truth.rollback_completed)>=1);
assert.equal(truth.preview_sha,rollbackSha);

await db.end();
console.log('M30_2_RELEASE_PROMOTION_ROLLBACK_PASS_PRODUCTION_HUMAN_GATE_HOLD');
