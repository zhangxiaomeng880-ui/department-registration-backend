import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=must('RUNTIME_API_BASE_URL');
const audience=must('GITHUB_OIDC_AUDIENCE');

const getOidcToken=async()=>{
  const url=must('ACTIONS_ID_TOKEN_REQUEST_URL');
  const requestToken=must('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  const response=await fetch(url+'&audience='+encodeURIComponent(audience),{
    headers:{authorization:'bearer '+requestToken}
  });
  assert.equal(response.ok,true,await response.text());
  const body=await response.json();
  assert.ok(body.value);
  return body.value;
};
const postReceipt=async(receipt,token)=>{
  const response=await fetch(baseUrl+'/api/external/bridge/github-receipts',{
    method:'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify(receipt)
  });
  let body={};try{body=await response.json();}catch{}
  return {status:response.status,body};
};

const checkpoint='/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md';
const receipt={
  schemaVersion:'1.0',
  receiptId:'m286-ci-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT,
  projectKey:'novel-hello-that-summer',
  triggerKey:'TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN',
  scheduledFireTime:'2026-10-10T09:00:00',
  outcome:'PASS',
  output:{
    status:'PASS',
    updatedChapters:['NOVEL_001'],
    reusedPassChapters:[],
    gateStatus:'PASS',
    checkpointPath:checkpoint,
    resumePoint:'NOVEL_002',
    blockingReason:null
  },
  evidence:{
    executor:'CHATGPT_LIBRARY_SCHEDULED_TASK',
    sourceFingerprint:'sha256:m286-ci'
  }
};

let r=await postReceipt(receipt,null);
assert.equal(r.status,401,JSON.stringify(r.body));
assert.equal(r.body.error,'GITHUB_OIDC_REQUIRED');

const oidc=await getOidcToken();
r=await postReceipt(receipt,oidc);
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.idempotent,false);
assert.ok(r.body.data.triggerFireId);
assert.ok(r.body.data.triggerDispatchId);
assert.ok(r.body.data.capabilityInvocationId);
const first=r.body.data;

r=await postReceipt(receipt,oidc);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.triggerFireId,first.triggerFireId);

const leakReceipt={
  ...receipt,
  receiptId:receipt.receiptId+'-leak',
  scheduledFireTime:'2026-10-11T09:00:00',
  output:{...receipt.output,chapterText:'DO_NOT_PERSIST_PROSE'}
};
r=await postReceipt(leakReceipt,oidc);
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'BRIDGE_SOURCE_BODY_NOT_ALLOWED');

const conflictReceipt={
  ...receipt,
  output:{...receipt.output,resumePoint:'NOVEL_003'}
};
r=await postReceipt(conflictReceipt,oidc);
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EXTERNAL_BRIDGE_RECEIPT_CONFLICT');

const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});
const [[stored]]=await db.execute(
  'SELECT status,attempt_count,trigger_fire_id,trigger_dispatch_id,capability_invocation_id,oidc_claims_json FROM external_bridge_receipts WHERE receipt_id=?',
  [receipt.receiptId]
);
assert.equal(stored.status,'PASS');
assert.equal(Number(stored.attempt_count),1);
assert.equal(stored.trigger_fire_id,first.triggerFireId);
assert.equal(stored.trigger_dispatch_id,first.triggerDispatchId);
assert.equal(stored.capability_invocation_id,first.capabilityInvocationId);
const claims=typeof stored.oidc_claims_json==='string'?JSON.parse(stored.oidc_claims_json):stored.oidc_claims_json;
assert.equal(claims.repository,'zhangxiaomeng880-ui/department-registration-backend');
assert.equal(claims.ref,process.env.GITHUB_OIDC_EXPECTED_REF);
assert.equal(claims.workflowRef,process.env.GITHUB_OIDC_EXPECTED_WORKFLOW_REF);

const [[leaks]]=await db.execute(
  `SELECT
     (SELECT COUNT(*) FROM external_bridge_receipts WHERE receipt_id=?) receipt_leak,
     (SELECT COUNT(*) FROM trigger_fires WHERE result_json LIKE '%DO_NOT_PERSIST_PROSE%') fire_leak,
     (SELECT COUNT(*) FROM trigger_dispatches WHERE CAST(response_evidence_json AS CHAR) LIKE '%DO_NOT_PERSIST_PROSE%') dispatch_leak`,
  [leakReceipt.receiptId]
);
assert.equal(Number(leaks.receipt_leak),0);
assert.equal(Number(leaks.fire_leak),0);
assert.equal(Number(leaks.dispatch_leak),0);
await db.end();

console.log('Runtime V2.8 M28.6 GitHub OIDC external executor receipt validation passed');
