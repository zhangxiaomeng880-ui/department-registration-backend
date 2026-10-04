import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4600';
const platformToken=process.env.RUNTIME_API_TOKEN||'m241-platform-token';
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const sourceHash='a'.repeat(64);
const schemaHash='b'.repeat(64);
const candidateSha='34578464f5d19e87978ccb81719fb23a4b79d6f1';
const baselineSha='dbd20be3b50e9f417a3fa8aa4f632d9ee93983bd';

let r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`runtime-release-${suffix}`,name:'Runtime Release Regression Suite',
  description:'Synthetic release regression fixtures only'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;
assert.equal(r.body.data.status,'DRAFT');
assert.equal(r.body.data.replayContractVersion,'eval-replay-v1');

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'router-structured-output',
  sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',
    taskType:'SCRIPT_CONTINUITY',
    query:'Synthetic fixture: identify continuity conflicts using supplied references only.',
    policyMode:'QUALITY_FIRST',
    requiredStructuredOutput:true
  },
  sourceRefs:[{
    sourceFileId:'synthetic-source-001',
    sourceVersion:'v1',
    lineStart:10,lineEnd:20,
    contentSha256:sourceHash,
    contextRole:'AUTHORITATIVE',
    sourceProvider:'SYNTHETIC_FIXTURE'
  }],
  assertions:{
    structuredOutput:{requiredKeys:['findingCount','findings'],jsonSchemaSha256:schemaHash},
    evidence:{required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true},
    router:{matched:true,policyResult:'ALLOW'},
    execution:{status:'PASS',maxDurationMs:30000,maxEstimatedCost:1,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));
const caseHash=r.body.data.caseSha256;
assert.match(caseHash,/^[a-f0-9]{64}$/);

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'forbidden-source-body',sequenceNo:2,
  replayInput:{projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',query:'Synthetic only'},
  sourceRefs:[{sourceFileId:'x',contentSha256:sourceHash,content:'private body'}],
  assertions:{router:{policyResult:'ALLOW'}}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_SOURCE_BODY_NOT_ALLOWED');

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'forbidden-secret',sequenceNo:2,
  replayInput:{projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',query:'Synthetic only',apiKey:'should-never-persist'},
  assertions:{router:{policyResult:'ALLOW'}}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_SECRET_NOT_ALLOWED');

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'blocked-route',
  sequenceNo:2,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'Synthetic fixture: no provider route should be allowed.',
    policyMode:'FALLBACK_ONLY',requiredStructuredOutput:true
  },
  sourceRefs:[],
  assertions:{
    structuredOutput:{requiredKeys:['error']},
    evidence:{required:false,minCount:0},
    router:{matched:true,policyResult:'BLOCK'},
    execution:{status:'FAIL',maxDurationMs:5000}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/eval-suite-versions/${versionId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.cases.length,2);
assert.deepEqual(r.body.data.cases.map(x=>x.sequenceNo),[1,2]);

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.caseCount,2);
assert.match(r.body.data.fixtureSha256,/^[a-f0-9]{64}$/);
const fixtureHash=r.body.data.fixtureSha256;
assert.equal(r.body.data.idempotent,false);

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.fixtureSha256,fixtureHash);
assert.equal(r.body.data.idempotent,true);

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'too-late',sequenceNo:3,
  replayInput:{projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',query:'Synthetic only'},
  sourceRefs:[],assertions:{router:{policyResult:'ALLOW'}}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_SUITE_VERSION_FROZEN');

const idemKey=`replay-${suffix}`;
r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,
  candidateRuntimeSha:candidateSha,
  baselineRuntimeSha:baselineSha,
  workflowVersion:'context-orchestrator-v1',
  routerVersion:'policy-router-v2',
  ragIndexVersion:'synthetic-rag-v1',
  idempotencyKey:idemKey,
  metadata:{purpose:'M24.1 contract validation'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const manifestId=r.body.data.id;
assert.equal(r.body.data.fixtureSha256,fixtureHash);
assert.equal(r.body.data.candidateRuntimeSha,candidateSha);
assert.match(r.body.data.manifestSha256,/^[a-f0-9]{64}$/);
const manifestHash=r.body.data.manifestSha256;
assert.equal(r.body.data.idempotent,false);

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:candidateSha,baselineRuntimeSha:baselineSha,
  workflowVersion:'context-orchestrator-v1',routerVersion:'policy-router-v2',
  ragIndexVersion:'synthetic-rag-v1',idempotencyKey:idemKey,
  metadata:{purpose:'M24.1 contract validation'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,manifestId);
assert.equal(r.body.data.manifestSha256,manifestHash);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/eval-replay-manifests/${manifestId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.manifestSha256,manifestHash);
assert.equal(r.body.data.status,'READY');

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:'not-a-sha',
  idempotencyKey:`bad-sha-${suffix}`
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'INVALID_EVAL_REPLAY_MANIFEST');

r=await request('POST','/api/runtime/eval-replay-manifests',{
  suiteVersionId:versionId,candidateRuntimeSha:candidateSha,
  idempotencyKey:`secret-meta-${suffix}`,metadata:{accessToken:'forbidden'}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'EVAL_SECRET_NOT_ALLOWED');

const noAuth=await request('GET','/api/runtime/eval-suites',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[versionRow]]=await db.execute(
  'SELECT status,fixture_sha256,case_count FROM eval_suite_versions WHERE id=?',[versionId]
);
assert.equal(versionRow.status,'FROZEN');
assert.equal(versionRow.fixture_sha256,fixtureHash);
assert.equal(Number(versionRow.case_count),2);
const [[caseCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_cases WHERE suite_version_id=?',[versionId]);
assert.equal(Number(caseCount.count),2);
const [[manifestCount]]=await db.execute('SELECT COUNT(*) AS count FROM eval_replay_manifests WHERE id=?',[manifestId]);
assert.equal(Number(manifestCount.count),1);
await db.end();

console.log('G24_1_EVAL_REPLAY_CONTRACT_PASS');
