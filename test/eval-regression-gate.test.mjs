import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runEvalReplayManifest } from '../src/eval-runner.mjs';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m243-platform-token';
const request=async(method,path,body,auth=token)=>{
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${auth}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const baselineSha='a'.repeat(40);
const passSha='b'.repeat(40);
const warningSha='c'.repeat(40);
const blockedSha='d'.repeat(40);
const providerA=`eval-a-${suffix}`;
const providerB=`eval-b-${suffix}`;
const modelKey='test-model';
const sourceHash='e'.repeat(64);
const schemaHash='f'.repeat(64);

for(const [providerKey,priority] of [[providerA,1],[providerB,2]]){
  let r=await request('POST','/api/runtime/providers',{
    providerKey,providerType:'SYNTHETIC',displayName:providerKey,
    adapterKey:`synthetic-${providerKey}`,healthStatus:'HEALTHY',priority,supportsStructuredOutput:true
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  r=await request('POST','/api/runtime/models',{
    providerKey,modelKey,displayName:`${providerKey} model`,qualityTier:'PREMIUM',
    latencyTier:'FAST',costTier:'LOW',priority:1,
    capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

let r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`m243-${suffix}`,name:'M24.3 Comparable Regression Suite'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const suiteId=r.body.data.id;

r=await request('POST',`/api/runtime/eval-suites/${suiteId}/versions`,{versionNo:1});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;

const goodOutput={ok:true,findings:[{code:'CONTINUITY_OK'}]};
const goodEvidence=[{sourceFileId:'synthetic-source-001',contentSha256:sourceHash,lineStart:10,lineEnd:20}];
const profiles={
  [baselineSha]:{
    output:goodOutput,outputSchemaSha256:schemaHash,evidence:goodEvidence,
    execution:{status:'PASS',durationMs:100,estimatedCost:0.1,costCurrency:'USD'}
  },
  [passSha]:{
    output:goodOutput,outputSchemaSha256:schemaHash,evidence:goodEvidence,
    execution:{status:'PASS',durationMs:95,estimatedCost:0.09,costCurrency:'USD'}
  },
  [warningSha]:{
    output:goodOutput,outputSchemaSha256:schemaHash,evidence:goodEvidence,
    execution:{status:'PASS',durationMs:115,estimatedCost:0.115,costCurrency:'USD'}
  },
  [blockedSha]:{
    output:{findings:[]},outputSchemaSha256:schemaHash,evidence:[],
    execution:{status:'PASS',durationMs:130,estimatedCost:0.13,costCurrency:'USD'}
  }
};

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/cases`,{
  caseKey:'shared-continuity-case',sequenceNo:1,
  replayInput:{
    projectType:'AIGC_CONTENT',taskType:'SCRIPT_CONTINUITY',
    query:'Synthetic M24.3 baseline/candidate regression fixture.',
    policyMode:'QUALITY_FIRST',requiredStructuredOutput:true,
    allowedProviderKeys:[providerA,providerB],
    syntheticObservationsByRuntimeSha:profiles
  },
  sourceRefs:[{
    sourceFileId:'synthetic-source-001',sourceVersion:'v1',lineStart:10,lineEnd:20,
    contentSha256:sourceHash,contextRole:'AUTHORITATIVE',sourceProvider:'SYNTHETIC_FIXTURE'
  }],
  assertions:{
    structuredOutput:{requiredKeys:['ok','findings'],jsonSchemaSha256:schemaHash},
    evidence:{required:true,minCount:1,allowedSourceFileIds:['synthetic-source-001'],requireContentHash:true},
    router:{
      matched:true,policyResult:'ALLOW',routeRuleKey:'P86',
      selectedProviderKey:providerA,selectedModelKey:modelKey,providerHealthStatus:'HEALTHY'
    },
    execution:{status:'PASS',maxDurationMs:1000,maxEstimatedCost:1,costCurrency:'USD'}
  }
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/eval-suite-versions/${versionId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
const fixtureSha256=r.body.data.fixtureSha256;

const manifest=async(sha,label,baselineRuntimeSha=null)=>{
  const x=await request('POST','/api/runtime/eval-replay-manifests',{
    suiteVersionId:versionId,candidateRuntimeSha:sha,baselineRuntimeSha,
    workflowVersion:'context-orchestrator-v1',routerVersion:'router-p86-v1',
    ragIndexVersion:'synthetic-rag-v1',idempotencyKey:`m243-manifest-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  assert.equal(x.body.data.fixtureSha256,fixtureSha256);
  return x.body.data;
};

const baseManifest=await manifest(baselineSha,'baseline');
const passManifest=await manifest(passSha,'pass',baselineSha);
const warningManifest=await manifest(warningSha,'warning',baselineSha);
const blockedManifest=await manifest(blockedSha,'blocked',baselineSha);

const baselineRun=await runEvalReplayManifest(baseManifest.id,{
  idempotencyKey:`m243-run-baseline-${suffix}`,runtimeCommitSha:baselineSha
});
assert.equal(baselineRun.status,'PASS');

const passRun=await runEvalReplayManifest(passManifest.id,{
  idempotencyKey:`m243-run-pass-${suffix}`,runtimeCommitSha:passSha
});
assert.equal(passRun.status,'PASS');

const warningRun=await runEvalReplayManifest(warningManifest.id,{
  idempotencyKey:`m243-run-warning-${suffix}`,runtimeCommitSha:warningSha
});
assert.equal(warningRun.status,'PASS');

r=await request('PATCH',`/api/runtime/providers/${providerA}/health`,{
  healthStatus:'DOWN',reasonCode:'M243_SYNTHETIC_ROUTE_DRIFT',recordedBy:'CI'
});
assert.equal(r.status,200,JSON.stringify(r.body));

const blockedRun=await runEvalReplayManifest(blockedManifest.id,{
  idempotencyKey:`m243-run-blocked-${suffix}`,runtimeCommitSha:blockedSha
});
assert.equal(blockedRun.status,'FAIL');

const compare=async(label,candidateRunId,policy)=>{
  const x=await request('POST','/api/runtime/eval-regression-comparisons',{
    baselineEvalRunId:baselineRun.id,candidateEvalRunId,idempotencyKey:`m243-cmp-${label}-${suffix}`,
    ...(policy?{policy}:{})
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  return x.body.data;
};
const gate=async(label,comparisonId)=>{
  const x=await request('POST',`/api/runtime/eval-regression-comparisons/${comparisonId}/release-gate`,{
    gateKey:'PRODUCTION_PROMOTION',idempotencyKey:`m243-gate-${label}-${suffix}`
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  return x.body.data;
};

const passCmp=await compare('pass',passRun.id);
assert.equal(passCmp.status,'PASS');
assert.equal(passCmp.blockerCount,0);
assert.equal(passCmp.warningCount,0);
assert.match(passCmp.comparisonSha256,/^[a-f0-9]{64}$/);
const passGate=await gate('pass',passCmp.id);
assert.equal(passGate.decision,'PASS');
assert.equal(passGate.blockerCount,0);
assert.match(passGate.gateSha256,/^[a-f0-9]{64}$/);

const warningCmp=await compare('warning',warningRun.id);
assert.equal(warningCmp.status,'WARNING');
assert.equal(warningCmp.blockerCount,0);
assert.ok(warningCmp.warningCount>=2);
assert.ok(warningCmp.summary.warnings.some(x=>x.code==='P95_LATENCY_WARNING'));
assert.ok(warningCmp.summary.warnings.some(x=>x.code==='COST_WARNING'));
const warningGate=await gate('warning',warningCmp.id);
assert.equal(warningGate.decision,'PASS');
assert.equal(warningGate.blockerCount,0);
assert.ok(warningGate.warningCount>=2);

const blockedCmp=await compare('blocked',blockedRun.id);
assert.equal(blockedCmp.status,'BLOCKED');
assert.ok(blockedCmp.blockerCount>=5);
const blockCodes=blockedCmp.summary.blockers.map(x=>x.code);
assert.ok(blockCodes.includes('CANDIDATE_RUN_NOT_PASS'));
assert.ok(blockCodes.includes('CASE_PASS_RATE_REGRESSION'));
assert.ok(blockCodes.includes('ASSERTION_PASS_RATE_REGRESSION'));
assert.ok(blockCodes.includes('STRUCTURED_OUTPUT_PASS_RATE_REGRESSION'));
assert.ok(blockCodes.includes('EVIDENCE_PASS_RATE_REGRESSION'));
assert.ok(blockCodes.includes('ROUTER_PASS_RATE_REGRESSION'));
assert.ok(blockCodes.includes('ROUTE_DRIFT'));
assert.ok(blockCodes.includes('P95_LATENCY_REGRESSION'));
assert.ok(blockCodes.includes('COST_REGRESSION'));
assert.ok(blockCodes.includes('NEW_FAILURE_CODES'));
const blockedGate=await gate('blocked',blockedCmp.id);
assert.equal(blockedGate.decision,'BLOCKED');
assert.ok(blockedGate.blockerCount>0);

r=await request('GET',`/api/runtime/eval-release-gates/${blockedGate.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.gateSha256,blockedGate.gateSha256);

r=await request('POST','/api/runtime/eval-regression-comparisons',{
  baselineEvalRunId:baselineRun.id,candidateEvalRunId:passRun.id,idempotencyKey:`m243-cmp-pass-${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,passCmp.id);
assert.equal(r.body.data.idempotent,true);

const noAuth=await request('GET',`/api/runtime/eval-regression-comparisons/${passCmp.id}`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

console.log('G24_3_REGRESSION_COMPARATOR_RELEASE_GATE_PASS');
