import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getEvalReplayManifest } from './eval-replay.mjs';
import { runEvalReplayManifest, getEvalRun, resolveEvalRuntimeSha } from './eval-runner.mjs';

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

const normalizeShadowProject=row=>({
  projectId:row.project_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeShadowReplay=row=>({
  id:row.id,sourceRunId:row.source_run_id,sourceProjectId:row.source_project_id,
  replayManifestId:row.replay_manifest_id,executionProjectId:row.execution_project_id,
  baselineRuntimeSha:row.baseline_runtime_sha,candidateRuntimeSha:row.candidate_runtime_sha,
  sourceSnapshotSha256:row.source_snapshot_sha256,evalRunId:row.eval_run_id||null,status:row.status,
  idempotencyKey:row.idempotency_key,preparedAt:row.prepared_at,startedAt:row.started_at||null,
  finishedAt:row.finished_at||null,createdAt:row.created_at
});

const loadSourceRun=async(db,runId,lock=false)=>{
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,r.status,r.finished_at,r.runtime_commit_sha,r.knowledge_commit_sha,
            r.run_type,r.trigger_source,r.workflow_version,r.router_version,r.rag_index_version,
            p.project_type,p.tenant_id,p.workspace_id,p.status AS project_status
     FROM runs r JOIN projects p ON p.id=r.project_id
     WHERE r.id=?${lock?' FOR UPDATE':''}`,
    [runId]
  );
  if(!rows.length) throw errorOf('Source Runtime run not found','SHADOW_SOURCE_RUN_NOT_FOUND',404);
  return rows[0];
};
const sourceSnapshotMaterial=row=>({
  runId:row.id,
  projectId:row.project_id,
  status:row.status,
  finishedAt:row.finished_at?new Date(row.finished_at).toISOString():null,
  runtimeCommitSha:row.runtime_commit_sha||null,
  knowledgeCommitSha:row.knowledge_commit_sha||null,
  workflowVersion:row.workflow_version||null,
  routerVersion:row.router_version||null,
  ragIndexVersion:row.rag_index_version||null,
  runType:row.run_type||null,
  triggerSource:row.trigger_source||null
});
const sourceSnapshotSha=row=>sha256(sourceSnapshotMaterial(row));
const assertSourceEligible=row=>{
  if(!['PASS','FAIL'].includes(row.status)||!row.finished_at) throw errorOf(
    'Shadow replay requires a terminal source Runtime run','SHADOW_SOURCE_RUN_NOT_TERMINAL',409,
    {status:row.status}
  );
  if(!SHA40.test(row.runtime_commit_sha||'')) throw errorOf(
    'Source Runtime run does not have a valid runtime commit SHA','SHADOW_SOURCE_RUNTIME_SHA_INVALID',409
  );
  if(row.project_status!=='ACTIVE') throw errorOf('Source project is not active','SHADOW_SOURCE_PROJECT_NOT_ACTIVE',409);
};

export const registerShadowEvalProject=async projectId=>{
  if(!projectId) throw errorOf('projectId is required','INVALID_SHADOW_PROJECT');
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [projects]=await connection.execute(
      'SELECT id,status FROM projects WHERE id=? FOR UPDATE',[projectId]
    );
    if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
    if(projects[0].status!=='ACTIVE') throw errorOf('Shadow eval project must be active','SHADOW_PROJECT_NOT_ACTIVE',409);
    await connection.execute(
      `INSERT INTO eval_shadow_projects (project_id,status)
       VALUES (?,'ACTIVE')
       ON DUPLICATE KEY UPDATE status='ACTIVE',updated_at=CURRENT_TIMESTAMP(6)`,
      [projectId]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_shadow_projects WHERE project_id=?',[projectId]);
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
  sourceRunId,replayManifestId,executionProjectId,idempotencyKey
}={})=>{
  if(!sourceRunId||!replayManifestId||!executionProjectId||!idempotencyKey) throw errorOf(
    'sourceRunId, replayManifestId, executionProjectId and idempotencyKey are required','INVALID_SHADOW_REPLAY'
  );
  const manifest=await getEvalReplayManifest(replayManifestId);
  if(!SHA40.test(manifest.candidateRuntimeSha||'')) throw errorOf('Manifest candidate Runtime SHA is invalid','SHADOW_CANDIDATE_SHA_INVALID',409);
  if(!SHA40.test(manifest.baselineRuntimeSha||'')) throw errorOf(
    'Production-safe shadow replay requires baselineRuntimeSha','SHADOW_BASELINE_SHA_REQUIRED',409
  );
  if(manifest.candidateRuntimeSha===manifest.baselineRuntimeSha) throw errorOf(
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
    if(source.project_id===executionProjectId) throw errorOf(
      'Shadow execution project must differ from the source project','SHADOW_PROJECT_ISOLATION_REQUIRED',409
    );

    const [shadowProjects]=await connection.execute(
      `SELECT s.project_id,s.status,p.status AS project_status,p.project_type
       FROM eval_shadow_projects s JOIN projects p ON p.id=s.project_id
       WHERE s.project_id=? FOR UPDATE`,
      [executionProjectId]
    );
    if(!shadowProjects.length||shadowProjects[0].status!=='ACTIVE'||shadowProjects[0].project_status!=='ACTIVE') throw errorOf(
      'Execution project is not an active registered Shadow Eval project','SHADOW_PROJECT_NOT_REGISTERED',409
    );
    if(shadowProjects[0].project_type!==source.project_type) throw errorOf(
      'Shadow execution project type must match the source project type','SHADOW_PROJECT_TYPE_MISMATCH',409,
      {sourceProjectType:source.project_type,executionProjectType:shadowProjects[0].project_type}
    );

    const snapshot=sourceSnapshotSha(source),id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_shadow_replays
       (id,source_run_id,source_project_id,replay_manifest_id,execution_project_id,
        baseline_runtime_sha,candidate_runtime_sha,source_snapshot_sha256,status,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?, 'PREPARED',?)`,
      [id,sourceRunId,source.project_id,replayManifestId,executionProjectId,
       manifest.baselineRuntimeSha,manifest.candidateRuntimeSha,snapshot,idempotencyKey]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_shadow_replays WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeShadowReplay(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

const loadShadowReplay=async(db,id,lock=false)=>{
  const [rows]=await db.execute(
    `SELECT * FROM eval_shadow_replays WHERE id=?${lock?' FOR UPDATE':''}`,[id]
  );
  if(!rows.length) throw errorOf('Shadow replay not found','SHADOW_REPLAY_NOT_FOUND',404);
  return rows[0];
};

export const executeShadowReplay=async(shadowReplayId,{
  contextsByCaseKey={}
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
    const currentSnapshot=sourceSnapshotSha(source);
    if(currentSnapshot!==shadow.source_snapshot_sha256) throw errorOf(
      'Source Runtime run changed after shadow replay preparation','SHADOW_SOURCE_DRIFT',409,
      {expected:shadow.source_snapshot_sha256,actual:currentSnapshot}
    );
    const activeSha=String(resolveEvalRuntimeSha()||'').toLowerCase();
    if(!SHA40.test(activeSha)) throw errorOf('Active Runtime SHA is unavailable','EVAL_RUNTIME_SHA_UNAVAILABLE',503);
    if(activeSha!==String(shadow.candidate_runtime_sha).toLowerCase()) throw errorOf(
      'Active Runtime SHA does not match the shadow candidate SHA','SHADOW_RUNTIME_SHA_MISMATCH',409,
      {activeRuntimeSha:activeSha,candidateRuntimeSha:shadow.candidate_runtime_sha}
    );
    await connection.execute(
      `UPDATE eval_shadow_replays SET status='RUNNING',started_at=CURRENT_TIMESTAMP(6),finished_at=NULL WHERE id=?`,
      [shadowReplayId]
    );
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}

  try{
    const evalRun=await runEvalReplayManifest(shadow.replay_manifest_id,{
      idempotencyKey:`shadow:${shadow.id}`,
      executionProjectId:shadow.execution_project_id,
      contextsByCaseKey
    });

    const verify=await db.getConnection();
    try{
      await verify.beginTransaction();
      const current=await loadShadowReplay(verify,shadowReplayId,true);
      const source=await loadSourceRun(verify,current.source_run_id,true);
      const currentSnapshot=sourceSnapshotSha(source);
      if(currentSnapshot!==current.source_snapshot_sha256) throw errorOf(
        'Source Runtime run changed during shadow execution','SHADOW_SOURCE_DRIFT',409
      );
      if(evalRun.executionProjectId!==current.execution_project_id) throw errorOf(
        'Eval run escaped the registered shadow execution project','SHADOW_EXECUTION_PROJECT_ESCAPE',500
      );
      const terminalStatus=evalRun.status==='PASS'?'PASS':'FAIL';
      await verify.execute(
        `UPDATE eval_shadow_replays SET eval_run_id=?,status=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [evalRun.id,terminalStatus,shadowReplayId]
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
  const actual=sourceSnapshotSha(source);
  return {
    shadowReplayId:id,sourceRunId:row.source_run_id,
    expectedSha256:row.source_snapshot_sha256,actualSha256:actual,
    matches:actual===row.source_snapshot_sha256
  };
};

export const SHADOW_SOURCE_SHA256_PATTERN=SHA64;
