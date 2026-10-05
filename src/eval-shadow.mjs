import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalReplayManifest, getEvalSuiteVersion } from './eval-replay.mjs';
import { runEvalReplayManifest, getEvalRun, resolveEvalRuntimeSha } from './eval-runner.mjs';

const SHA40=/^[a-f0-9]{40}$/i;
const SHA64=/^[a-f0-9]{64}$/i;
const SHADOW_POLICY_VERSION='shadow-safe-v1';
export const INTERNAL_EVAL_TENANT_ID='00000000-0000-4000-8000-000000002401';
export const INTERNAL_EVAL_WORKSPACE_ID='00000000-0000-4000-8000-000000002402';
export const INTERNAL_EVAL_PROJECT_ID='00000000-0000-4000-8000-000000002403';

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

const normalizeShadowProject=row=>({
  projectId:row.project_id,status:row.status,safetyPolicyVersion:row.safety_policy_version,
  createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeShadowReplay=row=>({
  id:row.id,sourceRunId:row.source_run_id,sourceProjectId:row.source_project_id,
  replayManifestId:row.replay_manifest_id,executionProjectId:row.execution_project_id,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  sourceSnapshotSha256:row.source_snapshot_sha256,sourceInputSha256:row.source_input_sha256,
  safetyPolicyVersion:row.safety_policy_version,evalRunId:row.eval_run_id||null,status:row.status,
  safetySummary:row.safety_summary_json||null,shadowSha256:row.shadow_sha256||null,
  idempotencyKey:row.idempotency_key,preparedAt:row.prepared_at,startedAt:row.started_at||null,
  finishedAt:row.finished_at||null,createdAt:row.created_at
});

const loadSourceRun=async(db,runId,lock=false)=>{
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,r.tenant_id,r.workspace_id,r.run_type,r.trigger_source,r.status,r.finished_at,
            r.runtime_commit_sha,r.knowledge_commit_sha,r.workflow_version,r.router_version,r.rag_index_version,r.input_json,
            p.project_type,p.status AS project_status
     FROM runs r JOIN projects p ON p.id=r.project_id
     WHERE r.id=?${lock?' FOR UPDATE':''}`,
    [runId]
  );
  if(!rows.length) throw errorOf('Source Runtime run not found','SHADOW_SOURCE_RUN_NOT_FOUND',404);
  return rows[0];
};
const sourceInputSha=row=>sha256(row.input_json??null);
const sourceSnapshotMaterial=row=>({
  runId:row.id,projectId:row.project_id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  runType:row.run_type,triggerSource:row.trigger_source,status:row.status,
  finishedAt:row.finished_at?new Date(row.finished_at).toISOString():null,
  runtimeCommitSha:row.runtime_commit_sha||null,knowledgeCommitSha:row.knowledge_commit_sha||null,
  workflowVersion:row.workflow_version||null,routerVersion:row.router_version||null,
  ragIndexVersion:row.rag_index_version||null,inputSha256:sourceInputSha(row)
});
const sourceSnapshotSha=row=>sha256(sourceSnapshotMaterial(row));
const assertSourceEligible=row=>{
  if(!['PASS','FAIL'].includes(row.status)||!row.finished_at) throw errorOf(
    'Shadow replay requires a terminal source Runtime run','SHADOW_SOURCE_RUN_NOT_TERMINAL',409,{status:row.status}
  );
  if(!SHA40.test(row.runtime_commit_sha||'')) throw errorOf(
    'Source Runtime run does not have a valid runtime commit SHA','SHADOW_SOURCE_RUNTIME_SHA_INVALID',409
  );
  if(row.project_status!=='ACTIVE') throw errorOf('Source project is not active','SHADOW_SOURCE_PROJECT_NOT_ACTIVE',409);
  if(['EVAL_REPLAY','SHADOW_REPLAY'].includes(String(row.run_type||'').toUpperCase())||
     ['EVAL_RUNNER','SHADOW_EVAL'].includes(String(row.trigger_source||'').toUpperCase())||
     row.tenant_id===INTERNAL_EVAL_TENANT_ID){
    throw errorOf('Shadow source must be a non-eval business Runtime run','SHADOW_SOURCE_IS_EVAL_RUN',409);
  }
};

const assertManifestSafe=async manifest=>{
  const version=await getEvalSuiteVersion(manifest.suiteVersionId);
  if(version.status!=='FROZEN'||version.fixtureSha256!==manifest.fixtureSha256) throw errorOf(
    'Shadow replay requires an intact frozen Eval fixture','SHADOW_FIXTURE_INTEGRITY_MISMATCH',409
  );
  const unsupported=version.cases.filter(x=>String(x.replayInput?.taskType||'').toUpperCase()!=='SCRIPT_CONTINUITY');
  if(unsupported.length) throw errorOf(
    'Shadow-safe policy only allows read-only SCRIPT_CONTINUITY cases','SHADOW_TASK_NOT_READ_ONLY',409,
    {caseKeys:unsupported.map(x=>x.caseKey)}
  );
  return version;
};

const loadShadowReplay=async(db,id,lock=false)=>{
  const [rows]=await db.execute(
    `SELECT * FROM eval_shadow_replays WHERE id=?${lock?' FOR UPDATE':''}`,[id]
  );
  if(!rows.length) throw errorOf('Shadow replay not found','SHADOW_REPLAY_NOT_FOUND',404);
  return rows[0];
};

export const registerShadowEvalProject=async projectId=>{
  const id=projectId||INTERNAL_EVAL_PROJECT_ID;
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [projects]=await connection.execute(
      `SELECT p.id,p.status,p.tenant_id,p.workspace_id,t.plan_key,t.status AS tenant_status,w.status AS workspace_status
       FROM projects p
       JOIN tenants t ON t.id=p.tenant_id
       JOIN workspaces w ON w.id=p.workspace_id
       WHERE p.id=? FOR UPDATE`,[id]
    );
    if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
    const p=projects[0];
    if(p.status!=='ACTIVE'||p.tenant_status!=='ACTIVE'||p.workspace_status!=='ACTIVE') throw errorOf(
      'Shadow eval project scope must be active','SHADOW_PROJECT_NOT_ACTIVE',409
    );
    if(p.tenant_id!==INTERNAL_EVAL_TENANT_ID||p.workspace_id!==INTERNAL_EVAL_WORKSPACE_ID||p.plan_key!=='INTERNAL_EVAL'){
      throw errorOf('Only the isolated INTERNAL_EVAL scope may register Shadow Eval projects','SHADOW_PROJECT_SCOPE_NOT_INTERNAL',409);
    }
    await connection.execute(
      `INSERT INTO eval_shadow_projects (project_id,status,safety_policy_version)
       VALUES (?,'ACTIVE',?)
       ON DUPLICATE KEY UPDATE status='ACTIVE',safety_policy_version=VALUES(safety_policy_version),
         updated_at=CURRENT_TIMESTAMP(6)`,
      [id,SHADOW_POLICY_VERSION]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_shadow_projects WHERE project_id=?',[id]);
    await connection.commit();
    return normalizeShadowProject(rows[0]);
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const listShadowEvalProjects=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT s.* FROM eval_shadow_projects s
     JOIN projects p ON p.id=s.project_id
     WHERE s.status='ACTIVE' AND p.status='ACTIVE'
     ORDER BY s.created_at,s.project_id`
  );
  return rows.map(normalizeShadowProject);
};

export const prepareShadowReplay=async({
  sourceRunId,replayManifestId,executionProjectId=INTERNAL_EVAL_PROJECT_ID,idempotencyKey
}={})=>{
  if(!sourceRunId||!replayManifestId||!idempotencyKey) throw errorOf(
    'sourceRunId, replayManifestId and idempotencyKey are required','INVALID_SHADOW_REPLAY'
  );
  const manifest=await getEvalReplayManifest(replayManifestId);
  await assertManifestSafe(manifest);
  if(!SHA40.test(manifest.candidateRuntimeSha||'')) throw errorOf('Manifest candidate Runtime SHA is invalid','SHADOW_CANDIDATE_SHA_INVALID',409);
  if(!SHA40.test(manifest.baselineRuntimeSha||'')) throw errorOf(
    'Production-safe shadow replay requires baselineRuntimeSha','SHADOW_BASELINE_SHA_REQUIRED',409
  );
  if(String(manifest.candidateRuntimeSha).toLowerCase()===String(manifest.baselineRuntimeSha).toLowerCase()) throw errorOf(
    'Candidate and baseline Runtime SHAs must differ','SHADOW_CANDIDATE_EQUALS_BASELINE',409
  );

  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute(
      'SELECT * FROM eval_shadow_replays WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      const same=row.source_run_id===sourceRunId&&row.replay_manifest_id===replayManifestId&&
        row.execution_project_id===executionProjectId;
      if(!same) throw errorOf('Shadow replay idempotency key conflicts with another request','SHADOW_REPLAY_IDEMPOTENCY_CONFLICT',409);
      await connection.commit();
      return {...normalizeShadowReplay(row),idempotent:true};
    }

    const source=await loadSourceRun(connection,sourceRunId,true);
    assertSourceEligible(source);
    if(String(source.runtime_commit_sha).toLowerCase()!==String(manifest.baselineRuntimeSha).toLowerCase()) throw errorOf(
      'Replay manifest baselineRuntimeSha does not match the source Runtime run','SHADOW_BASELINE_SHA_MISMATCH',409,
      {sourceRuntimeSha:source.runtime_commit_sha,manifestBaselineRuntimeSha:manifest.baselineRuntimeSha}
    );

    const [shadowProjects]=await connection.execute(
      `SELECT s.project_id,s.status,s.safety_policy_version,p.status AS project_status,p.project_type,
              p.tenant_id,p.workspace_id,t.plan_key
       FROM eval_shadow_projects s
       JOIN projects p ON p.id=s.project_id
       JOIN tenants t ON t.id=p.tenant_id
       WHERE s.project_id=? FOR UPDATE`,
      [executionProjectId]
    );
    if(!shadowProjects.length||shadowProjects[0].status!=='ACTIVE'||shadowProjects[0].project_status!=='ACTIVE') throw errorOf(
      'Execution project is not an active registered Shadow Eval project','SHADOW_PROJECT_NOT_REGISTERED',409
    );
    const shadowProject=shadowProjects[0];
    if(shadowProject.tenant_id!==INTERNAL_EVAL_TENANT_ID||shadowProject.workspace_id!==INTERNAL_EVAL_WORKSPACE_ID||
       shadowProject.plan_key!=='INTERNAL_EVAL'){
      throw errorOf('Shadow execution scope escaped INTERNAL_EVAL isolation','SHADOW_PROJECT_SCOPE_NOT_INTERNAL',500);
    }
    if(source.tenant_id===shadowProject.tenant_id||source.workspace_id===shadowProject.workspace_id||
       source.project_id===executionProjectId){
      throw errorOf('Shadow execution scope must be isolated from the source business scope','SHADOW_PROJECT_ISOLATION_REQUIRED',409);
    }
    if(shadowProject.project_type!==source.project_type) throw errorOf(
      'Shadow execution project type must match the source project type','SHADOW_PROJECT_TYPE_MISMATCH',409,
      {sourceProjectType:source.project_type,executionProjectType:shadowProject.project_type}
    );

    const snapshot=sourceSnapshotSha(source),inputHash=sourceInputSha(source),id=randomUUID();
    const safetySummary={
      policyVersion:SHADOW_POLICY_VERSION,sourceRunTerminal:true,sourceIsBusinessRun:true,
      baselineMatchesSource:true,candidateDiffersBaseline:true,readOnlyTaskTypes:true,
      isolatedTenant:true,isolatedWorkspace:true,isolatedProject:true,
      executionPlan:'INTERNAL_EVAL',customerBillingEligible:false,sourceBodyPersisted:false
    };
    await connection.execute(
      `INSERT INTO eval_shadow_replays
       (id,source_run_id,source_project_id,replay_manifest_id,execution_project_id,
        baseline_runtime_sha,candidate_runtime_sha,source_snapshot_sha256,source_input_sha256,
        safety_policy_version,status,safety_summary_json,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'PREPARED',?,?)`,
      [id,sourceRunId,source.project_id,replayManifestId,executionProjectId,
       manifest.baselineRuntimeSha,manifest.candidateRuntimeSha,snapshot,inputHash,
       SHADOW_POLICY_VERSION,JSON.stringify(safetySummary),idempotencyKey]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_shadow_replays WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeShadowReplay(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const executeShadowReplay=async(shadowReplayId,{
  contextsByCaseKey={},runtimeCommitSha=null
}={})=>{
  if(!shadowReplayId) throw errorOf('shadowReplayId is required','INVALID_SHADOW_REPLAY');
  const db=getRuntimePool(),connection=await db.getConnection();
  let shadow;
  try{
    await connection.beginTransaction();
    shadow=await loadShadowReplay(connection,shadowReplayId,true);
    if(['PASS','FAIL'].includes(shadow.status)&&shadow.eval_run_id){
      const evalRun=await getEvalRun(shadow.eval_run_id);
      await connection.commit();
      return {shadowReplay:normalizeShadowReplay(shadow),evalRun,idempotent:true};
    }
    if(!['PREPARED','ERROR'].includes(shadow.status)) throw errorOf(
      'Shadow replay is not executable from its current state','SHADOW_REPLAY_STATE_INVALID',409,{status:shadow.status}
    );

    const source=await loadSourceRun(connection,shadow.source_run_id,true);
    assertSourceEligible(source);
    if(sourceSnapshotSha(source)!==shadow.source_snapshot_sha256||sourceInputSha(source)!==shadow.source_input_sha256) throw errorOf(
      'Source Runtime run changed after shadow replay preparation','SHADOW_SOURCE_DRIFT',409
    );
    const activeSha=String(runtimeCommitSha||resolveEvalRuntimeSha()||'').toLowerCase();
    if(!SHA40.test(activeSha)) throw errorOf('Active Runtime SHA is unavailable','EVAL_RUNTIME_SHA_UNAVAILABLE',503);
    if(activeSha!==String(shadow.candidate_runtime_sha).toLowerCase()) throw errorOf(
      'Active Runtime SHA does not match the shadow candidate SHA','SHADOW_RUNTIME_SHA_MISMATCH',409,
      {activeRuntimeSha:activeSha,candidateRuntimeSha:shadow.candidate_runtime_sha}
    );
    const manifest=await getEvalReplayManifest(shadow.replay_manifest_id);
    await assertManifestSafe(manifest);
    await connection.execute(
      `UPDATE eval_shadow_replays SET status='RUNNING',started_at=CURRENT_TIMESTAMP(6),finished_at=NULL WHERE id=?`,
      [shadowReplayId]
    );
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}

  try{
    const evalRun=await runEvalReplayManifest(shadow.replay_manifest_id,{
      idempotencyKey:`shadow:${shadow.id}`,
      runtimeCommitSha:shadow.candidate_runtime_sha,
      executionProjectId:shadow.execution_project_id,
      contextsByCaseKey
    });

    const verify=await db.getConnection();
    try{
      await verify.beginTransaction();
      const current=await loadShadowReplay(verify,shadowReplayId,true);
      const source=await loadSourceRun(verify,current.source_run_id,true);
      if(sourceSnapshotSha(source)!==current.source_snapshot_sha256||sourceInputSha(source)!==current.source_input_sha256){
        throw errorOf('Source Runtime run changed during shadow execution','SHADOW_SOURCE_DRIFT',409);
      }
      if(evalRun.executionProjectId!==INTERNAL_EVAL_PROJECT_ID||current.execution_project_id!==INTERNAL_EVAL_PROJECT_ID){
        throw errorOf('Eval run escaped the system Shadow Eval project','SHADOW_EXECUTION_PROJECT_ESCAPE',500);
      }

      const [runtimeScopes]=await verify.execute(
        `SELECT DISTINCT r.id,r.tenant_id,r.workspace_id,r.project_id
         FROM eval_case_results e
         JOIN runs r ON r.id=e.runtime_run_id
         WHERE e.eval_run_id=? AND e.runtime_run_id IS NOT NULL`,
        [evalRun.id]
      );
      if(runtimeScopes.some(r=>r.tenant_id!==INTERNAL_EVAL_TENANT_ID||
        r.workspace_id!==INTERNAL_EVAL_WORKSPACE_ID||r.project_id!==INTERNAL_EVAL_PROJECT_ID)){
        throw errorOf('Shadow Runtime execution escaped INTERNAL_EVAL scope','SHADOW_RUNTIME_SCOPE_ESCAPE',500);
      }

      const [usageRows]=await verify.execute(
        `SELECT u.id,u.billing_class,u.estimated_cost,u.cost_currency
         FROM eval_case_results e
         JOIN usage_ledger u ON u.run_id=e.runtime_run_id
         WHERE e.eval_run_id=?`,
        [evalRun.id]
      );
      const customerUsage=usageRows.filter(x=>x.billing_class!=='INTERNAL_EVAL');
      if(customerUsage.length) throw errorOf(
        'Shadow usage was classified as customer-billable','SHADOW_USAGE_BILLING_ESCAPE',500,
        {usageLedgerIds:customerUsage.map(x=>x.id)}
      );

      const terminalStatus=evalRun.status==='PASS'?'PASS':'FAIL';
      const usageSummary={
        usageCount:usageRows.length,internalEvalUsageCount:usageRows.length,customerUsageCount:0,
        estimatedCost:usageRows.reduce((sum,x)=>sum+Number(x.estimated_cost||0),0),
        currencies:[...new Set(usageRows.map(x=>x.cost_currency).filter(Boolean))].sort(),
        billingClass:'INTERNAL_EVAL'
      };
      const safetySummary={
        ...(current.safety_summary_json||{}),runtimeScopeVerified:true,usageBillingClassVerified:true,
        evalRunId:evalRun.id,evalStatus:evalRun.status,usage:usageSummary
      };
      const shadowHash=sha256({
        sourceRunId:current.source_run_id,sourceSnapshotSha256:current.source_snapshot_sha256,
        replayManifestId:current.replay_manifest_id,evalRunId:evalRun.id,
        evalResultSha256:evalRun.resultSha256,candidateRuntimeSha:current.candidate_runtime_sha,
        safetyPolicyVersion:current.safety_policy_version,safetySummary
      });
      await verify.execute(
        `UPDATE eval_shadow_replays SET eval_run_id=?,status=?,safety_summary_json=?,shadow_sha256=?,
         finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [evalRun.id,terminalStatus,JSON.stringify(safetySummary),shadowHash,shadowReplayId]
      );
      const [rows]=await verify.execute('SELECT * FROM eval_shadow_replays WHERE id=?',[shadowReplayId]);
      await verify.commit();
      return {shadowReplay:normalizeShadowReplay(rows[0]),evalRun,idempotent:false};
    }catch(error){await verify.rollback();throw error;}finally{verify.release();}
  }catch(error){
    await db.execute(
      `UPDATE eval_shadow_replays SET status='ERROR',finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [shadowReplayId]
    );
    throw error;
  }
};

export const getShadowReplay=async id=>{
  const db=getRuntimePool();
  const row=await loadShadowReplay(db,id,false);
  let evalRun=null;
  if(row.eval_run_id) evalRun=await getEvalRun(row.eval_run_id);
  return {shadowReplay:normalizeShadowReplay(row),evalRun};
};

export const verifyShadowSourceSnapshot=async id=>{
  const db=getRuntimePool(),row=await loadShadowReplay(db,id,false);
  const source=await loadSourceRun(db,row.source_run_id,false);
  const actual=sourceSnapshotSha(source),inputActual=sourceInputSha(source);
  return {
    shadowReplayId:id,sourceRunId:row.source_run_id,
    expectedSha256:row.source_snapshot_sha256,actualSha256:actual,
    inputExpectedSha256:row.source_input_sha256,inputActualSha256:inputActual,
    matches:actual===row.source_snapshot_sha256&&inputActual===row.source_input_sha256
  };
};

export const SHADOW_SOURCE_SHA256_PATTERN=SHA64;
export const SHADOW_SAFETY_POLICY_VERSION=SHADOW_POLICY_VERSION;
