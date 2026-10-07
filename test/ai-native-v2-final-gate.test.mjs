import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5021';
const token=must('RUNTIME_API_TOKEN');
const runtimeSha=must('RUNTIME_COMMIT_SHA').toLowerCase();
const repository=process.env.GITHUB_REPOSITORY||'zhangxiaomeng880-ui/department-registration-backend';
const workflowRunId=process.env.GITHUB_RUN_ID||'local-final-validation';
const workflowName=process.env.GITHUB_WORKFLOW||'Runtime v3.0 M30.6 AI Native 2.0 Final Gate';
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

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AI_NATIVE_V2_FINAL_REGRESSION,'2.0 全量回归凭证');
assert.equal(modules.AI_NATIVE_V2_FINAL_GATE,'AI Native 2.0 最终门禁');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-AI-NATIVE-V2-FINAL').displayName,'AI Native 2.0 最终门禁');

// Incomplete regression coverage must fail closed.
r=await request('POST','/api/runtime/ai-native-v2/final-regression-receipts',{
  provider:'GITHUB_ACTIONS',repositoryFullName:repository,workflowName,workflowRunId:workflowRunId+'-incomplete',
  exactRuntimeSha:runtimeSha,status:'PASS',coveredCriteria:['01','02'],
  testMarkers:['A','B','C','D','E','F'],evidence:{test:true,incomplete:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AI_NATIVE_V2_REGRESSION_COVERAGE_INCOMPLETE');

const coveredCriteria=Array.from({length:22},(_,i)=>String(i+1).padStart(2,'0'));
const testMarkers=[
  'M27_PRODUCT_DEVELOPMENT_IMPLEMENTATION_REGRESSION',
  'M28_AIGC_IMPLEMENTATION_REGRESSION',
  'M29_5_IMPLEMENTATION_FINAL_PASS_REAL_DUAL_DOMAIN_EXIT_HOLD',
  'M30_1_PRIVATE_WORKSPACE_OPS_FOUNDATION_PASS',
  'M30_2_RELEASE_PROMOTION_ROLLBACK_PASS_PRODUCTION_HUMAN_GATE_HOLD',
  'M30_3_ALERT_INCIDENT_RECOVERY_LOOP_PASS',
  'M30_4_RETENTION_BACKUP_RESTORE_PASS_PRODUCTION_RESTORE_HOLD',
  'M30_5_GLOBAL_SEARCH_AUDIT_EVIDENCE_PASS',
  'RAILWAY_RUNTIME_COMPATIBILITY_PASS'
];

r=await request('POST','/api/runtime/ai-native-v2/final-regression-receipts',{
  provider:'GITHUB_ACTIONS',repositoryFullName:repository,workflowName,workflowRunId,
  exactRuntimeSha:runtimeSha,status:'PASS',coveredCriteria,testMarkers,
  recordedAt:'2026-10-07T09:00:00Z',
  evidence:{test:true,scope:'M25-M30 FULL REGRESSION',productionPromotion:false}
});
const receipt=expect(r,201);
assert.equal(receipt.status,'PASS');
assert.equal(receipt.exactRuntimeSha,runtimeSha);
assert.equal(receipt.coveredCriteria.length,22);

r=await request('POST','/api/runtime/ai-native-v2/gates/G-AI-NATIVE-V2-FINAL/evaluate',{
  candidateRuntimeSha:runtimeSha,asOf:'2026-10-07T09:01:00Z'
});
const finalGate=expect(r,200);
assert.equal(finalGate.implementationStatus,'PASS',JSON.stringify(finalGate));
assert.equal(finalGate.blueprintFinalStatus,'HOLD',JSON.stringify(finalGate));
assert.equal(finalGate.criteria.length,22);
assert.ok(finalGate.criteria.every(x=>x.implementationStatus==='PASS'),JSON.stringify(finalGate.criteria));
const criterion19=finalGate.criteria.find(x=>x.number==='19');
assert.ok(criterion19);
assert.equal(criterion19.implementationStatus,'PASS');
assert.equal(criterion19.blueprintStatus,'HOLD');
assert.equal(finalGate.evidenceSnapshot.ciOrSyntheticCannotSatisfyCriterion19,true);
assert.equal(finalGate.evidenceSnapshot.allowedFinalFrozen,false);
assert.equal(finalGate.evidenceSnapshot.m30AllPass,true);
assert.equal(finalGate.evidenceSnapshot.m29ImplementationStatus,'PASS');
assert.ok(finalGate.reasonCodes.includes('AI_NATIVE_V2_REAL_AIGC_E2E_REQUIRED'));
assert.ok(finalGate.reasonCodes.includes('AI_NATIVE_V2_REAL_PRODUCT_SELF_LOOP_REQUIRED'));
assert.ok(finalGate.reasonCodes.includes('AI_NATIVE_V2_REAL_AIGC_SELF_LOOP_REQUIRED'));

r=await request('GET','/api/runtime/ai-native-v2/final');
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.title,'AI Native 2.0 最终门禁');
assert.match(state.frontend.policy,/CI\/fixture\/synthetic/);
assert.equal(state.latest.implementationStatus,'PASS');
assert.equal(state.latest.blueprintFinalStatus,'HOLD');
assert.equal(state.latest.evidenceSnapshot.allowedFinalFrozen,false);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM ai_native_v2_final_regression_receipts
      WHERE exact_runtime_sha=? AND status='PASS') regression_pass,
    (SELECT COUNT(*) FROM ai_native_v2_final_gate_evaluations
      WHERE candidate_runtime_sha=? AND implementation_status='PASS' AND blueprint_final_status='HOLD') final_hold`,
  [runtimeSha,runtimeSha]
);
assert.ok(Number(truth.regression_pass)>=1);
assert.ok(Number(truth.final_hold)>=1);

await db.end();
console.log('M30_6_AI_NATIVE_V2_IMPLEMENTATION_FINAL_PASS_BLUEPRINT_FINAL_HOLD');
