import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5014';
const token=must('RUNTIME_API_TOKEN');
const runtimeSha=must('RUNTIME_COMMIT_SHA').toLowerCase();
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

const [[project]]=await db.execute(
  `SELECT p.*
     FROM projects p
     JOIN m29_data_detection_gate_evaluations d ON d.project_id=p.id AND d.gate_key='G-M29-DATA-DETECTION' AND d.status='PASS'
     JOIN m29_self_loop_gate_evaluations s ON s.project_id=p.id AND s.gate_key='G-M29-SELF-LOOP' AND s.status='PASS'
     JOIN m29_automation_gate_evaluations a ON a.project_id=p.id AND a.gate_key='G-M29-AUTOMATION' AND a.status='PASS'
    WHERE p.project_type='AIGC_CONTENT'
    ORDER BY a.as_of DESC,a.created_at DESC LIMIT 1`
);
assert.ok(project,'AIGC project with M29.1-M29.3 PASS is required');
const projectId=project.id;

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M29_ANALYTICS_SNAPSHOT,'统一分析快照');
assert.equal(modules.M29_EVAL_BENCHMARK_BINDING,'评测与能力基准绑定');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M29-ANALYTICS-EVAL').displayName,'分析 / 评测 / 能力基准门禁');

r=await request('POST',`/api/runtime/projects/${projectId}/m29-analytics-snapshots`,{
  snapshotKey:'M294-AIGC-ANALYTICS-001',
  windowStart:'2026-10-01T00:00:00Z',
  windowEnd:'2026-10-08T00:00:00Z',
  evidence:{test:true,source:'M29.4'}
});
const analytics=expect(r,201);
assert.equal(analytics.status,'PASS',JSON.stringify(analytics));
assert.equal(analytics.productionAnalytics.domain,'AIGC');
assert.equal(analytics.productionAnalytics.coverageStatus,'PASS');
assert.ok(analytics.productionAnalytics.generationJobs>0);
assert.ok(analytics.dataAnalytics.metricObservations>0);
assert.ok(['PASS','N_A'].includes(analytics.portfolioAnalytics.coverageStatus));

const suffix=randomUUID().slice(0,8);
const providerKey=`m294-provider-${suffix}`,modelKey=`m294-model-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M29.4 Benchmark Provider',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',supportsStructuredOutput:true
});
expect(r,201);
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M29.4 Benchmark Model',qualityTier:'HIGH',latencyTier:'FAST',costTier:'LOW',
  capabilities:{taskTypes:['ANALYTICS_EVAL'],structuredOutput:true}
});
expect(r,201);
const capabilityKey=`MODEL:${providerKey}:${modelKey}`;

r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId:project.workspace_id,projectId,benchmarkType:'AI_CAPABILITY',
  subjectKey:`M294-MODEL-${suffix}`,name:'M29.4 Model Benchmark',capabilityKey,
  metadata:{benchmarkClass:'MODEL',m29:true}
});
const subject=expect(r,201);

r=await request('POST',`/api/runtime/benchmark-subjects/${subject.id}/snapshots`,{
  snapshotKey:`M294-SNAPSHOT-${suffix}`,sourceProvider:'M29_EVAL_RUNTIME',
  sourceRef:`runtime:${runtimeSha}`,observedAt:'2026-10-07T06:50:00Z',
  asOfDate:'2026-10-07',freshnessDays:30,versionLabel:'m29.4-model-v1',
  evidence:{test:true,exactVersion:true}
});
const benchmarkSnapshot=expect(r,201);

const [[evalRun]]=await db.execute(
  `SELECT id,candidate_runtime_sha,status FROM eval_runs
    WHERE status='PASS' AND candidate_runtime_sha=?
    ORDER BY finished_at DESC,created_at DESC LIMIT 1`,[runtimeSha]
);
assert.ok(evalRun,'PASS Eval Run bound to current Runtime SHA is required');

r=await request('POST',`/api/runtime/benchmark-subjects/${subject.id}/capability-runs`,{
  snapshotId:benchmarkSnapshot.id,evalRunId:evalRun.id,
  qualityScore:0.96,latencyMs:850,costAmount:0.02,costCurrency:'USD',reliabilityScore:0.98,
  referenceSupport:{structuredOutput:true},rightsTerms:{status:'TEST_ONLY'},
  evidence:{test:true,source:'M29.4'}
});
const benchmarkRun=expect(r,201);

const now=Date.now();
r=await request('POST','/api/runtime/eval-reliability-snapshots',{
  windowStart:new Date(now-60*60*1000).toISOString(),
  windowEnd:new Date(now+5*60*1000).toISOString(),
  candidateRuntimeSha:runtimeSha,
  idempotencyKey:`m294-reliability-${suffix}`
});
const reliability=expect(r,201);
assert.equal(reliability.candidateRuntimeSha,runtimeSha);

r=await request('POST',`/api/runtime/projects/${projectId}/m29-eval-benchmark-bindings`,{
  bindingKey:`M294-BIND-${suffix}`,benchmarkRunId:benchmarkRun.id,
  reliabilitySnapshotId:reliability.id,modelToolVersion:'wrong-version',
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_BENCHMARK_VERSION_MISMATCH');

r=await request('POST',`/api/runtime/projects/${projectId}/m29-eval-benchmark-bindings`,{
  bindingKey:`M294-BIND-${suffix}`,benchmarkRunId:benchmarkRun.id,
  reliabilitySnapshotId:reliability.id,modelToolVersion:'m29.4-model-v1',
  evidence:{test:true,exactVersion:true}
});
const binding=expect(r,201);
assert.equal(binding.status,'VERIFIED');
assert.equal(binding.capabilityType,'MODEL');
assert.equal(binding.runtimeSha,runtimeSha);
assert.equal(binding.modelToolVersion,'m29.4-model-v1');

r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-ANALYTICS-EVAL/evaluate`,{
  asOf:'2026-10-07T07:00:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.readyForCrossDomainEvaluation,true);
assert.ok(gate.evidenceSnapshot.benchmarkBindingCount>=1);
assert.ok(gate.evidenceSnapshot.benchmarkCapabilityTypes.includes('MODEL'));
assert.equal(gate.evidenceSnapshot.exactVersionValid,true);

r=await request('GET',`/api/runtime/projects/${projectId}/m29-analytics-eval`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.gateName,'分析 / 评测 / 能力基准门禁');
assert.ok(state.analyticsSnapshots.length>=1);
assert.ok(state.benchmarkBindings.length>=1);
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_analytics_snapshots WHERE project_id=? AND status='PASS') analytics_pass,
    (SELECT COUNT(*) FROM m29_eval_benchmark_bindings WHERE project_id=? AND status='VERIFIED') benchmark_verified,
    (SELECT COUNT(*) FROM m29_analytics_eval_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-ANALYTICS-EVAL' AND status='PASS') gate_pass`,
  [projectId,projectId,projectId]
);
assert.ok(Number(truth.analytics_pass)>=1);
assert.ok(Number(truth.benchmark_verified)>=1);
assert.ok(Number(truth.gate_pass)>=1);

await db.end();
console.log('M29_4_ANALYTICS_EVAL_BENCHMARK_PASS');
