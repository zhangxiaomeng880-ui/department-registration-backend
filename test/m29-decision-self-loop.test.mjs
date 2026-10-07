import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5012';
const token=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>assert.equal(r.status,status,JSON.stringify(r.body));
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[aigcSignal]]=await db.execute(
  `SELECT s.* FROM m29_detected_signals s JOIN projects p ON p.id=s.project_id
    WHERE p.project_type='AIGC_CONTENT' AND s.status='DETECTED'
    ORDER BY s.detected_at DESC,s.created_at DESC LIMIT 1`
);
assert.ok(aigcSignal,'AIGC M29.1 detected signal required');
const [[productSignal]]=await db.execute(
  `SELECT s.* FROM m29_detected_signals s JOIN projects p ON p.id=s.project_id
    WHERE p.project_type='PRODUCT_DEVELOPMENT' AND s.status='DETECTED'
    ORDER BY s.detected_at DESC,s.created_at DESC LIMIT 1`
);
assert.ok(productSignal,'Product M29.1 detected signal required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M29_DECISION_LOOP,'决策闭环');
assert.equal(modules.M29_LOOP_EXECUTION,'闭环执行');
assert.equal(modules.M29_LOOP_CLOSURE,'闭环回写');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M29-SELF-LOOP').displayName,'决策 / 执行 / 闭环门禁');

// Product: low-risk signal can be converted into a reversible next-round backlog item.
r=await request('POST',`/api/runtime/projects/${productSignal.project_id}/m29-decision-candidates`,{
  detectedSignalId:productSignal.id,candidateKey:'M292-PRODUCT-LOOP-001',
  title:'产品指标达到阈值后的下一轮验证',
  actionType:'BACKLOG',
  proposedAction:{workItemType:'EXPERIMENT',title:'验证产品主指标是否可持续',
    acceptanceCriteria:['下一轮继续采集结果指标并比较变化']},
  rationale:'把结果数据转成可执行的下一轮实验，不直接让数据替代产品决策。',
  riskLevel:'LOW',evidence:{test:true,source:'M29.1'}
});
expect(r,201);
const productCandidate=r.body.data;
assert.equal(productCandidate.requiresHumanApproval,false);
assert.equal(productCandidate.status,'READY');

r=await request('POST',`/api/runtime/m29-decision-candidates/${productCandidate.id}/execute`,{
  evidence:{test:true,decision:'reversible-backlog'}
});
expect(r,200);
const productExecution=r.body.data;
assert.equal(productExecution.status,'PASS');
assert.ok(productExecution.projectDecisionId);
assert.ok(productExecution.workItemId);

r=await request('POST',`/api/runtime/m29-loop-executions/${productExecution.id}/close`,{
  closureKey:'M292-PRODUCT-CLOSE-001',
  outcome:{type:'NEXT_ROUND_CREATED',sourceSignalId:productSignal.id},
  nextRound:{type:'WORK_ITEM',id:productExecution.workItemId,goal:'验证结果是否稳定'},
  evidence:{test:true}
});
expect(r,201);
assert.equal(r.body.data.status,'FROZEN');
assert.ok(r.body.data.backlogRefs.includes(productExecution.workItemId));

r=await request('POST',`/api/runtime/projects/${productSignal.project_id}/m29-gates/G-M29-SELF-LOOP/evaluate`,{
  asOf:'2026-10-07T09:00:00Z'
});
expect(r,200);
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.closedBacklogLoopCount,1);

// AIGC: explicit Human Gate must block execution until an approval decision exists.
r=await request('POST',`/api/runtime/projects/${aigcSignal.project_id}/m29-decision-candidates`,{
  detectedSignalId:aigcSignal.id,candidateKey:'M292-AIGC-LOOP-001',
  title:'AIGC 完播率信号进入下一轮内容实验',
  actionType:'BACKLOG',
  proposedAction:{workItemType:'EXPERIMENT',title:'下一轮 AIGC 完播率实验',
    acceptanceCriteria:['保持 Story Rule 不自动变化','只验证内容/分发变量']},
  rationale:'表现信号只形成实验输入；涉及创意判断时保留人工门禁。',
  riskLevel:'MEDIUM',requiresHumanApproval:true,
  evidence:{test:true,source:'M29.1'}
});
expect(r,201);
const aigcCandidate=r.body.data;
assert.equal(aigcCandidate.status,'PENDING_APPROVAL');
assert.ok(aigcCandidate.approvalRequestId);

r=await request('POST',`/api/runtime/m29-decision-candidates/${aigcCandidate.id}/execute`,{
  evidence:{test:true}
});
expect(r,409);
assert.equal(r.body.error,'M29_HUMAN_APPROVAL_REQUIRED');

r=await request('POST',`/api/runtime/approval-requests/${aigcCandidate.approvalRequestId}/decisions`,{
  decision:'APPROVE',reason:'CI validates the human-gate path only',
  evidence:{test:true,syntheticApproval:true}
});
expect(r,200);
assert.equal(r.body.data.status,'APPROVED');

r=await request('POST',`/api/runtime/m29-decision-candidates/${aigcCandidate.id}/execute`,{
  evidence:{test:true,afterApproval:true}
});
expect(r,200);
const aigcExecution=r.body.data;
assert.equal(aigcExecution.status,'PASS');
assert.ok(aigcExecution.workItemId);

r=await request('POST',`/api/runtime/m29-loop-executions/${aigcExecution.id}/close`,{
  closureKey:'M292-AIGC-CLOSE-001',
  outcome:{type:'NEXT_ROUND_CREATED',storyRuleChanged:false},
  nextRound:{type:'WORK_ITEM',id:aigcExecution.workItemId,scope:'CONTENT_EXPERIMENT'},
  knowledgeRefs:[{type:'AIGC_REVIEW_POLICY',ref:'Story Rule changes still require M28.16 Human Gate'}],
  evidence:{test:true}
});
expect(r,201);

r=await request('POST',`/api/runtime/projects/${aigcSignal.project_id}/m29-gates/G-M29-SELF-LOOP/evaluate`,{
  asOf:'2026-10-07T09:00:00Z'
});
expect(r,200);
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.pendingHumanApprovalCount,0);

for(const projectId of [productSignal.project_id,aigcSignal.project_id]){
  r=await request('GET',`/api/runtime/projects/${projectId}/m29-self-loop`);
  expect(r,200);
  assert.equal(r.body.data.frontend.language,'zh-CN');
  assert.equal(r.body.data.frontend.gateName,'决策 / 执行 / 闭环门禁');
  assert.ok(r.body.data.decisionCandidates.length>=1);
  assert.ok(r.body.data.executions.length>=1);
  assert.ok(r.body.data.closures.length>=1);
}

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_loop_closures WHERE status='FROZEN') closures,
    (SELECT COUNT(DISTINCT p.project_type)
       FROM m29_loop_closures c JOIN projects p ON p.id=c.project_id
      WHERE p.project_type IN ('PRODUCT_DEVELOPMENT','AIGC_CONTENT')) domain_types,
    (SELECT COUNT(*) FROM m29_loop_executions WHERE project_decision_id IS NULL) missing_decision_lineage`
);
assert.ok(Number(truth.closures)>=2);
assert.equal(Number(truth.domain_types),2);
assert.equal(Number(truth.missing_decision_lineage),0);

await db.end();
console.log('M29_2_DECISION_EXECUTION_SELF_LOOP_PASS');
