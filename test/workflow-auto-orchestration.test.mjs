import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m254-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const agentKey=`AGENT:M254:${suffix}`;
const toolA=`TOOL:M254:A:${suffix}`;
const toolB=`TOOL:M254:B:${suffix}`;
const badTool=`TOOL:M254:BAD:${suffix}`;

for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'M25.4 Workflow Agent',adapterKey:'agent-runtime'},
  {capabilityKey:toolA,capabilityType:'TOOL',displayName:'M25.4 Tool A',adapterKey:'internal-test'},
  {capabilityKey:toolB,capabilityType:'TOOL',displayName:'M25.4 Tool B',adapterKey:'internal-test'},
  {capabilityKey:badTool,capabilityType:'TOOL',displayName:'M25.4 Missing Adapter',adapterKey:'missing-adapter'}
]){
  let r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
let r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'WORKFLOW_OWNER',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));

for(const childCapabilityKey of [toolA,toolB,badTool]){
  r=await request('POST','/api/runtime/agent-capability-grants',{
    agentCapabilityKey:agentKey,childCapabilityKey,requirementMode:'ALLOWED',priority:10
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}
for(const [capabilityKey,bindingMode,priority] of [
  [agentKey,'DEFAULT',1],[toolA,'DEFAULT',2],[toolB,'ALLOWED',3],[badTool,'ALLOWED',99]
]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey,bindingMode,priority
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

// SUCCESS workflow: two stages, both executed automatically.
r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`m254-success-${suffix}`,
  version:'1.0.0',displayName:'M25.4 Success Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const successTemplateId=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${successTemplateId}/milestones`,{
  milestoneKey:'M1_PLAN',displayName:'Plan',sequenceNo:1,acceptance:{gate:'G-PLAN'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const successMilestone1=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${successTemplateId}/milestones`,{
  milestoneKey:'M2_BUILD',displayName:'Build',sequenceNo:2,acceptance:{gate:'G-BUILD'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const successMilestone2=r.body.data.id;

for(const stage of [
  {milestoneTemplateId:successMilestone1,stageKey:'PLAN',displayName:'Plan',sequenceNo:1,gatePolicyKey:'G-PLAN',
   config:{maxRetries:1,onRetryExhausted:'ESCALATE'}},
  {milestoneTemplateId:successMilestone2,stageKey:'BUILD',displayName:'Build',sequenceNo:2,gatePolicyKey:'G-BUILD',
   config:{maxRetries:1,onRetryExhausted:'ESCALATE'}}
]){
  r=await request('POST',`/api/runtime/workflow-templates/${successTemplateId}/stages`,{
    ...stage,defaultAgentCapabilityKey:agentKey
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  const stageId=r.body.data.id;
  const capabilityKey=stage.stageKey==='PLAN'?toolA:toolB;
  r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,{
    requirementKey:'EXECUTE',capabilityType:'TOOL',capabilityKey,
    routingMode:'FIXED',requirementMode:'REQUIRED'
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST',`/api/runtime/workflow-templates/${successTemplateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');

r=await request('POST','/api/runtime/projects',{
  projectKey:`m254-success-project-${suffix}`,name:'M25.4 Success Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:successTemplateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const successProjectId=r.body.data.id;

const sentinel='M254_PRIVATE_SOURCE_BODY_SENTINEL';
const orchestrationBody={
  idempotencyKey:`m254-success-${suffix}`,
  maxStageTransitions:10,
  stageInputs:{
    PLAN:{EXECUTE:{payload:{kind:'plan',source:sentinel}}},
    BUILD:{EXECUTE:{payload:{kind:'build',source:sentinel}}}
  }
};

r=await request(
  'POST',`/api/runtime/projects/${successProjectId}/orchestrations`,
  orchestrationBody,null
);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request(
  'POST',`/api/runtime/projects/${successProjectId}/orchestrations`,
  orchestrationBody
);
assert.equal(r.status,201,JSON.stringify(r.body));
const successSession=r.body.data;
assert.equal(successSession.status,'PASS');
assert.equal(successSession.stageAttempts,2);
assert.equal(successSession.capabilityInvocationCount,2);
assert.equal(successSession.attempts.length,2);
assert.deepEqual(successSession.attempts.map(x=>x.transitionType),['PASS','PASS']);
assert.ok(!JSON.stringify(successSession).includes(sentinel));
const successSessionId=successSession.id;

r=await request(
  'POST',`/api/runtime/projects/${successProjectId}/orchestrations`,
  orchestrationBody
);
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,successSessionId);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/projects/${successProjectId}/lifecycle`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.status,'COMPLETED');
assert.equal(r.body.data.project.currentStageKey,null);
assert.ok(r.body.data.stages.every(x=>x.status==='COMPLETED'));
assert.ok(r.body.data.milestones.every(x=>x.status==='COMPLETED'));

r=await request('GET',`/api/runtime/orchestrations/${successSessionId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.attempts.length,2);

r=await request('GET',`/api/runtime/projects/${successProjectId}/orchestrations`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.id===successSessionId));

// FAILURE workflow: same task is reused for auto retry, then escalates after retry budget.
r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`m254-failure-${suffix}`,
  version:'1.0.0',displayName:'M25.4 Retry Escalation Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureTemplateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${failureTemplateId}/milestones`,{
  milestoneKey:'M1_EXECUTE',displayName:'Execute',sequenceNo:1,acceptance:{gate:'G-EXECUTE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureMilestoneId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${failureTemplateId}/stages`,{
  milestoneTemplateId:failureMilestoneId,stageKey:'EXECUTE',displayName:'Execute',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-EXECUTE',
  config:{maxRetries:1,onFailure:'RETRY',onRetryExhausted:'ESCALATE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureStageId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-stages/${failureStageId}/requirements`,{
  requirementKey:'BROKEN_TOOL',capabilityType:'TOOL',capabilityKey:badTool,
  routingMode:'FIXED',requirementMode:'REQUIRED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${failureTemplateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  projectKey:`m254-failure-project-${suffix}`,name:'M25.4 Failure Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:failureTemplateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureProjectId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${failureProjectId}/orchestrations`,{
  idempotencyKey:`m254-failure-${suffix}`,
  maxStageTransitions:5,
  stageInputs:{EXECUTE:{BROKEN_TOOL:{payload:{kind:'failure'}}}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureSession=r.body.data;
assert.equal(failureSession.status,'BLOCKED');
assert.equal(failureSession.stopReasonCode,'STAGE_ESCALATED');
assert.equal(failureSession.stageAttempts,2);
assert.equal(failureSession.capabilityInvocationCount,2);
assert.equal(failureSession.attempts.length,2);
assert.deepEqual(failureSession.attempts.map(x=>x.transitionType),['RETRY','ESCALATE']);
assert.equal(failureSession.attempts[0].taskId,failureSession.attempts[1].taskId);

r=await request('GET',`/api/runtime/projects/${failureProjectId}/lifecycle`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.status,'BLOCKED');
assert.equal(r.body.data.project.currentStageKey,'EXECUTE');
assert.equal(r.body.data.stages[0].status,'BLOCKED');
assert.equal(r.body.data.stages[0].attemptCount,1);
assert.equal(r.body.data.stages[0].lastTransitionType,'ESCALATE');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

const [[successRun]]=await db.execute(
  `SELECT r.status,COUNT(DISTINCT t.id) AS tasks
     FROM workflow_orchestration_sessions s
     JOIN runs r ON r.id=s.run_id
     LEFT JOIN tasks t ON t.run_id=r.id
    WHERE s.id=? GROUP BY r.status`,
  [successSessionId]
);
assert.equal(successRun.status,'PASS');
assert.equal(Number(successRun.tasks),2);

const [[failureRun]]=await db.execute(
  `SELECT r.status,COUNT(DISTINCT t.id) AS tasks
     FROM workflow_orchestration_sessions s
     JOIN runs r ON r.id=s.run_id
     LEFT JOIN tasks t ON t.run_id=r.id
    WHERE s.id=? GROUP BY r.status`,
  [failureSession.id]
);
assert.equal(failureRun.status,'HOLD');
assert.equal(Number(failureRun.tasks),1);

const [[failureInvocations]]=await db.execute(
  `SELECT COUNT(*) AS count FROM capability_invocations ci
     JOIN workflow_orchestration_sessions s ON s.run_id=ci.run_id
    WHERE s.id=? AND ci.status='FAIL'`,
  [failureSession.id]
);
assert.equal(Number(failureInvocations.count),2);

const [[failureTransitions]]=await db.execute(
  `SELECT COUNT(*) AS count FROM stage_transition_events ste
     JOIN workflow_orchestration_sessions s ON s.run_id=ste.run_id
    WHERE s.id=?`,
  [failureSession.id]
);
assert.equal(Number(failureTransitions.count),2);

const [[sourceLeak]]=await db.execute(
  `SELECT
     (SELECT COUNT(*) FROM workflow_orchestration_sessions
       WHERE id=? AND (
         CAST(input_manifest_json AS CHAR) LIKE ?
         OR CAST(result_json AS CHAR) LIKE ?
       )) +
     (SELECT COUNT(*) FROM tasks t
       JOIN workflow_orchestration_sessions s ON s.run_id=t.run_id
       WHERE s.id=? AND CAST(t.input_json AS CHAR) LIKE ?) AS count`,
  [successSessionId,`%${sentinel}%`,`%${sentinel}%`,successSessionId,`%${sentinel}%`]
);
assert.equal(Number(sourceLeak.count),0);

await db.end();

console.log('G25_4_WORKFLOW_AUTO_ORCHESTRATION_PASS');
