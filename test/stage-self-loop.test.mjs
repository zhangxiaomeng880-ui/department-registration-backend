import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m253-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const agentKey=`AGENT:M253:${suffix}`;

let r=await request('POST','/api/runtime/capabilities',{
  capabilityKey:agentKey,capabilityType:'AGENT',displayName:'M25.3 Stage Agent',adapterKey:'agent-runtime'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'STAGE_OWNER',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/project-type-capabilities',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey:agentKey,bindingMode:'DEFAULT',priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',
  templateKey:`m253-workflow-${suffix}`,version:'1.0.0',displayName:'M25.3 Self-loop Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M1_DISCOVERY',displayName:'Discovery Milestone',sequenceNo:1,acceptance:{gate:'G-DISCOVERY'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestone1=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M2_DELIVERY',displayName:'Delivery Milestone',sequenceNo:2,acceptance:{gate:'G-BUILD'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestone2=r.body.data.id;

for(const stage of [
  {milestoneTemplateId:milestone1,stageKey:'DISCOVERY',displayName:'Discovery',sequenceNo:1,gatePolicyKey:'G-DISCOVERY',config:{maxRetries:2}},
  {milestoneTemplateId:milestone2,stageKey:'DESIGN',displayName:'Design',sequenceNo:2,gatePolicyKey:'G-DESIGN',config:{maxRetries:2}},
  {milestoneTemplateId:milestone2,stageKey:'BUILD',displayName:'Build',sequenceNo:3,gatePolicyKey:'G-BUILD',config:{maxRetries:1}}
]){
  r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
    ...stage,defaultAgentCapabilityKey:agentKey
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');

r=await request('POST','/api/runtime/projects',{
  projectKey:`m253-project-${suffix}`,name:'M25.3 Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.lifecycle.project.currentStageKey,'DISCOVERY');

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',status:'RUNNING',triggerSource:'USER',
  workflowVersion:'1.0.0',routerVersion:'stage-self-loop-v1',
  runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;

const createTask=async(stageKey,key,seq)=>{
  const response=await request('POST','/api/runtime/tasks',{
    runId,stageKey,taskKey:key,taskType:'STAGE_EXECUTION',sequenceNo:seq,input:{stageKey}
  });
  assert.equal(response.status,201,JSON.stringify(response.body));
  return response.body.data.id;
};
const transition=async(body,token=platformToken)=>request(
  'POST',`/api/runtime/projects/${projectId}/stage-transitions`,body,token
);

let discoveryTaskId=await createTask('DISCOVERY',`discovery-${suffix}`,1);

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'G-DISCOVERY',gateStatus:'FAIL',idempotencyKey:`unauth-${suffix}`,
  blockingReason:'needs another pass'
},null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'WRONG-GATE',gateStatus:'FAIL',idempotencyKey:`bad-gate-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'STAGE_GATE_POLICY_MISMATCH');

const retryKey1=`retry-1-${suffix}`;
r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'G-DISCOVERY',gateStatus:'FAIL',idempotencyKey:retryKey1,
  criteria:{quality:'not-ready'},evidence:{qa:'discovery-fail-1'},
  blockingReason:'Discovery evidence incomplete'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.transitionType,'RETRY');
assert.equal(r.body.data.idempotent,false);
const retryEventId=r.body.data.id;
assert.equal(r.body.data.lifecycle.project.current_stage_key,'DISCOVERY');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DISCOVERY').attemptCount,1);

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'G-DISCOVERY',gateStatus:'FAIL',idempotencyKey:retryKey1,
  criteria:{quality:'not-ready'},evidence:{qa:'discovery-fail-1'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,retryEventId);
assert.equal(r.body.data.idempotent,true);

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'G-DISCOVERY',gateStatus:'HOLD',idempotencyKey:`retry-2-${suffix}`,
  evidence:{qa:'discovery-hold-2'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DISCOVERY').attemptCount,2);

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'RETRY',
  gateKey:'G-DISCOVERY',gateStatus:'FAIL',idempotencyKey:`retry-3-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'STAGE_RETRY_LIMIT_EXCEEDED');

r=await transition({
  runId,taskId:discoveryTaskId,stageKey:'DISCOVERY',transitionType:'PASS',
  gateKey:'G-DISCOVERY',gateStatus:'PASS',idempotencyKey:`pass-discovery-${suffix}`,
  evidence:{qa:'discovery-pass'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.transitionType,'PASS');
assert.equal(r.body.data.toStageKey,'DESIGN');
assert.equal(r.body.data.lifecycle.project.current_stage_key,'DESIGN');
assert.equal(r.body.data.lifecycle.milestones.find(x=>x.milestoneKey==='M1_DISCOVERY').status,'COMPLETED');
assert.equal(r.body.data.lifecycle.milestones.find(x=>x.milestoneKey==='M2_DELIVERY').status,'ACTIVE');

let designTaskId=await createTask('DESIGN',`design-1-${suffix}`,2);
r=await transition({
  runId,taskId:designTaskId,stageKey:'DESIGN',transitionType:'ESCALATE',
  gateKey:'G-DESIGN',gateStatus:'FAIL',idempotencyKey:`escalate-design-${suffix}`,
  blockingReason:'Human approval required',evidence:{qa:'design-blocker'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.transitionType,'ESCALATE');
assert.equal(r.body.data.lifecycle.project.status,'BLOCKED');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DESIGN').status,'BLOCKED');

r=await transition({
  runId,taskId:designTaskId,stageKey:'DESIGN',transitionType:'RETRY',
  gateKey:'G-DESIGN',gateStatus:'HOLD',idempotencyKey:`resume-design-${suffix}`,
  evidence:{approval:'granted'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.lifecycle.project.status,'ACTIVE');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DESIGN').status,'ACTIVE');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DESIGN').attemptCount,1);

r=await transition({
  runId,taskId:designTaskId,stageKey:'DESIGN',transitionType:'PASS',
  gateKey:'G-DESIGN',gateStatus:'PASS',idempotencyKey:`pass-design-1-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.toStageKey,'BUILD');

let buildTaskId=await createTask('BUILD',`build-1-${suffix}`,3);
r=await transition({
  runId,taskId:buildTaskId,stageKey:'BUILD',transitionType:'ROLLBACK',
  targetStageKey:'DESIGN',gateKey:'G-BUILD',gateStatus:'FAIL',
  idempotencyKey:`rollback-build-${suffix}`,blockingReason:'Design contract needs repair'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.transitionType,'ROLLBACK');
assert.equal(r.body.data.toStageKey,'DESIGN');
assert.equal(r.body.data.lifecycle.project.current_stage_key,'DESIGN');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='DESIGN').status,'ACTIVE');
assert.equal(r.body.data.lifecycle.stages.find(x=>x.stageKey==='BUILD').status,'PENDING');
assert.equal(r.body.data.lifecycle.milestones.find(x=>x.milestoneKey==='M2_DELIVERY').status,'ACTIVE');

designTaskId=await createTask('DESIGN',`design-2-${suffix}`,4);
r=await transition({
  runId,taskId:designTaskId,stageKey:'DESIGN',transitionType:'PASS',
  gateKey:'G-DESIGN',gateStatus:'PASS',idempotencyKey:`pass-design-2-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.toStageKey,'BUILD');

buildTaskId=await createTask('BUILD',`build-2-${suffix}`,5);
r=await transition({
  runId,taskId:buildTaskId,stageKey:'BUILD',transitionType:'PASS',
  gateKey:'G-BUILD',gateStatus:'PASS',idempotencyKey:`pass-build-${suffix}`,
  evidence:{release:'validated'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.toStageKey,null);
assert.equal(r.body.data.lifecycle.project.status,'COMPLETED');
assert.equal(r.body.data.lifecycle.project.current_stage_key,null);
assert.ok(r.body.data.lifecycle.milestones.every(x=>x.status==='COMPLETED'));
assert.ok(r.body.data.lifecycle.stages.every(x=>x.status==='COMPLETED'));

r=await request('GET',`/api/runtime/projects/${projectId}/lifecycle`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.project.status,'COMPLETED');
assert.equal(r.body.data.project.currentStageKey,null);
assert.equal(r.body.data.stages.find(x=>x.stageKey==='DISCOVERY').attemptCount,2);
assert.equal(r.body.data.stages.find(x=>x.stageKey==='DESIGN').lastTransitionType,'PASS');
assert.equal(r.body.data.stages.find(x=>x.stageKey==='BUILD').lastTransitionType,'PASS');

r=await request('GET',`/api/runtime/projects/${projectId}/stage-transitions?runId=${runId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,9,JSON.stringify(r.body.data));
assert.deepEqual(
  r.body.data.map(x=>x.transitionType),
  ['RETRY','RETRY','PASS','ESCALATE','RETRY','PASS','ROLLBACK','PASS','PASS']
);

r=await request('GET',`/api/runtime/stage-transitions/${retryEventId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.id,retryEventId);

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[eventCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM stage_transition_events WHERE project_id=?',[projectId]
);
assert.equal(Number(eventCount.count),9);
const [[gateCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM gate_results WHERE run_id=?',[runId]
);
assert.equal(Number(gateCount.count),9);
const [[checkpointCount]]=await db.execute(
  "SELECT COUNT(*) AS count FROM checkpoints WHERE run_id=? AND checkpoint_type='STAGE_TRANSITION'",[runId]
);
assert.equal(Number(checkpointCount.count),9);
const [[currentSnapshots]]=await db.execute(
  'SELECT COUNT(*) AS count FROM stage_snapshots WHERE project_id=? AND is_current=TRUE',[projectId]
);
assert.equal(Number(currentSnapshots.count),3);
const [[runState]]=await db.execute(
  'SELECT status,last_checkpoint_at FROM runs WHERE id=?',[runId]
);
assert.equal(runState.status,'PASS');
assert.ok(runState.last_checkpoint_at);
const [[rolledBackTask]]=await db.execute(
  'SELECT status,error_code FROM tasks WHERE id=?',[buildTaskId===null?'':buildTaskId]
);
// buildTaskId now refers to the final successful BUILD task; verify the first build task separately.
const [buildTasks]=await db.execute(
  "SELECT task_key,status,error_code FROM tasks WHERE run_id=? AND stage_key='BUILD' ORDER BY sequence_no",[runId]
);
assert.equal(buildTasks[0].status,'CANCELLED');
assert.equal(buildTasks[0].error_code,'STAGE_ROLLBACK');
assert.equal(buildTasks[1].status,'PASS');
await db.end();

console.log('G25_3_STAGE_SELF_LOOP_PASS');
