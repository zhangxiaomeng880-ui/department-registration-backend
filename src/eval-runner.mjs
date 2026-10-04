import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { routeRuntimeTask } from './runtime-router.mjs';
import { selectProviderModel } from './policy-router-v2.mjs';
import { getEvalReplayManifest, getEvalSuiteVersion } from './eval-replay.mjs';

const SHA40=/^[a-f0-9]{40}$/i;
const SHA64=/^[a-f0-9]{64}$/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const hasPath=(value,path)=>{
  let cursor=value;
  for(const part of String(path).split('.').filter(Boolean)){
    if(cursor==null||typeof cursor!=='object'||!(part in cursor)) return false;
    cursor=cursor[part];
  }
  return true;
};
const deepEqual=(a,b)=>stableJson(a)===stableJson(b);

export const resolveEvalRuntimeSha=()=>(
  process.env.RUNTIME_COMMIT_SHA ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  null
);

const normalizeRun=row=>({
  id:row.id,replayManifestId:row.replay_manifest_id,candidateRuntimeSha:row.candidate_runtime_sha,
  baselineRuntimeSha:row.baseline_runtime_sha||null,executionMode:row.execution_mode,status:row.status,
  caseCount:Number(row.case_count),passedCaseCount:Number(row.passed_case_count),failedCaseCount:Number(row.failed_case_count),
  assertionCount:Number(row.assertion_count),passedAssertionCount:Number(row.passed_assertion_count),
  failedAssertionCount:Number(row.failed_assertion_count),resultSha256:row.result_sha256||null,
  summary:row.summary_json||null,idempotencyKey:row.idempotency_key,
  startedAt:row.started_at,finishedAt:row.finished_at||null,createdAt:row.created_at
});
const normalizeCaseResult=row=>({
  id:row.id,evalRunId:row.eval_run_id,evalCaseId:row.eval_case_id,caseKey:row.case_key,
  sequenceNo:Number(row.sequence_no),status:row.status,route:row.route_json,
  observedOutput:row.observed_output_json,observedEvidence:row.observed_evidence_json||[],
  observedExecution:row.observed_execution_json,assertionSummary:row.assertion_summary_json,
  resultSha256:row.result_sha256,startedAt:row.started_at,finishedAt:row.finished_at
});
const normalizeAssertion=row=>({
  id:row.id,evalCaseResultId:row.eval_case_result_id,group:row.assertion_group,key:row.assertion_key,
  status:row.status,expected:row.expected_json,actual:row.actual_json,failureCode:row.failure_code||null,
  createdAt:row.created_at
});
const addAssertion=(items,group,key,pass,expected,actual,failureCode)=>items.push({
  group,key,status:pass?'PASS':'FAIL',expected:expected===undefined?null:expected,
  actual:actual===undefined?null:actual,failureCode:pass?null:failureCode
});

const evaluateAssertions=({evalCase,route,observation})=>{
  const assertions=evalCase.assertions||{};
  const output=observation.output??null;
  const evidence=Array.isArray(observation.evidence)?observation.evidence:[];
  const execution=observation.execution&&typeof observation.execution==='object'?observation.execution:{};
  const sourceRefs=Array.isArray(evalCase.sourceRefs)?evalCase.sourceRefs:[];
  const results=[];

  if(assertions.structuredOutput){
    const expected=assertions.structuredOutput;
    for(const key of expected.requiredKeys||[]){
      const present=hasPath(output,key);
      addAssertion(results,'structuredOutput',`requiredKey:${key}`,present,true,present,'STRUCTURED_OUTPUT_REQUIRED_KEY_MISSING');
    }
    if(Object.prototype.hasOwnProperty.call(expected,'exact')){
      addAssertion(results,'structuredOutput','exact',deepEqual(output,expected.exact),expected.exact,output,'STRUCTURED_OUTPUT_EXACT_MISMATCH');
    }
    if(expected.jsonSchemaSha256){
      const actual=observation.outputSchemaSha256||null;
      addAssertion(results,'structuredOutput','jsonSchemaSha256',
        String(actual||'').toLowerCase()===String(expected.jsonSchemaSha256).toLowerCase(),
        expected.jsonSchemaSha256,actual,'STRUCTURED_OUTPUT_SCHEMA_HASH_MISMATCH');
    }
  }

  if(assertions.evidence){
    const expected=assertions.evidence;
    if(expected.required===true){
      addAssertion(results,'evidence','required',evidence.length>0,true,evidence.length,'EVIDENCE_REQUIRED_MISSING');
    }
    if(expected.minCount!=null){
      addAssertion(results,'evidence','minCount',evidence.length>=Number(expected.minCount),Number(expected.minCount),evidence.length,'EVIDENCE_COUNT_BELOW_MINIMUM');
    }
    if(Array.isArray(expected.allowedSourceFileIds)){
      const allowed=new Set(expected.allowedSourceFileIds.map(String));
      const actual=evidence.map(item=>item?.sourceFileId??null);
      addAssertion(results,'evidence','allowedSourceFileIds',
        actual.every(id=>id!=null&&allowed.has(String(id))),expected.allowedSourceFileIds,actual,'EVIDENCE_SOURCE_NOT_ALLOWED');
    }
    if(expected.requireContentHash===true){
      const refs=new Map(sourceRefs.map(ref=>[String(ref.sourceFileId),String(ref.contentSha256||'').toLowerCase()]));
      const actual=evidence.map(item=>({sourceFileId:item?.sourceFileId??null,contentSha256:item?.contentSha256??null}));
      const pass=evidence.length>0&&evidence.every(item=>{
        const sourceId=item?.sourceFileId==null?null:String(item.sourceFileId);
        const hash=String(item?.contentSha256||'').toLowerCase();
        return sourceId&&SHA64.test(hash)&&refs.get(sourceId)===hash;
      });
      addAssertion(results,'evidence','contentHashes',pass,true,actual,'EVIDENCE_CONTENT_HASH_MISMATCH');
    }
  }

  if(assertions.router){
    for(const key of ['matched','policyResult','routeRuleKey','selectedProviderKey','selectedModelKey','providerHealthStatus']){
      if(Object.prototype.hasOwnProperty.call(assertions.router,key)){
        addAssertion(results,'router',key,deepEqual(route[key],assertions.router[key]),
          assertions.router[key],route[key],`ROUTER_${key.toUpperCase()}_MISMATCH`);
      }
    }
  }

  if(assertions.execution){
    const expected=assertions.execution;
    if(Object.prototype.hasOwnProperty.call(expected,'status')){
      addAssertion(results,'execution','status',String(execution.status||'')===String(expected.status),
        expected.status,execution.status||null,'EXECUTION_STATUS_MISMATCH');
    }
    if(expected.maxDurationMs!=null){
      const actual=Number(execution.durationMs);
      addAssertion(results,'execution','maxDurationMs',Number.isFinite(actual)&&actual<=Number(expected.maxDurationMs),
        Number(expected.maxDurationMs),Number.isFinite(actual)?actual:null,'EXECUTION_DURATION_EXCEEDED');
    }
    if(expected.maxEstimatedCost!=null){
      const actual=Number(execution.estimatedCost);
      addAssertion(results,'execution','maxEstimatedCost',Number.isFinite(actual)&&actual<=Number(expected.maxEstimatedCost),
        Number(expected.maxEstimatedCost),Number.isFinite(actual)?actual:null,'EXECUTION_COST_EXCEEDED');
    }
    if(expected.costCurrency!=null){
      addAssertion(results,'execution','costCurrency',String(execution.costCurrency||'')===String(expected.costCurrency),
        expected.costCurrency,execution.costCurrency||null,'EXECUTION_CURRENCY_MISMATCH');
    }
  }
  return results;
};

const executeSyntheticCase=async evalCase=>{
  const replay=evalCase.replayInput||{};
  const observation=replay.syntheticObservation&&typeof replay.syntheticObservation==='object'
    ? replay.syntheticObservation:{};
  const routeDecision=routeRuntimeTask(replay);
  const providerPolicy=await selectProviderModel({
    policyMode:replay.policyMode,
    taskType:replay.taskType,
    requiredStructuredOutput:replay.requiredStructuredOutput===true,
    allowedProviderKeys:replay.allowedProviderKeys,
    preferredProviderKey:replay.preferredProviderKey,
    preferredModelKey:replay.preferredModelKey,
    fallbackProviderKeys:replay.fallbackProviderKeys,
    modelKey:replay.modelKey
  });
  const route={
    matched:Boolean(routeDecision.matched),
    routeRuleKey:routeDecision.routeRuleKey,
    routePriority:routeDecision.routePriority,
    agentKey:routeDecision.agentKey,
    skillKey:routeDecision.skillKey,
    toolKey:routeDecision.toolKey,
    routerVersion:routeDecision.routerVersion,
    policyResult:routeDecision.policyResult==='ALLOW'&&providerPolicy.allowed?'ALLOW':'BLOCK',
    policyMode:providerPolicy.policyMode,
    providerPolicyCode:providerPolicy.code,
    selectedProviderKey:providerPolicy.selectedProviderKey||null,
    selectedModelKey:providerPolicy.selectedModelKey||null,
    selectedAdapterKey:providerPolicy.selectedAdapterKey||null,
    providerHealthStatus:providerPolicy.providerHealthStatus||null,
    fallbackChain:providerPolicy.fallbackChain||[]
  };
  const execution={
    status:observation.execution?.status || (route.policyResult==='ALLOW'?'PASS':'FAIL'),
    durationMs:observation.execution?.durationMs==null?0:Number(observation.execution.durationMs),
    estimatedCost:observation.execution?.estimatedCost==null?0:Number(observation.execution.estimatedCost),
    costCurrency:observation.execution?.costCurrency||'USD',
    providerInvoked:false,
    executionMode:'SYNTHETIC_REPLAY'
  };
  const normalized={
    output:observation.output??null,
    outputSchemaSha256:observation.outputSchemaSha256||null,
    evidence:Array.isArray(observation.evidence)?observation.evidence:[],
    execution
  };
  const assertionResults=evaluateAssertions({evalCase,route,observation:normalized});
  const failed=assertionResults.filter(x=>x.status==='FAIL').length;
  return {
    status:failed?'FAIL':'PASS',
    route,observation:normalized,assertionResults,
    assertionSummary:{
      total:assertionResults.length,passed:assertionResults.length-failed,failed,
      failureCodes:assertionResults.filter(x=>x.failureCode).map(x=>x.failureCode)
    }
  };
};

export const getEvalRun=async evalRunId=>{
  const db=getRuntimePool();
  const [runs]=await db.execute('SELECT * FROM eval_runs WHERE id=?',[evalRunId]);
  if(!runs.length) throw errorOf('Eval run not found','EVAL_RUN_NOT_FOUND',404);
  const [caseRows]=await db.execute(
    'SELECT * FROM eval_case_results WHERE eval_run_id=? ORDER BY sequence_no,case_key,id',[evalRunId]
  );
  const ids=caseRows.map(x=>x.id);
  const byCase=new Map();
  if(ids.length){
    const placeholders=ids.map(()=>'?').join(',');
    const [rows]=await db.execute(
      `SELECT * FROM eval_assertion_results WHERE eval_case_result_id IN (${placeholders})
       ORDER BY eval_case_result_id,assertion_group,assertion_key,id`,ids
    );
    for(const row of rows){
      if(!byCase.has(row.eval_case_result_id)) byCase.set(row.eval_case_result_id,[]);
      byCase.get(row.eval_case_result_id).push(normalizeAssertion(row));
    }
  }
  return {...normalizeRun(runs[0]),cases:caseRows.map(row=>({...normalizeCaseResult(row),assertions:byCase.get(row.id)||[]}))};
};

export const runEvalReplayManifest=async(manifestId,{idempotencyKey,runtimeCommitSha=null}={})=>{
  if(!manifestId||!idempotencyKey) throw errorOf('manifestId and idempotencyKey are required','INVALID_EVAL_RUN');
  const resolvedRuntimeSha=String(runtimeCommitSha||resolveEvalRuntimeSha()||'').toLowerCase();
  if(!SHA40.test(resolvedRuntimeSha)) throw errorOf('Active Runtime commit SHA is unavailable','EVAL_RUNTIME_SHA_UNAVAILABLE',503);

  const manifest=await getEvalReplayManifest(manifestId);
  if(resolvedRuntimeSha!==String(manifest.candidateRuntimeSha).toLowerCase()){
    throw errorOf('Active Runtime SHA does not match replay manifest candidate SHA','EVAL_RUNTIME_SHA_MISMATCH',409,{
      activeRuntimeSha:resolvedRuntimeSha,candidateRuntimeSha:manifest.candidateRuntimeSha
    });
  }
  const suiteVersion=await getEvalSuiteVersion(manifest.suiteVersionId);
  if(suiteVersion.status!=='FROZEN'||suiteVersion.fixtureSha256!==manifest.fixtureSha256){
    throw errorOf('Replay manifest no longer matches the frozen fixture','EVAL_REPLAY_FIXTURE_MISMATCH',500);
  }

  const db=getRuntimePool(),connection=await db.getConnection();
  let evalRunId;
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute(
      'SELECT * FROM eval_runs WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      if(row.replay_manifest_id!==manifestId||row.candidate_runtime_sha!==resolvedRuntimeSha){
        throw errorOf('Idempotency key was already used for another eval run','EVAL_RUN_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...await getEvalRun(row.id),idempotent:true};
    }
    evalRunId=randomUUID();
    await connection.execute(
      `INSERT INTO eval_runs
       (id,replay_manifest_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,idempotency_key)
       VALUES (?,?,?,?, 'SYNTHETIC_REPLAY','RUNNING',?)`,
      [evalRunId,manifestId,resolvedRuntimeSha,manifest.baselineRuntimeSha||null,idempotencyKey]
    );
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}

  try{
    const caseHashes=[];
    let passedCases=0,failedCases=0,assertionCount=0,passedAssertions=0,failedAssertions=0;
    for(const evalCase of suiteVersion.cases){
      const result=await executeSyntheticCase(evalCase);
      const caseResultId=randomUUID();
      const resultSha256=sha256({
        evalCaseSha256:evalCase.caseSha256,route:result.route,
        observedOutput:result.observation.output,observedEvidence:result.observation.evidence,
        observedExecution:result.observation.execution,assertionResults:result.assertionResults
      });
      caseHashes.push({caseKey:evalCase.caseKey,sequenceNo:evalCase.sequenceNo,resultSha256});
      if(result.status==='PASS') passedCases++; else failedCases++;
      assertionCount+=result.assertionSummary.total;
      passedAssertions+=result.assertionSummary.passed;
      failedAssertions+=result.assertionSummary.failed;

      const conn=await db.getConnection();
      try{
        await conn.beginTransaction();
        await conn.execute(
          `INSERT INTO eval_case_results
           (id,eval_run_id,eval_case_id,case_key,sequence_no,status,route_json,observed_output_json,
            observed_evidence_json,observed_execution_json,assertion_summary_json,result_sha256)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [caseResultId,evalRunId,evalCase.id,evalCase.caseKey,evalCase.sequenceNo,result.status,
           JSON.stringify(result.route),result.observation.output==null?null:JSON.stringify(result.observation.output),
           JSON.stringify(result.observation.evidence),JSON.stringify(result.observation.execution),
           JSON.stringify(result.assertionSummary),resultSha256]
        );
        for(const item of result.assertionResults){
          await conn.execute(
            `INSERT INTO eval_assertion_results
             (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
             VALUES (?,?,?,?,?,?,?,?)`,
            [randomUUID(),caseResultId,item.group,item.key,item.status,
             item.expected==null?null:JSON.stringify(item.expected),
             item.actual==null?null:JSON.stringify(item.actual),item.failureCode]
          );
        }
        await conn.commit();
      }catch(error){await conn.rollback();throw error;}finally{conn.release();}
    }

    const status=failedCases?'FAIL':'PASS';
    const summary={
      executionMode:'SYNTHETIC_REPLAY',providerInvoked:false,
      fixtureSha256:manifest.fixtureSha256,manifestSha256:manifest.manifestSha256,
      caseCount:suiteVersion.cases.length,passedCaseCount:passedCases,failedCaseCount:failedCases,
      assertionCount,passedAssertionCount:passedAssertions,failedAssertionCount:failedAssertions
    };
    const resultSha256=sha256({
      replayManifestSha256:manifest.manifestSha256,candidateRuntimeSha:resolvedRuntimeSha,status,cases:caseHashes
    });
    await db.execute(
      `UPDATE eval_runs SET status=?,case_count=?,passed_case_count=?,failed_case_count=?,
       assertion_count=?,passed_assertion_count=?,failed_assertion_count=?,result_sha256=?,summary_json=?,
       finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [status,suiteVersion.cases.length,passedCases,failedCases,assertionCount,passedAssertions,
       failedAssertions,resultSha256,JSON.stringify(summary),evalRunId]
    );
    return {...await getEvalRun(evalRunId),idempotent:false};
  }catch(error){
    await db.execute(
      `UPDATE eval_runs SET status='ERROR',summary_json=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [JSON.stringify({errorCode:error.code||'EVAL_RUNNER_ERROR'}),evalRunId]
    );
    throw error;
  }
};
