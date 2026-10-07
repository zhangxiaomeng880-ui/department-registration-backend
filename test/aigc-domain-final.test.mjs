import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5010';
const token=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[review]]=await db.execute(
  `SELECT r.*,a.id archive_id
     FROM aigc_review_cycles r
     JOIN aigc_archive_packages a ON a.review_cycle_id=r.id
    WHERE r.status='FROZEN' AND r.is_current=TRUE
      AND a.status='FROZEN' AND a.is_current=TRUE
    ORDER BY r.frozen_at DESC,r.created_at DESC LIMIT 1`
);
assert.ok(review,'M28.16 frozen Review + Archive required');
const projectId=review.project_id;

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_DOMAIN_FINAL_GATE,'AIGC 领域最终验收');
assert.equal(modules.AIGC_REAL_PROJECT_E2E,'真实项目 E2E 实证');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-DOMAIN-FINAL').displayName,'AIGC 领域最终门禁');

// Final Gate must validate the entire structural lifecycle, but CI must NOT satisfy criterion 14.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-DOMAIN-FINAL/evaluate`,{
  asOf:'2026-10-07T08:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD',JSON.stringify(r.body));
assert.equal(r.body.data.criteria.length,14);
const byNumber=Object.fromEntries(r.body.data.criteria.map(x=>[x.number,x]));
for(let i=1;i<=13;i++){
  const key=String(i).padStart(2,'0');
  assert.equal(byNumber[key].status,'PASS',`criterion ${key} failed: ${JSON.stringify(byNumber[key])}`);
}
assert.equal(byNumber['14'].status,'HOLD');
assert.deepEqual(r.body.data.reasonCodes,['AIGC_REAL_PROJECT_E2E_REQUIRED']);
assert.equal(r.body.data.evidenceSnapshot.criteriaPassed,13);
assert.equal(r.body.data.evidenceSnapshot.criteriaTotal,14);
assert.equal(r.body.data.evidenceSnapshot.realProjectE2EAttested,false);
assert.equal(r.body.data.evidenceSnapshot.syntheticEvidenceCannotSatisfyCriterion14,true);

// CI/AUTO attestation can never turn a structural fixture into a real project.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-real-project-e2e-attestations`,{
  reviewCycleId:review.id,archivePackageId:review.archive_id,
  attestationMode:'CI',decision:'APPROVED',attestedByRef:'github-actions',
  attestedAt:'2026-10-07T08:01:00Z',isSynthetic:false,
  scope:{from:'Discovery',to:'Performance Review'},
  provenance:{source:'CI',realExternalProject:false},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_REAL_PROJECT_HUMAN_ATTESTATION_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-real-project-e2e-attestations`,{
  reviewCycleId:review.id,archivePackageId:review.archive_id,
  attestationMode:'HUMAN',decision:'APPROVED',attestedByRef:'CI-human-fixture',
  attestedAt:'2026-10-07T08:02:00Z',isSynthetic:true,
  scope:{from:'Discovery',to:'Performance Review'},
  provenance:{source:'CI_STRUCTURAL_FIXTURE',realExternalProject:false},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_REAL_PROJECT_HUMAN_ATTESTATION_REQUIRED');

// The final state exposes the unresolved real-world dependency honestly.
r=await request('GET',`/api/runtime/projects/${projectId}/aigc-domain-final`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'AIGC 领域最终门禁');
assert.match(r.body.data.frontend.realProjectPolicy,/HUMAN/);
assert.match(r.body.data.frontend.realProjectPolicy,/CI/);
assert.equal(r.body.data.attestations.length,0);
assert.ok(r.body.data.evaluations.length>=1);
assert.equal(r.body.data.evaluations.at(-1).status,'HOLD');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_domain_final_gate_evaluations
      WHERE project_id=? AND gate_key='G-AIGC-DOMAIN-FINAL' AND status='HOLD') hold_count,
    (SELECT COUNT(*) FROM aigc_real_project_e2e_attestations
      WHERE project_id=? AND decision='APPROVED' AND attestation_mode='HUMAN' AND is_synthetic=FALSE) real_approved`,
  [projectId,projectId]
);
assert.ok(Number(truth.hold_count)>=1);
assert.equal(Number(truth.real_approved),0);

await db.end();
console.log('M28_17_AIGC_DOMAIN_FINAL_GATE_STRUCTURAL_PASS_REAL_E2E_HOLD');
