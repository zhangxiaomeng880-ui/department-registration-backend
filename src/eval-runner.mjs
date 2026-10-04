import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool, createRun, createTask, updateTask } from './runtime-db.mjs';
import { routeAndRecord } from './runtime-evidence.mjs';
import { executeScriptContinuityAgent, CONTINUITY_ANALYSIS_SCHEMA } from './autonomous-agent.mjs';
import { getRunObservability } from './runtime-observability.mjs';
import { getEvalReplayManifest, getEvalSuiteVersion } from './eval-replay.mjs';

const sha40=/^[a-f0-9]{40}$/i;
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
const asJson=value=>value==null?null:JSON.stringify(value);
const schemaSha256=sha256(CONTINUITY_ANALYSIS_SCHEMA);
const trimTaskKey=value=>String(value||'case').replace(/[^a-zA-Z0-9._:-]/g,'-').slice(0,96);
export const resolveEvalRuntimeSha=()=>(
  process.env.RUNTIME_COMMIT_SHA ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  null
);

const normalizeRun=row=>({
  id:row.id,replayManifestId:row.replay_manifest_id,executionProjectId:row.execution_project_id,
  candidateRuntimeSha:row.candidate_runtime_sha,baselineRuntimeSha:row.baseline_runtime_sha||null,
  executionMode:row.execution_mode,status:row.status,caseCount:Number(row.case_count),
  passedCaseCount:Number(row.passed_case_count),failedCaseCount:Number(row.failed_case_count),
  assertionCount:Number(row.assertion_count),passedAssertionCount:Number(row.passed_assertion_count),
  failedAssertionCount:Number(row.failed_assertion_count),resultSha256:row.result_sha256||null,
  summary:row.summary_json||null,idempotencyKey:row.idempotency_key,
  startedAt:row.started_at,finishedAt:row.finished_at||null,createdAt:row.created_at
});
const normalizeCaseResult=row=>({
  id:row.id,evalRunId:row.eval_run_id,evalCaseId:row.eval_case_id,caseKey:row.case_key,
  sequenceNo:Number(row.sequence_no),runtimeRunId:row.runtime_run_id||null,status:row.status,
  route:row.route_json||null,observedOutput:row.observed_output_json||null,
  observedEvidence:row.observed_evidence_json||[],observedExecution:row.observed_execution_json||null,
  assertionSummary:row.assertion_summary_json,errorCode:row.error_code||null,
  resultSha256:row.result_sha256,startedAt:row.started_at,finishedAt:row.finished_at
});
const normalizeAssertion=row=>({
  id:row.id,evalCaseResultId:row.eval_case_result_id,group:row.assertion_group,
  key:row.assertion_key,status:row.status,expected:row.expected_json,actual:row.actual_json,
  failureCode:row.failure_code||null,createdAt:row.created_at
});
const addAssertion=(items,group,key,pass,expected,actual,failureCode)=>items.push({
  group,key,status:pass?'PASS':'FAIL',expected:expected===undefined?null:expected,
  actual:actual===undefined?null:actual,failureCode:pass?null:failureCode
});

const validateTransientContext=(evalCase,provided)=>{
  const refs=Array.isArray(evalCase.sourceRefs)?evalCase.sourceRefs:[];
  if(!refs.length){
    if(Array.isArray(provided)&&provided.length) throw errorOf(
      'Context was supplied for a fixture with no source references','EVAL_UNEXPECTED_CONTEXT',409,{caseKey:evalCase.caseKey}
    );
    return [];
  }
  if(!Array.isArray(provided)) throw errorOf(
    'Transient context is required for this eval case','EVAL_CONTEXT_REQUIRED',409,{caseKey:evalCase.caseKey}
  );
  const byId=new Map();
  for(const item of provided){
    if(!item?.sourceFileId||typeof item?.sourceText!=='string') throw errorOf(
      'Each transient context item requires sourceFileId and sourceText','INVALID_EVAL_CONTEXT',400,{caseKey:evalCase.caseKey}
    );
    if(byId.has(String(item.sourceFileId))) throw errorOf(
      'Duplicate transient sourceFileId','INVALID_EVAL_CONTEXT',400,{caseKey:evalCase.caseKey,sourceFileId:item.sourceFileId}
    );
    byId.set(String(item.sourceFileId),item);
  }
  if(byId.size!==refs.length) throw errorOf(
    'Transient context count does not match frozen source references','EVAL_CONTEXT_SET_MISMATCH',409,{caseKey:evalCase.caseKey}
  );
  return refs.map(ref=>{
    const item=byId.get(String(ref.sourceFileId));
    if(!item) throw errorOf(
      'Frozen source reference is missing from transient context','EVAL_CONTEXT_SET_MISMATCH',409,
      {caseKey:evalCase.caseKey,sourceFileId:ref.sourceFileId}
    );
    const actualHash=sha256(item.sourceText);
    if(actualHash!==String(ref.contentSha256).toLowerCase()) throw errorOf(
      'Transient source text does not match frozen content SHA-256','EVAL_CONTEXT_HASH_MISMATCH',409,
      {caseKey:evalCase.caseKey,sourceFileId:ref.sourceFileId,expected:ref.contentSha256,actual:actualHash}
    );
    return {
      sourceFileId:ref.sourceFileId,sourceVersion:ref.sourceVersion||null,
      sourceStatus:item.sourceStatus||'CURRENT',sourcePath:item.sourcePath||null,
      lineStart:ref.lineStart??null,lineEnd:ref.lineEnd??null,sourceText:item.sourceText
    };
  });
};

const enrichEvidence=(output,refs)=>{
  const refMap=new Map((refs||[]).map(ref=>[String(ref.sourceFileId),ref]));
  const rows=[];
  for(const finding of output?.findings||[]){
    for(const evidence of finding?.evidence||[]){
      const ref=refMap.get(String(evidence?.sourceFileId));
      const versionMatches=ref
        ? String(evidence?.sourceVersion??'')===String(ref.sourceVersion??'')
        : false;
      const lineStartValid=ref && (evidence?.lineStart==null||ref.lineStart==null||Number(evidence.lineStart)>=Number(ref.lineStart));
      const lineEndValid=ref && (evidence?.lineEnd==null||ref.lineEnd==null||Number(evidence.lineEnd)<=Number(ref.lineEnd));
      rows.push({
        sourceFileId:evidence?.sourceFileId??null,
        sourceVersion:evidence?.sourceVersion??null,
        lineStart:evidence?.lineStart??null,
        lineEnd:evidence?.lineEnd??null,
        contentSha256:ref?.contentSha256||null,
        provenanceValid:Boolean(ref&&versionMatches&&lineStartValid&&lineEndValid)
      });
    }
  }
  return rows;
};
const outputSummary=output=>({
  topLevelKeys:output&&typeof output==='object'&&!Array.isArray(output)?Object.keys(output).sort():[],
  findingCount:Number.isInteger(output?.findingCount)?output.findingCount:null,
  error:typeof output?.error==='string'?output.error:null,
  outputSha256:output==null?null:sha256(output)
});

const evaluateAssertions=({evalCase,route,output,evidence,execution})=>{
  const assertions=evalCase.assertions||{},results=[];
  if(assertions.structuredOutput){
    const expected=assertions.structuredOutput;
    for(const key of expected.requiredKeys||[]){
      const has=output!=null&&typeof output==='object'&&Object.prototype.hasOwnProperty.call(output,key);
      addAssertion(results,'structuredOutput',`requiredKey:${key}`,has,true,has,'STRUCTURED_OUTPUT_REQUIRED_KEY_MISSING');
    }
    if(Object.prototype.hasOwnProperty.call(expected,'exact')){
      const pass=stableJson(output)===stableJson(expected.exact);
      addAssertion(results,'structuredOutput','exact',pass,
        {sha256:sha256(expected.exact)},{sha256:output==null?null:sha256(output)},'STRUCTURED_OUTPUT_EXACT_MISMATCH');
    }
    if(expected.jsonSchemaSha256){
      addAssertion(results,'structuredOutput','jsonSchemaSha256',
        String(expected.jsonSchemaSha256).toLowerCase()===schemaSha256,
        String(expected.jsonSchemaSha256).toLowerCase(),schemaSha256,'STRUCTURED_OUTPUT_SCHEMA_HASH_MISMATCH');
    }
  }
  if(assertions.evidence){
    const expected=assertions.evidence;
    if(expected.required===true) addAssertion(results,'evidence','required',evidence.length>0,true,evidence.length,'EVIDENCE_REQUIRED_MISSING');
    if(expected.required===false) addAssertion(results,'evidence','required',true,false,evidence.length,null);
    if(expected.minCount!=null) addAssertion(results,'evidence','minCount',
      evidence.length>=Number(expected.minCount),Number(expected.minCount),evidence.length,'EVIDENCE_COUNT_BELOW_MINIMUM');
    if(Array.isArray(expected.allowedSourceFileIds)){
      const allowed=new Set(expected.allowedSourceFileIds.map(String));
      const actual=evidence.map(x=>x.sourceFileId);
      addAssertion(results,'evidence','allowedSourceFileIds',
        actual.every(id=>id!=null&&allowed.has(String(id))),expected.allowedSourceFileIds,actual,'EVIDENCE_SOURCE_NOT_ALLOWED');
    }
    if(expected.requireContentHash===true){
      const pass=evidence.length>0&&evidence.every(item=>
        /^[a-f0-9]{64}$/i.test(item.contentSha256||'')&&item.provenanceValid===true
      );
      addAssertion(results,'evidence','contentHashes',pass,true,
        evidence.map(x=>({sourceFileId:x.sourceFileId,contentSha256:x.contentSha256})),'EVIDENCE_CONTENT_HASH_MISMATCH');
    }
  }
  if(assertions.router){
    for(const key of ['matched','policyResult','routeRuleKey','selectedProviderKey','selectedModelKey','providerHealthStatus']){
      if(Object.prototype.hasOwnProperty.call(assertions.router,key)){
        addAssertion(results,'router',key,
          stableJson(route?.[key])===stableJson(assertions.router[key]),assertions.router[key],route?.[key]??null,
          `ROUTER_${key.toUpperCase()}_MISMATCH`);
      }
    }
  }
  if(assertions.execution){
    const expected=assertions.execution;
    if(Object.prototype.hasOwnProperty.call(expected,'status')) addAssertion(
      results,'execution','status',String(execution.status)===String(expected.status),expected.status,execution.status,'EXECUTION_STATUS_MISMATCH'
    );
    if(expected.maxDurationMs!=null) addAssertion(
      results,'execution','maxDurationMs',Number(execution.durationMs)<=Number(expected.maxDurationMs),
      Number(expected.maxDurationMs),Number(execution.durationMs),'EXECUTION_DURATION_EXCEEDED'
    );
    if(expected.maxEstimatedCost!=null) addAssertion(
      results,'execution','maxEstimatedCost',
      execution.costStatus==='CALCULATED'&&Number(execution.estimatedCost)<=Number(expected.maxEstimatedCost),
      Number(expected.maxEstimatedCost),{estimatedCost:execution.estimatedCost,costStatus:execution.costStatus},'EXECUTION_COST_EXCEEDED'
    );
    if(expected.costCurrency!=null) addAssertion(
      results,'execution','costCurrency',String(execution.costCurrency||'')===String(expected.costCurrency),
      expected.costCurrency,execution.costCurrency||null,'EXECUTION_CURRENCY_MISMATCH'
    );
  }
  addAssertion(results,'privacy','sourceBodyExposed',execution.sourceBodyExposed===false,false,execution.sourceBodyExposed,'SOURCE_BODY_EXPOSED');
  return results;
};

const finalizeRuntimeRun=async(runId,status,errorCode=null)=>{
  const db=getRuntimePool();
  await db.execute('UPDATE runs SET status=?,error_code=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?',[status,errorCode,runId]);
};
const executionFromObservability=observability=>{
  const currencies=[...new Set((observability?.usage||[]).map(x=>x.costCurrency).filter(Boolean))];
  return {
    status:observability?.run?.status||'FAIL',
    durationMs:Number(observability?.summary?.toolDurationMs||0),
    estimatedCost:Number(observability?.summary?.estimatedCost||0),
    costStatus:observability?.summary?.costStatus||'UNKNOWN',
    costCurrency:currencies.length===1?currencies[0]:currencies.length===0?null:'MIXED',
    tokenInput:Number(observability?.summary?.tokenInput||0),
    tokenOutput:Number(observability?.summary?.tokenOutput||0),
    sourceBodyExposed:Boolean(observability?.summary?.sourceBodyExposed)
  };
};

const executeCase=async({evalRunId,evalCase,manifest,executionProjectId,transientContexts})=>{
  const db=getRuntimePool();
  let runtimeRunId=null,route=null,output=null,errorCode=null;
  try{
    const run=await createRun({
      projectId:executionProjectId,runType:'EVAL_REPLAY',triggerSource:'EVAL_RUNNER',
      input:{evalRunId,manifestId:manifest.id,caseKey:evalCase.caseKey,caseSha256:evalCase.caseSha256,sourceBodyPersisted:false},
      runtimeCommitSha:manifest.candidateRuntimeSha,workflowVersion:manifest.workflowVersion||'eval-runner-v1',
      routerVersion:manifest.routerVersion||'policy-router-v2',ragIndexVersion:manifest.ragIndexVersion||null,status:'RUNNING'
    });
    runtimeRunId=run.id;
    const task=await createTask({
      runId:run.id,stageKey:'EVAL',taskKey:`eval-${trimTaskKey(evalCase.caseKey)}`,
      taskType:evalCase.replayInput.taskType,sequenceNo:1,
      input:{caseKey:evalCase.caseKey,caseSha256:evalCase.caseSha256,sourceBodyPersisted:false}
    });
    route=await routeAndRecord({
      runId:run.id,taskId:task.id,correlationId:run.correlationId,
      projectType:evalCase.replayInput.projectType,taskType:evalCase.replayInput.taskType,
      query:evalCase.replayInput.query,executionMode:'EVAL_REPLAY',
      policyMode:evalCase.replayInput.policyMode,requiredStructuredOutput:evalCase.replayInput.requiredStructuredOutput===true,
      allowedProviderKeys:evalCase.replayInput.allowedProviderKeys,preferredProviderKey:evalCase.replayInput.preferredProviderKey,
      preferredModelKey:evalCase.replayInput.preferredModelKey,fallbackProviderKeys:evalCase.replayInput.fallbackProviderKeys,
      modelKey:evalCase.replayInput.modelKey
    });
    if(!route.matched||route.policyResult!=='ALLOW'){
      output={error:'ROUTE_NOT_ALLOWED',providerPolicyCode:route.providerPolicyCode||null};
      errorCode='ROUTE_NOT_ALLOWED';
      await updateTask(task.id,{status:'FAIL',output:{error:'ROUTE_NOT_ALLOWED'},errorCode,finished:true});
      await finalizeRuntimeRun(run.id,'FAIL',errorCode);
    }else{
      const contextItems=validateTransientContext(evalCase,transientContexts);
      if(!contextItems.length) throw errorOf(
        'Allowed provider execution requires frozen transient context','EVAL_CONTEXT_REQUIRED_FOR_ALLOWED_ROUTE',409,{caseKey:evalCase.caseKey}
      );
      const agent=await executeScriptContinuityAgent({
        runId:run.id,taskId:task.id,routeExecutionId:route.id,correlationId:run.correlationId,
        routeRuleKey:route.routeRuleKey,selectedProviderKey:route.selectedProviderKey,
        selectedModelKey:route.selectedModelKey,selectedAdapterKey:route.selectedAdapterKey,
        query:evalCase.replayInput.query,scope:evalCase.replayInput.scope||null,
        contextPacket:{precedence:evalCase.replayInput.precedence||[],items:contextItems}
      });
      output=agent.output;
      await updateTask(task.id,{status:'PASS',output:{
        executionMode:'EVAL_REPLAY',providerResponseId:agent.providerResponseId,
        findingCount:agent.output?.findingCount??null,sourceBodyPersisted:false
      },finished:true});
      await finalizeRuntimeRun(run.id,'PASS',null);
    }
  }catch(error){
    errorCode=error.code||'EVAL_CASE_EXECUTION_ERROR';
    if(runtimeRunId){try{await finalizeRuntimeRun(runtimeRunId,'FAIL',errorCode);}catch{}}
  }

  let observability=null;
  if(runtimeRunId){try{observability=await getRunObservability(runtimeRunId);}catch{}}
  const execution=executionFromObservability(observability);
  if(errorCode&&execution.status!=='FAIL') execution.status='FAIL';
  const evidence=enrichEvidence(output,evalCase.sourceRefs||[]);
  const routeSummary=route?{
    matched:Boolean(route.matched),policyResult:route.policyResult||null,routeRuleKey:route.routeRuleKey||null,
    policyMode:route.policyMode||null,selectedProviderKey:route.selectedProviderKey||null,
    selectedModelKey:route.selectedModelKey||null,selectedAdapterKey:route.selectedAdapterKey||null,
    providerHealthStatus:route.providerHealthStatus||null
  }:null;
  const assertionResults=evaluateAssertions({evalCase,route:routeSummary,output,evidence,execution});
  if(errorCode) addAssertion(assertionResults,'runner','internalError',false,null,errorCode,errorCode);
  const failed=assertionResults.filter(x=>x.status==='FAIL').length;
  const status=failed?'FAIL':'PASS';
  const summary={total:assertionResults.length,passed:assertionResults.length-failed,failed,
    failureCodes:assertionResults.filter(x=>x.failureCode).map(x=>x.failureCode)};
  const observedOutput=outputSummary(output);
  const resultSha256=sha256({
    evalCaseSha256:evalCase.caseSha256,runtimeRunId,status,route:routeSummary,
    observedOutput,observedEvidence:evidence,observedExecution:execution,assertionResults,errorCode
  });
  const caseResultId=randomUUID(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO eval_case_results
       (id,eval_run_id,eval_case_id,case_key,sequence_no,runtime_run_id,status,route_json,
        observed_output_json,observed_evidence_json,observed_execution_json,assertion_summary_json,error_code,result_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [caseResultId,evalRunId,evalCase.id,evalCase.caseKey,evalCase.sequenceNo,runtimeRunId,status,
       asJson(routeSummary),asJson(observedOutput),asJson(evidence),asJson(execution),asJson(summary),errorCode,resultSha256]
    );
    for(const item of assertionResults){
      await conn.execute(
        `INSERT INTO eval_assertion_results
         (id,eval_case_result_id,assertion_group,assertion_key,status,expected_json,actual_json,failure_code)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(),caseResultId,item.group,item.key,item.status,asJson(item.expected),asJson(item.actual),item.failureCode]
      );
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  return {caseResultId,caseKey:evalCase.caseKey,sequenceNo:evalCase.sequenceNo,status,resultSha256,assertionSummary:summary};
};

export const getEvalRun=async evalRunId=>{
  const db=getRuntimePool();
  const [runs]=await db.execute('SELECT * FROM eval_runs WHERE id=?',[evalRunId]);
  if(!runs.length) throw errorOf('Eval run not found','EVAL_RUN_NOT_FOUND',404);
  const [caseRows]=await db.execute('SELECT * FROM eval_case_results WHERE eval_run_id=? ORDER BY sequence_no,case_key,id',[evalRunId]);
  const ids=caseRows.map(x=>x.id),byCase=new Map();
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

export const runEvalReplayManifest=async(manifestId,{
  idempotencyKey,runtimeCommitSha=null,executionProjectId,contextsByCaseKey={}
}={})=>{
  if(!manifestId||!idempotencyKey||!executionProjectId) throw errorOf(
    'manifestId, idempotencyKey and executionProjectId are required','INVALID_EVAL_RUN'
  );
  const resolvedRuntimeSha=String(runtimeCommitSha||resolveEvalRuntimeSha()||'').toLowerCase();
  if(!sha40.test(resolvedRuntimeSha)) throw errorOf('Active Runtime commit SHA is unavailable','EVAL_RUNTIME_SHA_UNAVAILABLE',503);
  const manifest=await getEvalReplayManifest(manifestId);
  if(resolvedRuntimeSha!==String(manifest.candidateRuntimeSha).toLowerCase()) throw errorOf(
    'Active Runtime SHA does not match replay manifest candidate SHA','EVAL_RUNTIME_SHA_MISMATCH',409,
    {activeRuntimeSha:resolvedRuntimeSha,candidateRuntimeSha:manifest.candidateRuntimeSha}
  );
  const suiteVersion=await getEvalSuiteVersion(manifest.suiteVersionId);
  if(suiteVersion.status!=='FROZEN'||suiteVersion.fixtureSha256!==manifest.fixtureSha256) throw errorOf(
    'Replay manifest no longer matches the frozen fixture','EVAL_REPLAY_FIXTURE_MISMATCH',500
  );

  const db=getRuntimePool(),connection=await db.getConnection();
  let evalRunId;
  try{
    await connection.beginTransaction();
    const [projects]=await connection.execute('SELECT id,status FROM projects WHERE id=? FOR UPDATE',[executionProjectId]);
    if(!projects.length) throw errorOf('Execution project not found','PROJECT_NOT_FOUND',404);
    if(projects[0].status!=='ACTIVE') throw errorOf('Execution project is not active','PROJECT_NOT_ACTIVE',409);
    const [existing]=await connection.execute('SELECT * FROM eval_runs WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existing.length){
      const row=existing[0];
      const same=row.replay_manifest_id===manifestId&&row.execution_project_id===executionProjectId&&row.candidate_runtime_sha===resolvedRuntimeSha;
      if(!same) throw errorOf('Idempotency key was already used for another eval run','EVAL_RUN_IDEMPOTENCY_CONFLICT',409);
      await connection.commit();
      return {...await getEvalRun(row.id),idempotent:true};
    }
    evalRunId=randomUUID();
    await connection.execute(
      `INSERT INTO eval_runs
       (id,replay_manifest_id,execution_project_id,candidate_runtime_sha,baseline_runtime_sha,execution_mode,status,idempotency_key)
       VALUES (?,?,?,?,?,'RUNTIME_REPLAY','RUNNING',?)`,
      [evalRunId,manifestId,executionProjectId,resolvedRuntimeSha,manifest.baselineRuntimeSha||null,idempotencyKey]
    );
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}

  try{
    const caseHashes=[];
    let passedCases=0,failedCases=0,assertionCount=0,passedAssertions=0,failedAssertions=0;
    for(const evalCase of suiteVersion.cases){
      const result=await executeCase({
        evalRunId,evalCase,manifest,executionProjectId,transientContexts:contextsByCaseKey?.[evalCase.caseKey]
      });
      caseHashes.push({caseKey:result.caseKey,sequenceNo:result.sequenceNo,resultSha256:result.resultSha256,status:result.status});
      if(result.status==='PASS') passedCases++; else failedCases++;
      assertionCount+=result.assertionSummary.total;
      passedAssertions+=result.assertionSummary.passed;
      failedAssertions+=result.assertionSummary.failed;
    }
    const status=failedCases?'FAIL':'PASS';
    const summary={
      executionMode:'RUNTIME_REPLAY',providerExecution:true,sourceBodyPersisted:false,
      fixtureSha256:manifest.fixtureSha256,manifestSha256:manifest.manifestSha256,
      caseCount:suiteVersion.cases.length,passedCaseCount:passedCases,failedCaseCount:failedCases,
      assertionCount,passedAssertionCount:passedAssertions,failedAssertionCount:failedAssertions
    };
    const resultSha256=sha256({
      replayManifestSha256:manifest.manifestSha256,candidateRuntimeSha:resolvedRuntimeSha,
      executionProjectId,status,cases:caseHashes
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

export const EVAL_ASSERTION_SCHEMA_SHA256=schemaSha256;
