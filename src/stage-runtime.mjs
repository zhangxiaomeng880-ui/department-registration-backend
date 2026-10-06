import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const TRANSITIONS=new Set(['PASS','RETRY','ROLLBACK','ESCALATE']);
const NEGATIVE_GATE_STATUSES=new Set(['FAIL','HOLD']);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const normalizeEvent=row=>({
  id:row.id,
  tenantId:row.tenant_id,
  workspaceId:row.workspace_id,
  projectId:row.project_id,
  runId:row.run_id,
  taskId:row.task_id||null,
  projectStageInstanceId:row.project_stage_instance_id,
  targetStageInstanceId:row.target_stage_instance_id||null,
  transitionType:row.transition_type,
  gateResultId:row.gate_result_id,
  checkpointId:row.checkpoint_id,
  stageSnapshotId:row.stage_snapshot_id,
  fromStageKey:row.from_stage_key,
  toStageKey:row.to_stage_key||null,
  attemptNo:Number(row.attempt_no),
  decision:parseJson(row.decision_json),
  evidence:parseJson(row.evidence_json),
  actorKey:row.actor_key,
  idempotencyKey:row.idempotency_key,
  createdAt:row.created_at
});

export const getStageTransitionEvent=async eventId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM stage_transition_events WHERE id=?',[eventId]);
  if(!rows.length) throw errorOf('Stage transition event not found','STAGE_TRANSITION_NOT_FOUND',404);
  return normalizeEvent(rows[0]);
};

export const listStageTransitionEvents=async({projectId,runId=null,limit=100}={})=>{
  if(!projectId) throw errorOf('projectId is required','INVALID_STAGE_TRANSITION_QUERY');
  const db=getRuntimePool();
  const safeLimit=Math.max(1,Math.min(500,Number(limit)||100));
  const [rows]=runId
    ? await db.execute(
        `SELECT * FROM stage_transition_events
          WHERE project_id=? AND run_id=? ORDER BY created_at,id LIMIT ${safeLimit}`,
        [projectId,runId]
      )
    : await db.execute(
        `SELECT * FROM stage_transition_events
          WHERE project_id=? ORDER BY created_at,id LIMIT ${safeLimit}`,
        [projectId]
      );
  return rows.map(normalizeEvent);
};

const loadLockedContext=async(conn,input)=>{
  const [projects]=await conn.execute(
    `SELECT p.*,wt.definition_sha256
       FROM projects p
       LEFT JOIN workflow_templates wt ON wt.id=p.workflow_template_id
      WHERE p.id=? FOR UPDATE`,
    [input.projectId]
  );
  if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  const project=projects[0];
  if(!project.workflow_template_id) throw errorOf('Project is not bound to a workflow template','PROJECT_WORKFLOW_NOT_BOUND',409);

  const [runs]=await conn.execute(
    'SELECT * FROM runs WHERE id=? AND project_id=? FOR UPDATE',
    [input.runId,input.projectId]
  );
  if(!runs.length) throw errorOf('Run not found in project','RUN_SCOPE_MISMATCH',404);
  const run=runs[0];

  const [stages]=await conn.execute(
    `SELECT psi.*,wts.gate_policy_key,wts.config_json
       FROM project_stage_instances psi
       JOIN workflow_template_stages wts ON wts.id=psi.workflow_template_stage_id
      WHERE psi.project_id=? AND psi.stage_key=? FOR UPDATE`,
    [input.projectId,input.stageKey]
  );
  if(!stages.length) throw errorOf('Project stage not found','PROJECT_STAGE_NOT_FOUND',404);
  const stage=stages[0];

  if(project.current_stage_key!==stage.stage_key) throw errorOf(
    'Transition must target the current project stage','PROJECT_STAGE_NOT_CURRENT',409,
    {currentStageKey:project.current_stage_key,requestedStageKey:stage.stage_key}
  );
  if(!['ACTIVE','BLOCKED'].includes(stage.status)) throw errorOf(
    'Current project stage is not transitionable','PROJECT_STAGE_NOT_TRANSITIONABLE',409,
    {stageKey:stage.stage_key,status:stage.status}
  );

  let task=null;
  if(input.taskId){
    const [tasks]=await conn.execute(
      'SELECT * FROM tasks WHERE id=? AND run_id=? FOR UPDATE',
      [input.taskId,input.runId]
    );
    if(!tasks.length) throw errorOf('Task not found in run','TASK_SCOPE_MISMATCH',404);
    task=tasks[0];
    if(task.stage_key!==stage.stage_key) throw errorOf(
      'Task stage does not match current project stage','STAGE_TRANSITION_TASK_MISMATCH',409,
      {taskStageKey:task.stage_key,stageKey:stage.stage_key}
    );
  }

  return {project,run,stage,task};
};

const validateTransitionInput=(context,input)=>{
  const transitionType=String(input.transitionType||'').toUpperCase();
  if(!TRANSITIONS.has(transitionType)) throw errorOf('Unsupported transitionType','INVALID_STAGE_TRANSITION');
  const gateStatus=String(input.gateStatus||'').toUpperCase();
  if(transitionType==='PASS'&&gateStatus!=='PASS') throw errorOf(
    'PASS transition requires PASS gate status','STAGE_PASS_REQUIRES_GATE_PASS',409
  );
  if(transitionType!=='PASS'&&!NEGATIVE_GATE_STATUSES.has(gateStatus)) throw errorOf(
    transitionType+' transition requires FAIL or HOLD gate status','STAGE_NEGATIVE_TRANSITION_REQUIRES_GATE_FAILURE',409
  );
  const requiredGate=context.stage.gate_policy_key;
  const gateKey=input.gateKey||requiredGate||`G-STAGE-${context.stage.stage_key}`;
  if(requiredGate&&gateKey!==requiredGate) throw errorOf(
    'Gate key does not match the stage gate policy','STAGE_GATE_POLICY_MISMATCH',409,
    {requiredGateKey:requiredGate,gateKey}
  );
  if(transitionType==='ROLLBACK'&&!input.targetStageKey) throw errorOf(
    'ROLLBACK requires targetStageKey','ROLLBACK_TARGET_REQUIRED'
  );
  if(!input.idempotencyKey) throw errorOf('idempotencyKey is required','STAGE_TRANSITION_IDEMPOTENCY_REQUIRED');
  return {transitionType,gateStatus,gateKey};
};

const nextCheckpointSequence=async(conn,runId)=>{
  const [rows]=await conn.execute(
    'SELECT COALESCE(MAX(sequence_no),0)+1 AS next_sequence FROM checkpoints WHERE run_id=? FOR UPDATE',
    [runId]
  );
  return Number(rows[0].next_sequence);
};
const nextStageSnapshotVersion=async(conn,projectId,stageKey)=>{
  const [rows]=await conn.execute(
    `SELECT COALESCE(MAX(snapshot_version),0)+1 AS next_version
       FROM stage_snapshots WHERE project_id=? AND stage_key=? FOR UPDATE`,
    [projectId,stageKey]
  );
  return Number(rows[0].next_version);
};
const loadLifecycleState=async(conn,projectId)=>{
  const [projects]=await conn.execute(
    'SELECT id,status,current_stage_key FROM projects WHERE id=?',[projectId]
  );
  const [milestones]=await conn.execute(
    `SELECT id,milestone_key,sequence_no,status,started_at,completed_at
       FROM project_milestones WHERE project_id=? ORDER BY sequence_no,id`,[projectId]
  );
  const [stages]=await conn.execute(
    `SELECT id,stage_key,sequence_no,status,attempt_count,milestone_id,started_at,completed_at,
            last_gate_result_id,last_transition_type,blocked_reason,last_transition_at
       FROM project_stage_instances WHERE project_id=? ORDER BY sequence_no,id`,[projectId]
  );
  return {
    project:projects[0]||null,
    milestones:milestones.map(row=>({
      id:row.id,milestoneKey:row.milestone_key,sequenceNo:Number(row.sequence_no),status:row.status,
      startedAt:row.started_at||null,completedAt:row.completed_at||null
    })),
    stages:stages.map(row=>({
      id:row.id,stageKey:row.stage_key,sequenceNo:Number(row.sequence_no),status:row.status,
      attemptCount:Number(row.attempt_count||0),milestoneId:row.milestone_id||null,
      startedAt:row.started_at||null,completedAt:row.completed_at||null,
      lastGateResultId:row.last_gate_result_id||null,lastTransitionType:row.last_transition_type||null,
      blockedReason:row.blocked_reason||null,lastTransitionAt:row.last_transition_at||null
    }))
  };
};

const applyPass=async(conn,context,gateResultId)=>{
  const {project,run,stage,task}=context;
  await conn.execute(
    `UPDATE project_stage_instances SET
      status='COMPLETED',last_gate_result_id=?,last_transition_type='PASS',blocked_reason=NULL,
      completed_at=CURRENT_TIMESTAMP(6),last_transition_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [gateResultId,stage.id]
  );
  if(task){
    await conn.execute(
      `UPDATE tasks SET status='PASS',error_code=NULL,error_category=NULL,error_message=NULL,
        finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [task.id]
    );
  }

  if(stage.milestone_id){
    const [[remaining]]=await conn.execute(
      `SELECT COUNT(*) AS count FROM project_stage_instances
        WHERE project_id=? AND milestone_id=? AND status<>'COMPLETED'`,
      [project.id,stage.milestone_id]
    );
    if(Number(remaining.count)===0){
      await conn.execute(
        `UPDATE project_milestones SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP(6),
          last_transition_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [stage.milestone_id]
      );
    }
  }

  const [nextRows]=await conn.execute(
    `SELECT * FROM project_stage_instances
      WHERE project_id=? AND sequence_no>? ORDER BY sequence_no,id LIMIT 1 FOR UPDATE`,
    [project.id,stage.sequence_no]
  );
  if(!nextRows.length){
    await conn.execute(
      `UPDATE projects SET status='COMPLETED',current_stage_key=NULL WHERE id=?`,
      [project.id]
    );
    await conn.execute(
      `UPDATE runs SET status='PASS',error_code=NULL,error_category=NULL,error_message=NULL,
        finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [run.id]
    );
    return {toStage:null,projectCompleted:true};
  }

  const next=nextRows[0];
  await conn.execute(
    `UPDATE project_stage_instances SET status='ACTIVE',blocked_reason=NULL,
      started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)) WHERE id=?`,
    [next.id]
  );
  if(next.milestone_id&&next.milestone_id!==stage.milestone_id){
    await conn.execute(
      `UPDATE project_milestones SET status='ACTIVE',
        started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)),
        completed_at=NULL,last_transition_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [next.milestone_id]
    );
  }
  await conn.execute(
    `UPDATE projects SET status='ACTIVE',current_stage_key=? WHERE id=?`,
    [next.stage_key,project.id]
  );
  await conn.execute(
    `UPDATE runs SET status='RUNNING',error_code=NULL,error_category=NULL,error_message=NULL,
      finished_at=NULL WHERE id=?`,
    [run.id]
  );
  return {toStage:next,projectCompleted:false};
};

const applyRetry=async(conn,context,gateResultId,input)=>{
  const {project,run,stage,task}=context;
  const config=parseJson(stage.config_json)||{};
  const nextAttempt=Number(stage.attempt_count||0)+1;
  const maxRetries=config.maxRetries==null?null:Number(config.maxRetries);
  if(Number.isFinite(maxRetries)&&maxRetries>=0&&nextAttempt>maxRetries) throw errorOf(
    'Stage retry limit exceeded; escalation or rollback is required','STAGE_RETRY_LIMIT_EXCEEDED',409,
    {stageKey:stage.stage_key,maxRetries,attemptedRetry:nextAttempt}
  );
  await conn.execute(
    `UPDATE project_stage_instances SET status='ACTIVE',attempt_count=?,
      last_gate_result_id=?,last_transition_type='RETRY',blocked_reason=NULL,
      completed_at=NULL,last_transition_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
    [nextAttempt,gateResultId,stage.id]
  );
  if(stage.milestone_id){
    await conn.execute(
      `UPDATE project_milestones SET status='ACTIVE',completed_at=NULL,
        started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)),
        last_transition_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [stage.milestone_id]
    );
  }
  await conn.execute(
    `UPDATE projects SET status='ACTIVE',current_stage_key=? WHERE id=?`,
    [stage.stage_key,project.id]
  );
  await conn.execute(
    `UPDATE runs SET status='RUNNING',error_code=NULL,error_category=NULL,error_message=NULL,
      finished_at=NULL WHERE id=?`,
    [run.id]
  );
  if(task){
    await conn.execute(
      `UPDATE tasks SET status='RUNNING',retry_count=retry_count+1,
        error_code=NULL,error_category=NULL,error_message=NULL,finished_at=NULL WHERE id=?`,
      [task.id]
    );
  }
  return {toStage:stage,projectCompleted:false,nextAttempt};
};

const applyEscalate=async(conn,context,gateResultId,input)=>{
  const {project,run,stage,task}=context;
  const reason=input.blockingReason||'STAGE_ESCALATED';
  await conn.execute(
    `UPDATE project_stage_instances SET status='BLOCKED',last_gate_result_id=?,
      last_transition_type='ESCALATE',blocked_reason=?,last_transition_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [gateResultId,reason,stage.id]
  );
  if(stage.milestone_id){
    await conn.execute(
      `UPDATE project_milestones SET status='BLOCKED',
        last_transition_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [stage.milestone_id]
    );
  }
  await conn.execute(
    `UPDATE projects SET status='BLOCKED',current_stage_key=? WHERE id=?`,
    [stage.stage_key,project.id]
  );
  await conn.execute(
    `UPDATE runs SET status='HOLD',error_code='STAGE_ESCALATED',
      error_category='STAGE_RUNTIME',error_message=? WHERE id=?`,
    [reason,run.id]
  );
  if(task){
    await conn.execute(
      `UPDATE tasks SET status='BLOCKED',error_code='STAGE_ESCALATED',
        error_category='STAGE_RUNTIME',error_message=? WHERE id=?`,
      [reason,task.id]
    );
  }
  return {toStage:stage,projectCompleted:false};
};

const applyRollback=async(conn,context,gateResultId,input)=>{
  const {project,run,stage}=context;
  const [targets]=await conn.execute(
    `SELECT * FROM project_stage_instances
      WHERE project_id=? AND stage_key=? FOR UPDATE`,
    [project.id,input.targetStageKey]
  );
  if(!targets.length) throw errorOf('Rollback target stage not found','ROLLBACK_TARGET_NOT_FOUND',404);
  const target=targets[0];
  if(Number(target.sequence_no)>=Number(stage.sequence_no)) throw errorOf(
    'Rollback target must be before the current stage','ROLLBACK_TARGET_NOT_PREVIOUS',409,
    {currentStageKey:stage.stage_key,targetStageKey:target.stage_key}
  );

  await conn.execute(
    `UPDATE project_stage_instances SET status='PENDING',completed_at=NULL,blocked_reason=NULL
      WHERE project_id=? AND sequence_no>=?`,
    [project.id,target.sequence_no]
  );
  await conn.execute(
    `UPDATE project_stage_instances SET status='ACTIVE',attempt_count=attempt_count+1,
      started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)),completed_at=NULL,blocked_reason=NULL
      WHERE id=?`,
    [target.id]
  );
  await conn.execute(
    `UPDATE project_stage_instances SET last_gate_result_id=?,last_transition_type='ROLLBACK',
      last_transition_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
    [gateResultId,stage.id]
  );

  if(target.milestone_id){
    const [[targetMilestone]]=await conn.execute(
      'SELECT sequence_no FROM project_milestones WHERE id=? FOR UPDATE',[target.milestone_id]
    );
    if(targetMilestone){
      await conn.execute(
        `UPDATE project_milestones SET
          status=CASE
            WHEN sequence_no<? THEN 'COMPLETED'
            WHEN sequence_no=? THEN 'ACTIVE'
            ELSE 'PENDING'
          END,
          completed_at=CASE WHEN sequence_no<? THEN completed_at ELSE NULL END,
          started_at=CASE
            WHEN sequence_no=? THEN COALESCE(started_at,CURRENT_TIMESTAMP(6))
            ELSE started_at
          END,
          last_transition_at=CASE WHEN sequence_no>=? THEN CURRENT_TIMESTAMP(6) ELSE last_transition_at END
          WHERE project_id=?`,
        [
          targetMilestone.sequence_no,targetMilestone.sequence_no,targetMilestone.sequence_no,
          targetMilestone.sequence_no,targetMilestone.sequence_no,project.id
        ]
      );
    }
  }
  await conn.execute(
    `UPDATE projects SET status='ACTIVE',current_stage_key=? WHERE id=?`,
    [target.stage_key,project.id]
  );
  await conn.execute(
    `UPDATE runs SET status='RUNNING',error_code=NULL,error_category=NULL,error_message=NULL,
      finished_at=NULL WHERE id=?`,
    [run.id]
  );
  return {toStage:target,projectCompleted:false};
};

export const transitionProjectStage=async input=>{
  const db=getRuntimePool();
  if(!input?.projectId||!input?.runId||!input?.stageKey){
    throw errorOf('projectId, runId and stageKey are required','INVALID_STAGE_TRANSITION');
  }
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();

    const [existing]=await conn.execute(
      'SELECT * FROM stage_transition_events WHERE idempotency_key=? LIMIT 1 FOR UPDATE',
      [input.idempotencyKey||'']
    );
    if(existing.length){
      await conn.commit();
      return {...normalizeEvent(existing[0]),idempotent:true};
    }

    const context=await loadLockedContext(conn,input);
    const validated=validateTransitionInput(context,input);
    const actorKey=String(input.actorKey||'STAGE_RUNTIME').slice(0,128);

    const gateResultId=randomUUID();
    await conn.execute(
      `INSERT INTO gate_results
        (id,run_id,task_id,correlation_id,stage_key,gate_key,status,criteria_json,
         evidence_json,blocking_reason,decided_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        gateResultId,context.run.id,context.task?.id||null,context.run.correlation_id||null,
        context.stage.stage_key,validated.gateKey,validated.gateStatus,
        asJson(input.criteria||{}),asJson(input.evidence||null),input.blockingReason||null,actorKey
      ]
    );

    let outcome;
    if(validated.transitionType==='PASS') outcome=await applyPass(conn,context,gateResultId,input);
    else if(validated.transitionType==='RETRY') outcome=await applyRetry(conn,context,gateResultId,input);
    else if(validated.transitionType==='ROLLBACK') outcome=await applyRollback(conn,context,gateResultId,input);
    else outcome=await applyEscalate(conn,context,gateResultId,input);

    const lifecycle=await loadLifecycleState(conn,input.projectId);
    const snapshotVersion=await nextStageSnapshotVersion(conn,input.projectId,context.stage.stage_key);
    await conn.execute(
      `UPDATE stage_snapshots SET is_current=FALSE
        WHERE project_id=? AND stage_key=? AND is_current=TRUE`,
      [input.projectId,context.stage.stage_key]
    );
    const stageSnapshotId=randomUUID();
    await conn.execute(
      `INSERT INTO stage_snapshots
        (id,project_id,run_id,stage_key,snapshot_version,gate_status,is_current,state_json,evidence_json,
         runtime_commit_sha,knowledge_commit_sha,workflow_version)
       VALUES (?,?,?,?,?,?,TRUE,?,?,?,?,?)`,
      [
        stageSnapshotId,input.projectId,input.runId,context.stage.stage_key,snapshotVersion,
        validated.gateStatus,asJson({
          transitionType:validated.transitionType,
          fromStageKey:context.stage.stage_key,
          toStageKey:outcome.toStage?.stage_key||null,
          projectStatus:lifecycle.project?.status||null,
          currentStageKey:lifecycle.project?.current_stage_key||null,
          lifecycle
        }),asJson(input.evidence||null),context.run.runtime_commit_sha||null,
        context.run.knowledge_commit_sha||null,context.run.workflow_version||null
      ]
    );

    const checkpointSequence=await nextCheckpointSequence(conn,input.runId);
    const checkpointId=randomUUID();
    const taskKey=context.task?.task_key||null;
    const completedTaskKeys=validated.transitionType==='PASS'&&taskKey?[taskKey]:[];
    const pendingTaskKeys=['RETRY','ROLLBACK'].includes(validated.transitionType)&&taskKey?[taskKey]:[];
    const blockedTaskKeys=validated.transitionType==='ESCALATE'&&taskKey?[taskKey]:[];
    const resumeFromTaskKey=validated.transitionType==='RETRY'?taskKey:null;
    await conn.execute(
      `INSERT INTO checkpoints
        (id,run_id,task_id,correlation_id,sequence_no,checkpoint_type,status,stage_key,step_key,state_json,
         completed_task_keys_json,pending_task_keys_json,blocked_task_keys_json,dependency_fingerprint,
         runtime_commit_sha,knowledge_commit_sha,workflow_version,router_version,resume_from_task_key,created_by)
       VALUES (?,?,?,?,?,'STAGE_TRANSITION','VALID',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        checkpointId,input.runId,context.task?.id||null,context.run.correlation_id||null,checkpointSequence,
        context.stage.stage_key,`stage-${validated.transitionType.toLowerCase()}`,
        asJson({
          transitionType:validated.transitionType,gateResultId,stageSnapshotId,
          fromStageKey:context.stage.stage_key,toStageKey:outcome.toStage?.stage_key||null,
          projectCompleted:outcome.projectCompleted===true,lifecycle
        }),
        asJson(completedTaskKeys),asJson(pendingTaskKeys),asJson(blockedTaskKeys),
        context.project.definition_sha256||null,context.run.runtime_commit_sha||null,
        context.run.knowledge_commit_sha||null,context.run.workflow_version||null,
        context.run.router_version||null,resumeFromTaskKey,actorKey
      ]
    );
    await conn.execute(
      'UPDATE runs SET last_checkpoint_at=CURRENT_TIMESTAMP(6) WHERE id=?',[input.runId]
    );

    const eventId=randomUUID();
    const attemptNo=validated.transitionType==='RETRY'
      ? Number(context.stage.attempt_count||0)+1
      : Number(context.stage.attempt_count||0);
    await conn.execute(
      `INSERT INTO stage_transition_events
        (id,tenant_id,workspace_id,project_id,run_id,task_id,project_stage_instance_id,
         target_stage_instance_id,transition_type,gate_result_id,checkpoint_id,stage_snapshot_id,
         from_stage_key,to_stage_key,attempt_no,decision_json,evidence_json,actor_key,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        eventId,context.project.tenant_id,context.project.workspace_id,input.projectId,input.runId,
        context.task?.id||null,context.stage.id,outcome.toStage?.id||null,validated.transitionType,
        gateResultId,checkpointId,stageSnapshotId,context.stage.stage_key,outcome.toStage?.stage_key||null,
        attemptNo,asJson({
          gateKey:validated.gateKey,gateStatus:validated.gateStatus,
          projectCompleted:outcome.projectCompleted===true,
          lifecycleAfter:lifecycle
        }),asJson(input.evidence||null),actorKey,input.idempotencyKey
      ]
    );

    await conn.commit();
    return {
      ...await getStageTransitionEvent(eventId),
      idempotent:false,
      lifecycle
    };
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{
    conn.release();
  }
};
