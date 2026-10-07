import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5015';
const token=must('RUNTIME_API_TOKEN');
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
assert.equal(modules.M29_IMPLEMENTATION_FINAL_GATE,'M29 实现最终验收');
assert.equal(modules.M29_REAL_DUAL_DOMAIN_LOOP,'真实双域自闭环实证');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M29-FINAL').displayName,
  'M29 数据 / 评测 / 自动化 / 自闭环最终门禁');

// Structural implementation may PASS in CI, but real Blueprint Exit must remain HOLD.
r=await request('POST','/api/runtime/m29-gates/G-M29-FINAL/evaluate',{
  asOf:'2026-10-07T10:00:00Z'
});
let gate=expect(r,200);
assert.equal(gate.implementationStatus,'PASS',JSON.stringify(gate));
assert.equal(gate.blueprintExitStatus,'HOLD');
assert.ok(gate.implementationCriteria.every(x=>x.status==='PASS'),JSON.stringify(gate.implementationCriteria));
assert.deepEqual(
  [...gate.reasonCodes].sort(),
  ['M29_REAL_AIGC_LOOP_REQUIRED','M29_REAL_PRODUCT_LOOP_REQUIRED']
);
assert.equal(gate.evidenceSnapshot.syntheticOrCiEvidenceCannotSatisfyRealExit,true);

const [chains]=await db.execute(
  `SELECT p.id project_id,p.project_type,c.id closure_id,o.source_object_type,o.source_object_id
     FROM m29_loop_closures c
     JOIN projects p ON p.id=c.project_id
     JOIN m29_loop_executions x ON x.id=c.loop_execution_id
     JOIN m29_decision_candidates d ON d.id=x.decision_candidate_id
     JOIN m29_detected_signals s ON s.id=d.detected_signal_id
     JOIN m29_metric_observations o ON o.id=s.metric_observation_id
     JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
    WHERE c.status='FROZEN' AND x.status='PASS' AND q.status='PASS'
      AND p.project_type IN ('PRODUCT_DEVELOPMENT','AIGC_CONTENT')
    ORDER BY p.project_type,c.closed_at DESC`
);
const product=chains.find(x=>x.project_type==='PRODUCT_DEVELOPMENT');
const aigc=chains.find(x=>x.project_type==='AIGC_CONTENT');
assert.ok(product&&aigc,'Product and AIGC structural loop fixtures required');

const bodyFor=(row,mode,isSynthetic,realExternalOutcome)=>({
  loopClosureId:row.closure_id,attestationMode:mode,decision:'APPROVED',
  attestedByRef:'CI-VALIDATION-ONLY',attestedAt:'2026-10-07T10:01:00Z',isSynthetic,
  sourceResultRef:{sourceObjectType:row.source_object_type,sourceObjectId:row.source_object_id},
  provenance:{source:'CI_STRUCTURAL_FIXTURE',realExternalOutcome},
  evidence:{test:true,structuralOnly:true}
});

// CI can never turn a structural fixture into a real Product loop.
r=await request('POST',`/api/runtime/projects/${product.project_id}/m29-real-loop-attestations`,
  bodyFor(product,'CI',false,true));
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_REAL_LOOP_HUMAN_ATTESTATION_REQUIRED');

// HUMAN label plus synthetic evidence is still not real.
r=await request('POST',`/api/runtime/projects/${aigc.project_id}/m29-real-loop-attestations`,
  bodyFor(aigc,'HUMAN',true,true));
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_REAL_LOOP_HUMAN_ATTESTATION_REQUIRED');

// Even non-synthetic HUMAN input must explicitly attest real external outcome provenance.
r=await request('POST',`/api/runtime/projects/${product.project_id}/m29-real-loop-attestations`,
  bodyFor(product,'HUMAN',false,false));
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_REAL_LOOP_REAL_OUTCOME_PROVENANCE_REQUIRED');

r=await request('GET','/api/runtime/m29-final');
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.gateName,'M29 数据 / 评测 / 自动化 / 自闭环最终门禁');
assert.match(state.frontend.realExitPolicy,/CI\/AUTO/);
assert.equal(state.attestations.length,0);
assert.equal(state.latest.implementationStatus,'PASS');
assert.equal(state.latest.blueprintExitStatus,'HOLD');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_final_gate_evaluations
      WHERE scope_key='PLATFORM' AND gate_key='G-M29-FINAL' AND implementation_status='PASS') implementation_pass,
    (SELECT COUNT(*) FROM m29_real_loop_attestations
      WHERE decision='APPROVED' AND attestation_mode='HUMAN' AND is_synthetic=FALSE) real_attestations`
);
assert.ok(Number(truth.implementation_pass)>=1);
assert.equal(Number(truth.real_attestations),0);

await db.end();
console.log('M29_5_IMPLEMENTATION_FINAL_PASS_REAL_DUAL_DOMAIN_EXIT_HOLD');
