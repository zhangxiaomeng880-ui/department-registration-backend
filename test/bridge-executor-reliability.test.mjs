import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const must=(name)=>{
  const value=process.env[name];
  if(!value) throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=must('RUNTIME_API_TOKEN');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
let r=await request('POST','/api/runtime/plans',{
  planKey:`M284_PLAN_${suffix}`,name:'M28.5 Bridge Executor Plan'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m285-${suffix}`,name:'M28.5 Tenant',planKey:`M284_PLAN_${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'Main'});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'AIGC_CONTENT',templateKey:`m285-bridge-${suffix}`,version:'1.0.0',
  displayName:'M28.5 Bridge Validation'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'AG-M7',displayName:'内容派生',sequenceNo:1,acceptance:{gate:'G-AIGC-DISTRIBUTION-PACKAGE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestoneId,stageKey:'AIGC_11_DERIVATION',
  displayName:'内容派生 / 本地化 / 平台适配',sequenceNo:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m285-novel-${suffix}`,name:'你好，那年夏天',
  projectType:'AIGC_CONTENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

const createExecutor=async(roleKey,label)=>{
  let x=await request('POST','/api/runtime/identities',{
    identityKey:`m285-${label}-${suffix}`,displayName:`M28.5 ${label}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const identityId=x.body.data.id;
  x=await request('POST','/api/runtime/workspace-memberships',{workspaceId,identityId,roleKey});
  assert.equal(x.status,201,JSON.stringify(x.body));
  x=await request('POST','/api/runtime/api-credentials',{
    identityId,tenantId,workspaceId,name:`M28.5 ${label} credential`,
    ...(roleKey==='OPERATOR'?{allowedPermissions:['bridge:read','bridge:execute']}: {})
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  return {identityId,credentialId:x.body.data.id,token:x.body.data.token};
};
const executor1=await createExecutor('OPERATOR','executor-1');
const executor2=await createExecutor('OPERATOR','executor-2');
const viewer=await createExecutor('VIEWER','viewer');

r=await request('POST','/api/runtime/triggers/TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN/fire',{
  projectId,allowDisabledShadow:true,
  scheduledFireTime:'2026-10-08T09:00:00.000000',
  triggerReason:'M28.5_BRIDGE_RELIABILITY'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const fire1=r.body.data;
assert.equal(fire1.status,'DISPATCH_PENDING');

r=await request('GET',`/api/runtime/bridge-dispatches?projectId=${projectId}`,undefined,viewer.token);
assert.equal(r.status,403,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/bridge-dispatches?projectId=${projectId}`,undefined,executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));
const dispatch1=r.body.data.find(x=>x.triggerFireId===fire1.id);
assert.ok(dispatch1,JSON.stringify(r.body));
assert.equal(dispatch1.status,'PENDING');

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/claim`,{leaseSeconds:120},executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'CLAIMED');
assert.equal(r.body.data.attemptCount,1);
assert.equal(r.body.data.claimedByCredentialId,executor1.credentialId);

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/claim`,{leaseSeconds:120},executor2.token);
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'BRIDGE_DISPATCH_LEASE_HELD');

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/renew`,{leaseSeconds:180},executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/fail`,{
  retryable:true,retryAfterSeconds:0,errorCode:'TEMP_LIBRARY_TOOL_FAILURE',errorMessage:'temporary'
},executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RETRY');

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/claim`,{leaseSeconds:120},executor2.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.attemptCount,2);

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/complete`,{
  output:{
    status:'PASS',updatedChapters:['NOVEL_001'],reusedPassChapters:[],gateStatus:'PASS',
    checkpointPath:'/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md',
    resumePoint:'NOVEL_002',blockingReason:null,chapterText:'DO_NOT_PERSIST_PROSE'
  },
  evidence:{executor:'CHATGPT_LIBRARY_BRIDGE'}
},executor2.token);
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'BRIDGE_SOURCE_BODY_NOT_ALLOWED');

const completion={
  output:{
    status:'PASS',updatedChapters:['NOVEL_001'],reusedPassChapters:[],gateStatus:'PASS',
    checkpointPath:'/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md',
    resumePoint:'NOVEL_002',blockingReason:null
  },
  evidence:{executor:'CHATGPT_LIBRARY_BRIDGE',sourceFingerprint:'sha256:test'}
};
r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/complete`,completion,executor2.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.idempotent,false);
r=await request('POST',`/api/runtime/bridge-dispatches/${dispatch1.id}/complete`,completion,executor2.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/bridge-dispatches/${dispatch1.id}/events`,undefined,executor2.token);
assert.equal(r.status,200,JSON.stringify(r.body));
const eventTypes=r.body.data.map(x=>x.eventType);
for(const expected of ['CLAIMED','LEASE_RENEWED','RETRY_SCHEDULED','COMPLETED']){
  assert.ok(eventTypes.includes(expected),JSON.stringify(eventTypes));
}

r=await request('GET',`/api/runtime/trigger-fires/${fire1.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
r=await request('GET',`/api/runtime/capability-invocations/${fire1.capabilityInvocationId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');

r=await request('POST','/api/runtime/triggers/TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN/fire',{
  projectId,allowDisabledShadow:true,
  scheduledFireTime:'2026-10-09T09:00:00.000000',
  triggerReason:'M28.5_DEAD_LETTER'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const fire2=r.body.data;

const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});
const [[dispatchRow]]=await db.execute('SELECT id FROM trigger_dispatches WHERE trigger_fire_id=?',[fire2.id]);
assert.ok(dispatchRow);
await db.execute('UPDATE trigger_dispatches SET max_attempts=1 WHERE id=?',[dispatchRow.id]);

r=await request('POST',`/api/runtime/bridge-dispatches/${dispatchRow.id}/claim`,{},executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.attemptCount,1);
r=await request('POST',`/api/runtime/bridge-dispatches/${dispatchRow.id}/fail`,{
  retryable:true,errorCode:'LIBRARY_EXECUTION_FAILED',errorMessage:'terminal test'
},executor1.token);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'DEAD_LETTER');

r=await request('GET',`/api/runtime/trigger-fires/${fire2.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');
r=await request('GET',`/api/runtime/capability-invocations/${fire2.capabilityInvocationId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');

const [[persistedLeak]]=await db.execute(
  `SELECT COUNT(*) AS count
     FROM trigger_dispatches d
     JOIN trigger_fires f ON f.id=d.trigger_fire_id
    WHERE f.project_id=? AND (
      CAST(d.request_json AS CHAR) LIKE '%DO_NOT_PERSIST_PROSE%'
      OR CAST(d.response_evidence_json AS CHAR) LIKE '%DO_NOT_PERSIST_PROSE%'
      OR CAST(f.result_json AS CHAR) LIKE '%DO_NOT_PERSIST_PROSE%'
    )`,[projectId]
);
assert.equal(Number(persistedLeak.count),0);

const [[auditCounts]]=await db.execute(
  `SELECT COUNT(*) AS total,
          SUM(event_type='COMPLETED') AS completed,
          SUM(event_type='DEAD_LETTER') AS dead_letter
     FROM trigger_dispatch_events e
     JOIN trigger_dispatches d ON d.id=e.trigger_dispatch_id
     JOIN trigger_fires f ON f.id=d.trigger_fire_id
    WHERE f.project_id=?`,[projectId]
);
assert.ok(Number(auditCounts.total)>=6);
assert.equal(Number(auditCounts.completed),1);
assert.equal(Number(auditCounts.dead_letter),1);
await db.end();

console.log('Runtime V2.8 M28.5 bridge executor reliability validation passed');
