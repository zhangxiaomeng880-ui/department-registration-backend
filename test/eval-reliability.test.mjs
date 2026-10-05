import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m245-platform-token';
const runtimeSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(runtimeSha,/^[a-f0-9]{40}$/,'RUNTIME_COMMIT_SHA must be set for M24.5');

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const now=Date.now();
const windowStart=new Date(now-30*60*1000).toISOString();
const windowEnd=new Date(now+30*60*1000).toISOString();
const idempotencyKey=`m245-${randomUUID()}`;

let r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart,windowEnd,candidateRuntimeSha:runtimeSha,idempotencyKey
},null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart,windowEnd,candidateRuntimeSha:runtimeSha,idempotencyKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const snapshot=r.body.data;
assert.equal(snapshot.policyVersion,'eval-reliability-v1');
assert.equal(snapshot.candidateRuntimeSha,runtimeSha);
assert.match(snapshot.snapshotSha256,/^[a-f0-9]{64}$/);
assert.ok(snapshot.metrics.eval.total>=1,JSON.stringify(snapshot.metrics));
assert.ok(snapshot.metrics.eval.execution.sampleCount>=1,JSON.stringify(snapshot.metrics.eval));
assert.ok(snapshot.metrics.shadow.total>=1,JSON.stringify(snapshot.metrics.shadow));
assert.equal(snapshot.metrics.shadow.sourceBodyReadViolations,0);
assert.equal(snapshot.metrics.shadow.customerBillingEligibilityViolations,0);
assert.ok(snapshot.metrics.regression.comparisons>=1,JSON.stringify(snapshot.metrics.regression));
assert.ok(snapshot.metrics.regression.releaseGates>=1,JSON.stringify(snapshot.metrics.regression));
assert.ok(snapshot.metrics.runtimeBreakdown.some(row=>row.candidateRuntimeSha===runtimeSha));
assert.ok(snapshot.sourceWatermark.evalRuns.count>=1);
assert.ok(snapshot.sourceWatermark.shadowReplays.count>=1);

r=await request('GET',`/api/runtime/eval-reliability-snapshots/${snapshot.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.snapshotSha256,snapshot.snapshotSha256);
assert.deepEqual(r.body.data.metrics,snapshot.metrics);

r=await request('GET',`/api/runtime/eval-reliability-snapshots/${snapshot.id}`,undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart,windowEnd,candidateRuntimeSha:runtimeSha,idempotencyKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,snapshot.id);
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.snapshotSha256,snapshot.snapshotSha256);

r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart:new Date(now-10*60*1000).toISOString(),windowEnd,
  candidateRuntimeSha:runtimeSha,idempotencyKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_RELIABILITY_IDEMPOTENCY_CONFLICT');

r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart,windowEnd,candidateRuntimeSha:'not-a-sha',idempotencyKey:`bad-sha-${randomUUID()}`
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'INVALID_RELIABILITY_RUNTIME_SHA');

r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart:'2026-01-01T00:00:00.000Z',windowEnd:'2026-06-01T00:00:00.000Z',
  idempotencyKey:`too-wide-${randomUUID()}`
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'RELIABILITY_WINDOW_TOO_LARGE');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [rows]=await db.execute(
  'SELECT snapshot_sha256,policy_version,metrics_json,source_watermark_json FROM eval_reliability_snapshots WHERE id=?',
  [snapshot.id]
);
assert.equal(rows.length,1);
assert.equal(rows[0].snapshot_sha256,snapshot.snapshotSha256);
assert.equal(rows[0].policy_version,'eval-reliability-v1');
const persistedMetrics=typeof rows[0].metrics_json==='string'?JSON.parse(rows[0].metrics_json):rows[0].metrics_json;
assert.equal(persistedMetrics.shadow.sourceBodyReadViolations,0);
assert.equal(persistedMetrics.shadow.customerBillingEligibilityViolations,0);
await db.end();

console.log('G24_5_RELIABILITY_ANALYTICS_PASS');
