import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5021';
const token=must('RUNTIME_API_TOKEN');
const runtimeSha=must('RUNTIME_COMMIT_SHA').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/);
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
const markers=[
  'M29_5_IMPLEMENTATION_FINAL_PASS_REAL_DUAL_DOMAIN_EXIT_HOLD',
  'M30_1_PRIVATE_WORKSPACE_OPS_FOUNDATION_PASS',
  'M30_2_RELEASE_PROMOTION_ROLLBACK_PASS_PRODUCTION_HUMAN_GATE_HOLD',
  'M30_3_ALERT_INCIDENT_RECOVERY_LOOP_PASS',
  'M30_4_RETENTION_BACKUP_RESTORE_PASS_PRODUCTION_RESTORE_HOLD',
  'M30_5_GLOBAL_SEARCH_AUDIT_EVIDENCE_PASS'
];

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_IMPLEMENTATION_FINAL_GATE,'M30 实现最终验收');
assert.equal(modules.AI_NATIVE_2_REAL_FINAL_EVIDENCE,'AI Native 2.0 真实最终实证');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-FINAL').displayName,'AI Native 2.0 最终门禁');

// A missing/incomplete regression receipt cannot close M30 implementation.
r=await request('POST','/api/runtime/m30-gates/G-M30-FINAL/evaluate',{
  asOf:'2026-10-07T09:10:00Z',
  regressionEvidence:{status:'PASS',scope:'M25-M30.5',runtimeCommitSha:runtimeSha,source:'GITHUB_ACTIONS',markers:markers.slice(0,2)},
  realProductE2E:true,realAigcE2E:true,realDualLoop:true,
  persist:false
});
let gate=expect(r,200);
assert.equal(gate.implementationStatus,'HOLD');
assert.ok(gate.reasonCodes.includes('M30_IMPLEMENTATION_FULL_REGRESSION_REQUIRED'));

// Exact Runtime SHA is part of the aggregate evidence contract.
r=await request('POST','/api/runtime/m30-gates/G-M30-FINAL/evaluate',{
  asOf:'2026-10-07T09:10:10Z',
  regressionEvidence:{status:'PASS',scope:'M25-M30.5',runtimeCommitSha:'a'.repeat(40),source:'GITHUB_ACTIONS',markers},
  persist:false
});
gate=expect(r,200);
assert.equal(gate.implementationStatus,'HOLD');
assert.ok(gate.reasonCodes.includes('M30_IMPLEMENTATION_FULL_REGRESSION_REQUIRED'));

// Full implementation aggregate may PASS, while real Blueprint FINAL must remain HOLD.
r=await request('POST','/api/runtime/m30-gates/G-M30-FINAL/evaluate',{
  asOf:'2026-10-07T09:11:00Z',
  regressionEvidence:{status:'PASS',scope:'M25-M30.5',runtimeCommitSha:runtimeSha,source:'GITHUB_ACTIONS',markers}
});
gate=expect(r,200);
assert.equal(gate.implementationStatus,'PASS',JSON.stringify(gate.implementationCriteria));
assert.ok(gate.implementationCriteria.every(x=>x.status==='PASS'),JSON.stringify(gate.implementationCriteria));
assert.equal(gate.blueprintFinalStatus,'HOLD');
assert.equal(gate.evidenceSnapshot.implementationCriteriaPassed,gate.evidenceSnapshot.implementationCriteriaTotal);
assert.equal(gate.evidenceSnapshot.syntheticOrCiEvidenceCannotSatisfyRealFinal,true);
assert.equal(gate.evidenceSnapshot.finalFrozenAllowedOnlyWhenBlueprintFinalPass,true);
assert.equal(gate.evidenceSnapshot.unsafeProductionAutomationCount,0);

// User/CI supplied booleans are ignored; only persisted HUMAN/non-synthetic facts can satisfy real FINAL.
assert.ok(gate.reasonCodes.includes('AI_NATIVE_2_REAL_AIGC_E2E_REQUIRED'));
assert.ok(gate.reasonCodes.includes('AI_NATIVE_2_REAL_DUAL_DOMAIN_SELF_LOOP_REQUIRED'));
assert.equal(gate.finalCriteria.find(x=>x.key==='REAL_AIGC_E2E').status,'HOLD');
assert.equal(gate.finalCriteria.find(x=>x.key==='REAL_DUAL_DOMAIN_SELF_LOOP').status,'HOLD');

r=await request('GET','/api/runtime/m30-final');
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.gateName,'AI Native 2.0 最终门禁');
assert.match(state.frontend.realFinalPolicy,/CI\/Synthetic/);
assert.equal(state.latest.implementationStatus,'PASS');
assert.equal(state.latest.blueprintFinalStatus,'HOLD');
assert.deepEqual(state.requiredRegressionMarkers,markers);
assert.equal(state.latest.evidenceSnapshot.regressionRuntimeSha,runtimeSha);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m30_final_gate_evaluations
      WHERE scope_key='PLATFORM' AND gate_key='G-M30-FINAL'
        AND implementation_status='PASS' AND blueprint_final_status='HOLD') implementation_pass_final_hold,
    (SELECT COUNT(*) FROM aigc_real_project_e2e_attestations
      WHERE decision='APPROVED' AND attestation_mode='HUMAN' AND is_synthetic=FALSE) real_aigc,
    (SELECT COUNT(*) FROM m29_real_loop_attestations
      WHERE decision='APPROVED' AND attestation_mode='HUMAN' AND is_synthetic=FALSE) real_loops,
    (SELECT COUNT(*) FROM platform_release_promotions p JOIN platform_environments e ON e.id=p.target_environment_id
      WHERE e.environment_type='PRODUCTION' AND p.status='PROMOTED'
        AND (p.execution_mode IS NULL OR p.execution_mode<>'HUMAN')) unsafe_prod_promotions,
    (SELECT COUNT(*) FROM platform_restore_rehearsals r JOIN platform_environments e ON e.id=r.target_environment_id
      WHERE e.environment_type='PRODUCTION'
        AND (r.execution_mode<>'HUMAN' OR r.is_synthetic=TRUE)) unsafe_prod_restores`
);
assert.ok(Number(truth.implementation_pass_final_hold)>=1);
assert.equal(Number(truth.real_aigc),0);
assert.equal(Number(truth.real_loops),0);
assert.equal(Number(truth.unsafe_prod_promotions),0);
assert.equal(Number(truth.unsafe_prod_restores),0);

await db.end();
console.log('M30_6_IMPLEMENTATION_FINAL_PASS_AI_NATIVE_2_REAL_FINAL_HOLD');
