import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalReplayManifest,getEvalSuiteVersion } from './eval-replay.mjs';
import { runEvalReplayManifest,getEvalRun,resolveEvalRuntimeSha } from './eval-runner.mjs';

const SERVER_SHADOW_TASK_ALLOWLIST=new Set(['SCRIPT_CONTINUITY']);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const normalizeList=value=>{
  if(!Array.isArray(value)||!value.length) throw errorOf('Shadow Eval allowlists must be non-empty arrays','INVALID_SHADOW_POLICY');
  return [...new Set(value.map(x=>String(x).trim()).filter(Boolean))];
};
const rejectSecrets=value=>{
  const text=JSON.stringify(value||{});
  if(/api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token/i.test(text))
    throw errorOf('Shadow Eval metadata must not contain credentials or secrets','SHADOW_SECRET_NOT_ALLOWED');
};
const normalizePolicy=row=>({
  id:row.id,policyKey:row.policy_key,name:row.name,status:row.status,
  maxCasesPerRun:Number(row.max_cases_per_run),maxEstimatedCost:Number(row.max_estimated_cost),
  costCurrency:row.cost_currency,maxDurationMs:Number(row.max_duration_ms),
  allowedTaskTypes:row.allowed_task_types_json,allowedProviderKeys:row.allowed_provider_keys_json,
  allowedModelKeys:row.allowed_model_keys_json,requireTransientContext:Boolean(row.require_transient_context),
  metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeExecution=row=>({
  id:row.id,policyId:row.policy_id,replayManifestId:row.replay_manifest_id,
  executionProjectId:row.execution_project_id,evalRunId:row.eval_run_id||null,
  candidateRuntimeSha:row.candidate_runtime_sha,status:row.status,caseCount:Number(row.case_count),
  actualEstimatedCost:Number(row.actual_estimated_cost),costCurrency:row.cost_currency,
  idempotencyKey:row.idempotency_key,blockedReason:row.blocked_reason||null,
  summary:row.summary_json||null,startedAt:row.started_at,finishedAt:row.finished_at||null,createdAt:row.created_at
});
const loadPolicy=async(db,id,forUpdate=false)=>{
  const [rows]=await db.execute('SELECT * FROM shadow_eval_policies WHERE id=?'+(forUpdate?' FOR UPDATE':''),[id]);
  if(!rows.length) throw errorOf('Shadow Eval policy not found','SHADOW_POLICY_NOT_FOUND',404);
  return rows[0];
};
const loadExecution=async(db,id)=>{
  const [rows]=await db.execute('SELECT * FROM shadow_eval_executions WHERE id=?',[id]);
  if(!rows.length) throw errorOf('Shadow Eval execution not found','SHADOW_EXECUTION_NOT_FOUND',404);
  return rows[0];
};

export const createShadowEvalPolicy=async input=>{
  const maxCases=Number(input?.maxCasesPerRun),maxCost=Number(input?.maxEstimatedCost),maxDuration=Number(input?.maxDurationMs);
  if(!input?.policyKey||!input?.name||!Number.isInteger(maxCases)||maxCases<1||!Number.isFinite(maxCost)||maxCost<=0||!Number.isFinite(maxDuration)||maxDuration<=0)
    throw errorOf('policyKey, name and positive case/cost/duration limits are required','INVALID_SHADOW_POLICY');
  const tasks=normalizeList(input.allowedTaskTypes),providers=normalizeList(input.allowedProviderKeys),models=normalizeList(input.allowedModelKeys);
  for(const task of tasks) if(!SERVER_SHADOW_TASK_ALLOWLIST.has(task))
    throw errorOf('Task type is not server-approved for Shadow Eval','SHADOW_TASK_NOT_SERVER_APPROVED',409,{taskType:task});
  rejectSecrets(input.metadata);
  const db=getRuntimePool(),id=randomUUID(),currency=String(input.costCurrency||'USD').toUpperCase();
  await db.execute(
    'INSERT INTO shadow_eval_policies (id,policy_key,name,status,max_cases_per_run,max_estimated_cost,cost_currency,max_duration_ms,allowed_task_types_json,allowed_provider_keys_json,allowed_model_keys_json,require_transient_context,metadata_json) VALUES (?,?,?,\'ACTIVE\',?,?,?,?,?,?,?,?,?)',
    [id,String(input.policyKey),String(input.name),maxCases,maxCost,currency,maxDuration,JSON.stringify(tasks),JSON.stringify(providers),JSON.stringify(models),input.requireTransientContext===false?0:1,asJson(input.metadata||null)]
  );
  return normalizePolicy(await loadPolicy(db,id));
};

export const listShadowEvalPolicies=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM shadow_eval_policies ORDER BY policy_key,id');
  return rows.map(normalizePolicy);
};

export const setShadowEvalPolicyStatus=async(id,status)=>{
  const normalized=String(status||'').toUpperCase();
  if(!['ACTIVE','PAUSED'].includes(normalized)) throw errorOf('status must be ACTIVE or PAUSED','INVALID_SHADOW_POLICY_STATUS');
  const db=getRuntimePool();await loadPolicy(db,id);
  await db.execute('UPDATE shadow_eval_policies SET status=? WHERE id=?',[normalized,id]);
  return normalizePolicy(await loadPolicy(db,id));
};

const validatePreflight=({policy,manifest,version})=>{
  if(policy.status!=='ACTIVE') throw errorOf('Shadow Eval policy is paused','SHADOW_POLICY_PAUSED',409);
  if(version.status!=='FROZEN'||version.fixtureSha256!==manifest.fixtureSha256) throw errorOf('Shadow Eval requires an intact frozen fixture','SHADOW_FIXTURE_NOT_FROZEN',409);
  if(version.cases.length>Number(policy.max_cases_per_run)) throw errorOf('Shadow Eval case count exceeds policy limit','SHADOW_CASE_LIMIT_EXCEEDED',409);
  const tasks=new Set(policy.allowed_task_types_json||[]),providers=new Set(policy.allowed_provider_keys_json||[]),models=new Set(policy.allowed_model_keys_json||[]);
  let declaredCost=0,declaredDuration=0;
  for(const item of version.cases){
    const input=item.replayInput||{},execution=item.assertions?.execution||{};
    if(!tasks.has(String(input.taskType||''))) throw errorOf('Eval case task type is outside Shadow policy','SHADOW_TASK_NOT_ALLOWED',409,{caseKey:item.caseKey});
    if(input.preferredProviderKey&&!providers.has(String(input.preferredProviderKey))) throw errorOf('Preferred provider is outside Shadow policy','SHADOW_PROVIDER_NOT_ALLOWED',409,{caseKey:item.caseKey});
    if(Array.isArray(input.allowedProviderKeys)&&input.allowedProviderKeys.some(x=>!providers.has(String(x)))) throw errorOf('Eval provider allowlist exceeds Shadow policy','SHADOW_PROVIDER_NOT_ALLOWED',409,{caseKey:item.caseKey});
    if(input.preferredModelKey&&!models.has(String(input.preferredModelKey))) throw errorOf('Preferred model is outside Shadow policy','SHADOW_MODEL_NOT_ALLOWED',409,{caseKey:item.caseKey});
    if(execution.maxEstimatedCost==null||!Number.isFinite(Number(execution.maxEstimatedCost))||Number(execution.maxEstimatedCost)<0) throw errorOf('Shadow cases require execution.maxEstimatedCost','SHADOW_CASE_COST_BOUND_REQUIRED',409,{caseKey:item.caseKey});
    if(String(execution.costCurrency||'').toUpperCase()!==String(policy.cost_currency).toUpperCase()) throw errorOf('Shadow case cost currency must match policy','SHADOW_COST_CURRENCY_MISMATCH',409,{caseKey:item.caseKey});
    if(execution.maxDurationMs==null||!Number.isFinite(Number(execution.maxDurationMs))||Number(execution.maxDurationMs)<0) throw errorOf('Shadow cases require execution.maxDurationMs','SHADOW_CASE_DURATION_BOUND_REQUIRED',409,{caseKey:item.caseKey});
    declaredCost+=Number(execution.maxEstimatedCost);declaredDuration+=Number(execution.maxDurationMs);
  }
  if(declaredCost>Number(policy.max_estimated_cost)+1e-12) throw errorOf('Declared Shadow cost exceeds policy','SHADOW_DECLARED_COST_LIMIT_EXCEEDED',409);
  if(declaredDuration>Number(policy.max_duration_ms)) throw errorOf('Declared Shadow duration exceeds policy','SHADOW_DECLARED_DURATION_LIMIT_EXCEEDED',409);
  return {
    allowedTaskTypes:[...(policy.allowed_task_types_json||[])],
    allowedProviderKeys:[...(policy.allowed_provider_keys_json||[])],
    allowedModelKeys:[...(policy.allowed_model_keys_json||[])],
    requireTransientContext:Boolean(policy.require_transient_context),
    maxEstimatedCost:Number(policy.max_estimated_cost),costCurrency:policy.cost_currency,maxDurationMs:Number(policy.max_duration_ms),
    declaredCost,declaredDurationMs:declaredDuration
  };
};

const verifyUsageIsolation=async(db,evalRun)=>{
  const runIds=(evalRun.cases||[]).map(x=>x.runtimeRunId).filter(Boolean);
  if(!runIds.length) return {usageCount:0,shadowUsageCount:0,estimatedCost:0,currencies:[]};
  const placeholders=runIds.map(()=>'?').join(',');
  const [rows]=await db.execute('SELECT usage_class,cost_status,estimated_cost,cost_currency FROM usage_ledger WHERE run_id IN ('+placeholders+')',runIds);
  const currencies=[...new Set(rows.filter(x=>x.cost_status==='CALCULATED'&&x.cost_currency).map(x=>x.cost_currency))];
  return {
    usageCount:rows.length,shadowUsageCount:rows.filter(x=>x.usage_class==='SHADOW').length,
    estimatedCost:rows.reduce((sum,x)=>sum+(x.cost_status==='CALCULATED'?Number(x.estimated_cost||0):0),0),currencies
  };
};

export const runShadowEval=async input=>{
  if(!input?.policyId||!input?.replayManifestId||!input?.executionProjectId||!input?.idempotencyKey)
    throw errorOf('policyId, replayManifestId, executionProjectId and idempotencyKey are required','INVALID_SHADOW_EXECUTION');
  const runtimeSha=String(resolveEvalRuntimeSha()||'').toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(runtimeSha)) throw errorOf('Active Runtime commit SHA is unavailable','EVAL_RUNTIME_SHA_UNAVAILABLE',503);
  const db=getRuntimePool(),connection=await db.getConnection();
  let shadowId,policy,manifest,version,shadowPolicy;
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT * FROM shadow_eval_executions WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[input.idempotencyKey]);
    if(existing.length){
      const row=existing[0];
      const same=row.policy_id===input.policyId&&row.replay_manifest_id===input.replayManifestId&&row.execution_project_id===input.executionProjectId&&row.candidate_runtime_sha===runtimeSha;
      if(!same) throw errorOf('Shadow idempotency key conflicts with another execution','SHADOW_IDEMPOTENCY_CONFLICT',409);
      await connection.commit();return await getShadowEvalExecution(row.id);
    }
    policy=await loadPolicy(connection,input.policyId,true);
    manifest=await getEvalReplayManifest(input.replayManifestId);
    if(String(manifest.candidateRuntimeSha).toLowerCase()!==runtimeSha) throw errorOf('Shadow manifest must target active Runtime SHA','SHADOW_RUNTIME_SHA_MISMATCH',409,{activeRuntimeSha:runtimeSha,candidateRuntimeSha:manifest.candidateRuntimeSha});
    version=await getEvalSuiteVersion(manifest.suiteVersionId);
    shadowPolicy=validatePreflight({policy,manifest,version});
    shadowId=randomUUID();
    await connection.execute(
      'INSERT INTO shadow_eval_executions (id,policy_id,replay_manifest_id,execution_project_id,candidate_runtime_sha,status,case_count,actual_estimated_cost,cost_currency,idempotency_key,summary_json) VALUES (?,?,?,?,?,\'RUNNING\',?,0,?,?,?)',
      [shadowId,input.policyId,input.replayManifestId,input.executionProjectId,runtimeSha,version.cases.length,policy.cost_currency,input.idempotencyKey,JSON.stringify({declaredCost:shadowPolicy.declaredCost,declaredDurationMs:shadowPolicy.declaredDurationMs,sourceBodyPersisted:false,billable:false})]
    );
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}

  try{
    const evalRun=await runEvalReplayManifest(input.replayManifestId,{
      idempotencyKey:'shadow:'+shadowId,runtimeCommitSha:runtimeSha,executionProjectId:input.executionProjectId,
      contextsByCaseKey:input.contextsByCaseKey||{},executionMode:'SHADOW_EVAL',shadowPolicy
    });
    const isolation=await verifyUsageIsolation(db,evalRun);
    const isolationPass=isolation.usageCount===isolation.shadowUsageCount;
    const currencyPass=isolation.currencies.length===0||(isolation.currencies.length===1&&isolation.currencies[0]===policy.cost_currency);
    const budgetPass=isolation.estimatedCost<=Number(policy.max_estimated_cost)+1e-12;
    const status=isolationPass&&currencyPass&&budgetPass&&evalRun.status==='PASS'?'PASS':'FAIL';
    let blockedReason=null;
    if(!isolationPass) blockedReason='SHADOW_BILLING_ISOLATION_BREACH';
    else if(!currencyPass) blockedReason='SHADOW_ACTUAL_CURRENCY_MISMATCH';
    else if(!budgetPass) blockedReason='SHADOW_ACTUAL_COST_LIMIT_EXCEEDED';
    else if(evalRun.status!=='PASS') blockedReason='SHADOW_EVAL_ASSERTION_FAILED';
    if(!isolationPass||!currencyPass||!budgetPass) await db.execute("UPDATE shadow_eval_policies SET status='PAUSED' WHERE id=?",[input.policyId]);
    const summary={evalRunStatus:evalRun.status,usageCount:isolation.usageCount,shadowUsageCount:isolation.shadowUsageCount,actualEstimatedCost:isolation.estimatedCost,currencies:isolation.currencies,billingIsolationPass:isolationPass,budgetPass,currencyPass,sourceBodyPersisted:false,billable:false};
    await db.execute('UPDATE shadow_eval_executions SET eval_run_id=?,status=?,actual_estimated_cost=?,blocked_reason=?,summary_json=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?',[evalRun.id,status,isolation.estimatedCost,blockedReason,JSON.stringify(summary),shadowId]);
    return await getShadowEvalExecution(shadowId);
  }catch(error){
    await db.execute('UPDATE shadow_eval_executions SET status=\'ERROR\',blocked_reason=?,summary_json=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?',[error.code||'SHADOW_EXECUTION_ERROR',JSON.stringify({sourceBodyPersisted:false,billable:false}),shadowId]);
    throw error;
  }
};

export const getShadowEvalExecution=async id=>{
  const db=getRuntimePool(),row=await loadExecution(db,id);
  const evalRun=row.eval_run_id?await getEvalRun(row.eval_run_id):null;
  return {...normalizeExecution(row),evalRun};
};

export const SHADOW_EVAL_SERVER_TASK_ALLOWLIST=[...SERVER_SHADOW_TASK_ALLOWLIST];
