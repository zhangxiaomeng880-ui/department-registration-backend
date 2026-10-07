import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5012';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>{
  assert.equal(r.status,status,JSON.stringify(r.body));
  return r.body.data;
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[aigcSignal]]=await db.execute(
  `SELECT s.*,p.project_type,r.decision_policy_json
     FROM m29_detected_signals s
     JOIN projects p ON p.id=s.project_id
     JOIN m29_detection_rules r ON r.id=s.detection_rule_id
    WHERE p.project_type='AIGC_CONTENT'
    ORDER BY s.detected_at DESC,s.created_at DESC LIMIT 1`
);
assert.ok(aigcSignal,'M29.1 AIGC detected signal is required');

const [[productSignal]]=await db.execute(
  `SELECT s.*,p.project_type,r.decision_policy_json
     FROM m29_detected_signals s
     JOIN projects p ON p.id=s.project_id
     JOIN m29_detection_rules r ON r.id=s.detection_rule_id
    WHERE p.project_type='PRODUCT_DEVELOPMENT'
    ORDER BY s.detected_at DESC,s.created_at DESC LIMIT 1`
);
assert.ok(productSignal,'M29.1 Product detected signal is required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M29_DECISION_CANDIDATE,'决策候选');
assert.equal(modules.M29_DECISION_POLICY,'决策策略');
assert.equal(modules.M29_HUMAN_DECISION,'人工决策');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(
  r.body.data.find(x=>x.stableKey==='G-M29-DECISION').displayName,
  '决策 / 策略 / 人工门禁'
);

// Gate must HOLD before detected signals have governed decisions.
for(const projectId of [aigcSignal.project_id,productSignal.project_id]){
  r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-DECISION/evaluate`,{
    asOf:'2026-10-07T08:20:00Z'
  });
  const data=expect(r,200);
  assert.equal(data.status,'HOLD',JSON.stringify(r.body));
  assert.ok(data.reasonCodes.includes('M29_DECISION_CANDIDATE_REQUIRED'));
}

// AIGC signal proposes a next-round capability action. M29.1 policy has automaticAction=false,
// therefore M29.2 must fail closed into explicit Human Gate.
r=await request('POST',`/api/runtime/projects/${aigcSignal.project_id}/m29-decision-candidates`,{
  detectedSignalId:aigcSignal.id,
  decisionKey:'M292-AIGC-NEXT-ROUND',
  outcome:'ACTION',
  targetType:'CAPABILITY',
  actionSpec:{
    targetKey:'AIGC_NEXT_ROUND_EXPERIMENT',
    inputContract:{sourceSignalId:aigcSignal.id},
    externalSideEffect:false,
    irreversible:false
  },
  rationale:{reason:'AIGC completion signal requires a controlled next-round experiment candidate'},
  evidence:{source:'M29.2 structural decision validation'}
});
const aigcDecision=expect(r,201);
assert.equal(aigcDecision.status,'APPROVAL_REQUIRED');
assert.equal(aigcDecision.humanGateRequired,true);
assert.equal(aigcDecision.executionReady,false);
assert.equal(aigcDecision.executionDispatched,false);

r=await request('POST',`/api/runtime/projects/${aigcSignal.project_id}/m29-gates/G-M29-DECISION/evaluate`,{
  asOf:'2026-10-07T08:21:00Z'
});
let gate=expect(r,200);
assert.equal(gate.status,'HOLD');
assert.ok(gate.reasonCodes.includes('M29_HUMAN_DECISION_PENDING'));
assert.equal(gate.evidenceSnapshot.executionDispatched,false);

// Fake AUTO approval is forbidden: human approval evidence must be explicit.
r=await request('POST',`/api/runtime/m29-decision-candidates/${aigcDecision.id}/decide`,{
  decision:{mode:'AUTO',decision:'APPROVED',decidedByRef:'ci',decidedAt:'2026-10-07T08:22:00Z'},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_HUMAN_DECISION_REQUIRED');

r=await request('POST',`/api/runtime/m29-decision-candidates/${aigcDecision.id}/decide`,{
  decision:{
    mode:'HUMAN',
    decision:'APPROVED',
    decidedByRef:'M292_HUMAN_GATE_TEST_APPROVER',
    decidedAt:'2026-10-07T08:22:30Z'
  },
  evidence:{test:true,externalSideEffect:false}
});
const approved=expect(r,200);
assert.equal(approved.status,'APPROVED');
assert.equal(approved.executionReady,true);
assert.equal(approved.executionDispatched,false);

// Product signal is intentionally routed to backlog. No execution happens in M29.2.
r=await request('POST',`/api/runtime/projects/${productSignal.project_id}/m29-decision-candidates`,{
  detectedSignalId:productSignal.id,
  decisionKey:'M292-PRODUCT-BACKLOG',
  outcome:'BACKLOG',
  targetType:'BACKLOG',
  actionSpec:{
    targetKey:'PRODUCT_IMPROVEMENT_BACKLOG',
    sourceSignalId:productSignal.id,
    externalSideEffect:false,
    irreversible:false
  },
  riskLevel:'LOW',
  rationale:{reason:'Convert detected result into next-round backlog input without direct execution'},
  evidence:{source:'M29.2 product decision validation'}
});
const productDecision=expect(r,201);
assert.equal(productDecision.status,'RESOLVED');
assert.equal(productDecision.humanGateRequired,false);
assert.equal(productDecision.executionReady,false);
assert.equal(productDecision.executionDispatched,false);

// Both Product and AIGC decision layers are now resolved and ready for the Execution layer.
for(const projectId of [aigcSignal.project_id,productSignal.project_id]){
  r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-DECISION/evaluate`,{
    asOf:'2026-10-07T08:23:00Z'
  });
  gate=expect(r,200);
  assert.equal(gate.status,'PASS',JSON.stringify(r.body));
  assert.equal(gate.evidenceSnapshot.readyForExecutionLayer,true);
  assert.equal(gate.evidenceSnapshot.executionDispatched,false);
  assert.equal(gate.evidenceSnapshot.detectedSignalCount,gate.evidenceSnapshot.coveredSignalCount);
}

r=await request('GET',`/api/runtime/projects/${aigcSignal.project_id}/m29-decision-policy`);
let state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.gateName,'决策 / 策略 / 人工门禁');
assert.match(state.frontend.principle,/不执行任何动作/);
assert.equal(state.decisions.length,1);
assert.equal(state.decisions[0].status,'APPROVED');
assert.equal(state.decisions[0].executionReady,true);
assert.equal(state.decisions[0].executionDispatched,false);

r=await request('GET',`/api/runtime/projects/${productSignal.project_id}/m29-decision-policy`);
state=expect(r,200);
assert.equal(state.decisions.length,1);
assert.equal(state.decisions[0].outcome,'BACKLOG');
assert.equal(state.decisions[0].status,'RESOLVED');
assert.equal(state.decisions[0].executionDispatched,false);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_decision_candidates
      WHERE decision_key IN ('M292-AIGC-NEXT-ROUND','M292-PRODUCT-BACKLOG')) decisions,
    (SELECT COUNT(*) FROM m29_decision_candidates
      WHERE decision_key='M292-AIGC-NEXT-ROUND' AND status='APPROVED'
        AND human_gate_required=TRUE AND human_decision_json IS NOT NULL) human_approved,
    (SELECT COUNT(*) FROM m29_decision_candidates
      WHERE decision_key='M292-PRODUCT-BACKLOG' AND status='RESOLVED'
        AND outcome='BACKLOG') backlog_resolved,
    (SELECT COUNT(DISTINCT project_id) FROM m29_decision_gate_evaluations
      WHERE gate_key='G-M29-DECISION' AND status='PASS') gate_projects`
);
assert.equal(Number(truth.decisions),2);
assert.equal(Number(truth.human_approved),1);
assert.equal(Number(truth.backlog_resolved),1);
assert.equal(Number(truth.gate_projects),2);

await db.end();
console.log('M29_2_DECISION_POLICY_PASS');
