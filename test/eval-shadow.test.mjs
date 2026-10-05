import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';
import { EVAL_ASSERTION_SCHEMA_SHA256 } from '../src/eval-runner.mjs';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m244-platform-token';
const candidateSha=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
assert.match(candidateSha,/^[a-f0-9]{40}$/);
const baselineSha='1a00c72fdf20a6db3cff823e5200edf9e5f4d5d2';
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const request=async(method,path,body,auth=token)=>{
  const headers={'content-type':'application/json'}; if(auth) headers.authorization=`Bearer ${auth}`;
  const res=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await res.json();}catch{}
  return {status:res.status,body:payload};
};
const suffix=randomUUID().slice(0,8),providerKey=`shadow-openai-${suffix}`;
const factText='LIBRARY_SENTINEL_SOURCE_TEXT SC049 hard lock: call mother first, then Lin.';
const movieText='SC049 current movie text: returns to 62㎡ and calls Lin directly.';
const refs=[
  {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343,contentSha256:sha256(factText),contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'},
  {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556,contentSha256:sha256(movieText),contextRole:'CURRENT',sourceProvider:'SYNTHETIC_FIXTURE'}
];
const contexts=[
  {sourceFileId:'fact-file',sourceText:factText,sourceStatus:'CURRENT',sourcePath:'/synthetic/facts'},
  {sourceFileId:'movie-file',sourceText:movieText,sourceStatus:'CURRENT',sourcePath:'/synthetic/movie'}
];

let r=await request('POST','/api/runtime/providers',{providerKey,providerType:'OPENAI',displayName:'M24.4 Mock OpenAI',adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/models',{providerKey,modelKey:'test-model',displayName:'M24.4 Test Model',qualityTier:'PREMIUM',latencyTier:'FAST',costTier:'LOW',priority:1,capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/pricing-versions',{providerKey,modelKey:'test-model',currency:'USD',inputRatePerMillion:1,outputRatePerMillion:1,effectiveFrom:'2020-01-01T00:00:00.000Z',sourceLabel:'M24_4_MOCK'});
assert.equal(r.status,201,JSON.stringify(r.body));

const createProject=async key=>{
  const x=await request('POST','/api/runtime/projects',{projectKey:`${key}-${suffix}`,name:key,projectType:'AIGC_CONTENT'});
  assert.equal(x.status,201,JSON.stringify(x.body)); return x.body.data.id;
};
const sourceProjectId=await createProject('M24.4 Source');
const shadowProjectId=await createProject('M24.4 Shadow');
const ordinaryProjectId=await createProject('M24.4 Ordinary');

r=await request('POST','/api/runtime/runs',{
  projectId:sourceProjectId,runType:'WORKFLOW',status:'PASS',triggerSource:'USER',
  input:{prompt:'SOURCE_PRIVATE_SENTINEL',businessId:'prod-like-001'},
  runtimeCommitSha:baselineSha,workflowVersion:'wf-source-v1',routerVersion:'policy-router-v2',ragIndexVersion:'rag-source-v1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const sourceRunId=r.body.data.id;

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
await db.execute('UPDATE runs SET finished_at=? WHERE id=?',[new Date('2026-10-01T12:00:00Z'),sourceRunId]);
const [[sourceBefore]]=await db.execute('SELECT * FROM runs WHERE id=?',[sourceRunId]);

let x=await request('POST','/api/runtime/eval-suites',{suiteKey:`m244-${suffix}`,name:'M24.4 Shadow Suite'});
assert.equal(x.status,201,JSON.stringify(x.body)); const suiteId=x.body.data.id;
x=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(x.status,201,JSON.stringify(x.body)); const versionId=x.body.data.id;
x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'shadow-case',sequenceNo:1,
  replayInput:{projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',query:'检查SC049连续性，只输出真实问题和证据。',scope:'SC049',policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,allowedProviderKeys:[providerKey],preferredProviderKey:providerKey,preferredModelKey:'test-model',precedence:['STORY_FACTS','MOVIE_CURRENT']},
  sourceRefs:refs,
  assertions:{
    structuredOutput:{requiredKeys:['scope','findingCount','findings','noOtherHardConflicts'],jsonSchemaSha256:EVAL_ASSERTION_SCHEMA_SHA256},
    evidence:{required:true,minCount:2,allowedSourceFileIds:['fact-file','movie-file'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW',routeRuleKey:'P86',selectedProviderKey:providerKey,selectedModelKey:'test-model',providerHealthStatus:'HEALTHY'},
    execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:0.01,costCurrency:'USD'}
  }
});
assert.equal(x.status,201,JSON.stringify(x.body));
x=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(x.status,200,JSON.stringify(x.body));
x=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:candidateSha,baselineRuntimeSha:baselineSha,
  workflowVersion:'shadow-eval-v1',routerVersion:'policy-router-v2',ragIndexVersion:'synthetic-rag-v1',
  idempotencyKey:`m244-manifest-${suffix}`
});
assert.equal(x.status,201,JSON.stringify(x.body)); const manifestId=x.body.data.id;

r=await request('POST','/api/runtime/eval-shadow-replays',{sourceRunId,replayManifestId:manifestId,executionProjectId:ordinaryProjectId,idempotencyKey:`ordinary-${suffix}`});
assert.equal(r.status,409,JSON.stringify(r.body)); assert.equal(r.body.error,'SHADOW_PROJECT_NOT_REGISTERED');

r=await request('POST','/api/runtime/eval-shadow-replays',{sourceRunId,replayManifestId:manifestId,executionProjectId:sourceProjectId,idempotencyKey:`same-project-${suffix}`});
assert.equal(r.status,409,JSON.stringify(r.body)); assert.equal(r.body.error,'SHADOW_PROJECT_ISOLATION_REQUIRED');

r=await request('POST','/api/runtime/eval-shadow-projects',{projectId:shadowProjectId});
assert.equal(r.status,201,JSON.stringify(r.body)); assert.equal(r.body.data.status,'ACTIVE');

r=await request('POST','/api/runtime/eval-shadow-replays',{sourceRunId,replayManifestId:manifestId,executionProjectId:shadowProjectId,idempotencyKey:`shadow-${suffix}`});
assert.equal(r.status,201,JSON.stringify(r.body)); const shadowReplayId=r.body.data.id;
assert.equal(r.body.data.status,'PREPARED'); assert.equal(r.body.data.sourceProjectId,sourceProjectId);
assert.equal(r.body.data.executionProjectId,shadowProjectId); assert.match(r.body.data.sourceSnapshotSha256,/^[a-f0-9]{64}$/);

r=await request('GET',`/api/runtime/eval-shadow-replays/${shadowReplayId}/source-integrity`);
assert.equal(r.status,200,JSON.stringify(r.body)); assert.equal(r.body.data.matches,true);

r=await request('POST',`/api/runtime/eval-shadow-replays/${shadowReplayId}/run`,{
  runtimeCommitSha:candidateSha,contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body)); assert.equal(r.body.data.shadowReplay.status,'PASS');
assert.equal(r.body.data.evalRun.status,'PASS'); assert.equal(r.body.data.evalRun.executionProjectId,shadowProjectId);
const shadowEvalRunId=r.body.data.evalRun.id;

r=await request('POST',`/api/runtime/eval-shadow-replays/${shadowReplayId}/run`,{
  runtimeCommitSha:candidateSha,contextsByCaseKey:{'shadow-case':contexts}
});
assert.equal(r.status,201,JSON.stringify(r.body)); assert.equal(r.body.data.evalRun.id,shadowEvalRunId); assert.equal(r.body.data.idempotent,true);

const [[sourceAfter]]=await db.execute('SELECT * FROM runs WHERE id=?',[sourceRunId]);
assert.equal(JSON.stringify(sourceAfter),JSON.stringify(sourceBefore));
const [[sourceRunCount]]=await db.execute('SELECT COUNT(*) AS count FROM runs WHERE project_id=?',[sourceProjectId]);
assert.equal(Number(sourceRunCount.count),1);
const [[shadowRuntimeCount]]=await db.execute("SELECT COUNT(*) AS count FROM runs WHERE project_id=? AND run_type='EVAL_REPLAY'",[shadowProjectId]);
assert.equal(Number(shadowRuntimeCount.count),1);
const [[shadowRow]]=await db.execute('SELECT * FROM eval_shadow_replays WHERE id=?',[shadowReplayId]);
assert.equal(JSON.stringify(shadowRow).includes('SOURCE_PRIVATE_SENTINEL'),false);
assert.equal(JSON.stringify(shadowRow).includes('prod-like-001'),false);

r=await request('GET',`/api/runtime/eval-shadow-replays/${shadowReplayId}/source-integrity`);
assert.equal(r.status,200,JSON.stringify(r.body)); assert.equal(r.body.data.matches,true);

r=await request('POST','/api/runtime/runs',{
  projectId:sourceProjectId,runType:'WORKFLOW',status:'PASS',triggerSource:'USER',
  input:{prompt:'SECOND_SOURCE_PRIVATE_SENTINEL'},runtimeCommitSha:baselineSha,
  workflowVersion:'wf-source-v1',routerVersion:'policy-router-v2',ragIndexVersion:'rag-source-v1'
});
assert.equal(r.status,201,JSON.stringify(r.body)); const driftSourceRunId=r.body.data.id;
await db.execute('UPDATE runs SET finished_at=? WHERE id=?',[new Date('2026-10-01T13:00:00Z'),driftSourceRunId]);
r=await request('POST','/api/runtime/eval-shadow-replays',{sourceRunId:driftSourceRunId,replayManifestId:manifestId,executionProjectId:shadowProjectId,idempotencyKey:`drift-${suffix}`});
assert.equal(r.status,201,JSON.stringify(r.body)); const driftShadowId=r.body.data.id;
await db.execute("UPDATE runs SET workflow_version='tampered-after-prepare' WHERE id=?",[driftSourceRunId]);
r=await request('POST',`/api/runtime/eval-shadow-replays/${driftShadowId}/run`,{runtimeCommitSha:candidateSha,contextsByCaseKey:{'shadow-case':contexts}});
assert.equal(r.status,409,JSON.stringify(r.body)); assert.equal(r.body.error,'SHADOW_SOURCE_DRIFT');

const noAuth=await request('GET','/api/runtime/eval-shadow-projects',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

await db.end();
console.log('G24_4_PRODUCTION_SAFE_SHADOW_EVAL_PASS');
