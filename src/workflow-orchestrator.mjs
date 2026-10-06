import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool, createRun, createTask } from './runtime-db.mjs';
import { getProjectLifecycle, getWorkflowTemplate } from './core-meta-registry.mjs';
import { invokeStageCapability } from './capability-runtime.mjs';
import { transitionProjectStage } from './stage-runtime.mjs';

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value)),
  'utf8'
).digest('hex');
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);

const inputManifestOf=stageInputs=>{
  const manifest={};
  for(const [stageKey,requirements] of Object.entries(stageInputs||{})){
    manifest[stageKey]={};
    for(const [requirementKey,value] of Object.entries(requirements||{})){
      manifest[stageKey][requirementKey]={
        present:value!==undefined,
        sha256:sha256(value??null)
      };
    }
  }
  return manifest;
};

const normalizeSession=row=>({
  id:row.id,
  tenantId:row.tenant_id,
  workspaceId:row.workspace_id,
  projectId:row.project_id,
  runId:row.run_id,
  workflowTemplateId:row.workflow_template_id,
  status:row.status,
  currentStageKey:row.current_stage_key||null,
  stopReasonCode:row.stop_reason_code||null,
  stopReasonMessage:row.stop_reason_message||null,
  stageAttempts:Number(row.stage_attempts||0),
  capabilityInvocationCount:Number(row.capability_invocation_count||0),
  maxStageTransitions:Number(row.max_stage_transitions),
  inputManifest:parseJson(row.input_manifest_json),
  result:parseJson(row.result_json),
  idempotencyKey:row.idempotency_key,
  startedAt:row.started_at,
  finishedAt:row.finished_at||null,
  createdAt:row.created_at,
  updatedAt:row.updated_at
});
const normalizeAttempt=row=>({
  id:row.id,
  sessionId:row.session_id,
  runId:row.run_id,
  taskId:row.task_id,
  projectStageInstanceId:row.project_stage_instance_id,
  stageKey:row.stage_key,
  attemptNo:Number(row.attempt_no),
  status:row.status,
  requiredRequirementCount:Number(row.required_requirement_count||0),
  optionalRequirementCount:Number(row.optional_requirement_count||0),
  invocationCount:Number(row.invocation_count||0),
  passedInvocationCount:Number(row.passed_invocation_count||0),
  failedInvocationCount:Number(row.failed_invocation_count||0),
  gateStatus:row.gate_status||null,
  transitionType:row.transition_type||null,
  transitionEventId:row.transition_event_id||null,
  decision:parseJson(row.decision_json),
  startedAt:row.started_at,
  finishedAt:row.finished_at||null,
  createdAt:row.created_at
});

export const getWorkflowOrchestrationSession=async sessionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM workflow_orchestration_sessions WHERE id=?',[sessionId]
  );
  if(!rows.length) throw errorOf(
    'Workflow orchestration session not found','WORKFLOW_ORCHESTRATION_NOT_FOUND',404
  );
  const [attempts]=await db.execute(
    `SELECT * FROM workflow_orchestration_stage_attempts
      WHERE session_id=? ORDER BY created_at,id`,
    [sessionId]
  );
  return {...normalizeSession(rows[0]),attempts:attempts.map(normalizeAttempt)};
};

export const listWorkflowOrchestrationSessions=async({projectId,limit=50}={})=>{
  if(!projectId) throw errorOf('projectId is required','INVALID_WORKFLOW_ORCHESTRATION_QUERY');
  const safeLimit=Math.max(1,Math.min(200,Number(limit)||50));
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM workflow_orchestration_sessions
      WHERE project_id=? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [projectId]
  );
  return rows.map(normalizeSession);
};

const updateSession=async(sessionId,fields)=>{
  const db=getRuntimePool();
  const sets=[],values=[];
  const mapping={
    status:'status',
    currentStageKey:'current_stage_key',
    stopReasonCode:'stop_reason_code',
    stopReasonMessage:'stop_reason_message',
    stageAttempts:'stage_attempts',
    capabilityInvocationCount:'capability_invocation_count',
    result:'result_json'
  };
  for(const [key,column] of Object.entries(mapping)){
    if(fields[key]===undefined) continue;
    sets.push(`${column}=?`);
    values.push(key==='result'?asJson(fields[key]):fields[key]);
  }
  if(fields.finished===true) sets.push('finished_at=CURRENT_TIMESTAMP(6)');
  if(fields.finished===false) sets.push('finished_at=NULL');
  if(!sets.length) return;
  values.push(sessionId);
  await db.execute(
    `UPDATE workflow_orchestration_sessions SET ${sets.join(',')} WHERE id=?`,values
  );
};

const loadProjectAndTemplate=async projectId=>{
  const lifecycle=await getProjectLifecycle(projectId);
  if(!lifecycle.template) throw errorOf(
    'Project is not bound to a frozen workflow template',
    'PROJECT_WORKFLOW_NOT_BOUND',409
  );
  if(!['ACTIVE','BLOCKED'].includes(lifecycle.project.status)) throw errorOf(
    'Project is not orchestratable in its current state',
    'PROJECT_NOT_ORCHESTRATABLE',409,{status:lifecycle.project.status}
  );
  const template=await getWorkflowTemplate(lifecycle.template.id);
  if(template.status!=='FROZEN') throw errorOf(
    'Project workflow template must be frozen',
    'WORKFLOW_TEMPLATE_NOT_FROZEN',409
  );
  return {lifecycle,template};
};

const stagePolicyOf=stage=>{
  const config=stage.config||{};
  return {
    maxRetries:config.maxRetries==null?0:Math.max(0,Number(config.maxRetries)||0),
    onFailure:String(config.onFailure||'RETRY').toUpperCase(),
    onRetryExhausted:String(config.onRetryExhausted||'ESCALATE').toUpperCase(),
    rollbackStageKey:config.rollbackStageKey||null,
    optionalFailureBlocks:config.optionalFailureBlocks===true,
    allowAutoPassWithoutRequirements:config.allowAutoPassWithoutRequirements===true
  };
};

const decideFailureTransition=(stage,stageInstance,reasonCode)=>{
  const policy=stagePolicyOf(stage);
  if(reasonCode==='REQUIRED_INPUT_MISSING'){
    return {
      transitionType:'ESCALATE',
      gateStatus:'HOLD',
      blockingReason:'Required stage input is missing'
    };
  }
  if(policy.onFailure==='ESCALATE'){
    return {transitionType:'ESCALATE',gateStatus:'FAIL',blockingReason:'Stage capability execution failed'};
  }
  if(policy.onFailure==='ROLLBACK'){
    if(!policy.rollbackStageKey) return {
      transitionType:'ESCALATE',gateStatus:'FAIL',
      blockingReason:'Rollback policy is configured without rollbackStageKey'
    };
    return {
      transitionType:'ROLLBACK',gateStatus:'FAIL',
      targetStageKey:policy.rollbackStageKey,
      blockingReason:'Stage capability execution failed'
    };
  }
  const usedRetries=Number(stageInstance.attemptCount||0);
  if(usedRetries<policy.maxRetries){
    return {transitionType:'RETRY',gateStatus:'FAIL',blockingReason:'Stage capability execution failed'};
  }
  if(policy.onRetryExhausted==='ROLLBACK'&&policy.rollbackStageKey){
    return {
      transitionType:'ROLLBACK',gateStatus:'FAIL',
      targetStageKey:policy.rollbackStageKey,
      blockingReason:'Stage retry budget exhausted'
    };
  }
  return {
    transitionType:'ESCALATE',
    gateStatus:'FAIL',
    blockingReason:'Stage retry budget exhausted'
  };
};

const insertAttempt=async({sessionId,runId,taskId,stageInstance,attemptNo,requiredCount,optionalCount})=>{
  const db=getRuntimePool();
  const id=randomUUID();
  await db.execute(
    `INSERT INTO workflow_orchestration_stage_attempts
      (id,session_id,run_id,task_id,project_stage_instance_id,stage_key,attempt_no,status,
       required_requirement_count,optional_requirement_count)
     VALUES (?,?,?,?,?,?,?,'RUNNING',?,?)`,
    [
      id,sessionId,runId,taskId,stageInstance.id,stageInstance.stageKey,attemptNo,
      requiredCount,optionalCount
    ]
  );
  return id;
};

const finishAttempt=async(attemptId,input)=>{
  const db=getRuntimePool();
  await db.execute(
    `UPDATE workflow_orchestration_stage_attempts SET
      status=?,invocation_count=?,passed_invocation_count=?,failed_invocation_count=?,
      gate_status=?,transition_type=?,transition_event_id=?,decision_json=?,
      finished_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [
      input.status,input.invocationCount,input.passedInvocationCount,input.failedInvocationCount,
      input.gateStatus,input.transitionType,input.transitionEventId||null,asJson(input.decision||null),
      attemptId
    ]
  );
};

const executeCurrentStage=async({
  sessionId,runId,projectId,template,lifecycle,stageInputs,actorKey,sessionAttemptNo,retryTaskId=null
})=>{
  const stageKey=lifecycle.project.currentStageKey;
  const stageInstance=lifecycle.stages.find(item=>item.stageKey===stageKey);
  const stage=template.stages.find(item=>item.stageKey===stageKey);
  if(!stageInstance||!stage) throw errorOf(
    'Current project stage is not present in frozen workflow',
    'WORKFLOW_STAGE_INSTANCE_DRIFT',500,{stageKey}
  );

  const requirements=stage.requirements||[];
  const required=requirements.filter(item=>item.requirementMode==='REQUIRED');
  const optional=requirements.filter(item=>item.requirementMode!=='REQUIRED');
  const policy=stagePolicyOf(stage);

  const task=retryTaskId
    ? {id:retryTaskId}
    : await createTask({
        runId,
        stageKey,
        taskKey:`orchestrate:${sessionId}:${stageKey}:${sessionAttemptNo}`,
        taskType:'WORKFLOW_STAGE_AUTO',
        sequenceNo:sessionAttemptNo,
        input:{
          orchestrationSessionId:sessionId,
          stageKey,
          inputManifest:inputManifestOf({[stageKey]:stageInputs?.[stageKey]||{}})[stageKey]||{}
        },
        maxRetries:policy.maxRetries
      });
  const attemptId=await insertAttempt({
    sessionId,runId,taskId:task.id,stageInstance,attemptNo:sessionAttemptNo,
    requiredCount:required.length,optionalCount:optional.length
  });

  if(!requirements.length&&!policy.allowAutoPassWithoutRequirements){
    const transition=await transitionProjectStage({
      projectId,runId,taskId:task.id,stageKey,
      transitionType:'ESCALATE',
      gateKey:stage.gatePolicyKey||undefined,
      gateStatus:'HOLD',
      idempotencyKey:`${sessionId}:${stageKey}:${sessionAttemptNo}:no-requirements`,
      blockingReason:'Stage has no executable capability requirements',
      criteria:{autoOrchestration:true,requirementsPresent:false},
      evidence:{orchestrationSessionId:sessionId},
      actorKey
    });
    await finishAttempt(attemptId,{
      status:'BLOCKED',invocationCount:0,passedInvocationCount:0,failedInvocationCount:0,
      gateStatus:'HOLD',transitionType:'ESCALATE',transitionEventId:transition.id,
      decision:{reasonCode:'NO_EXECUTABLE_REQUIREMENTS'}
    });
    return {transition,invocationCount:0,blocked:true};
  }

  const invocationResults=[];
  let requiredInputMissing=false;
  let requiredFailed=false;
  let optionalFailed=false;

  for(const requirement of requirements){
    const input=stageInputs?.[stageKey]?.[requirement.requirementKey];
    if(input===undefined){
      if(requirement.requirementMode==='REQUIRED'){
        requiredInputMissing=true;
        invocationResults.push({
          requirementKey:requirement.requirementKey,
          requirementMode:requirement.requirementMode,
          status:'MISSING_INPUT'
        });
      }else{
        invocationResults.push({
          requirementKey:requirement.requirementKey,
          requirementMode:requirement.requirementMode,
          status:'SKIPPED_OPTIONAL_INPUT'
        });
      }
      continue;
    }
    try{
      const result=await invokeStageCapability({
        projectId,runId,taskId:task.id,stageKey,
        requirementKey:requirement.requirementKey,
        input
      });
      const passed=result.invocation.status==='PASS';
      if(!passed&&requirement.requirementMode==='REQUIRED') requiredFailed=true;
      if(!passed&&requirement.requirementMode!=='REQUIRED') optionalFailed=true;
      invocationResults.push({
        requirementKey:requirement.requirementKey,
        requirementMode:requirement.requirementMode,
        status:result.invocation.status,
        invocationId:result.invocation.id,
        selectedCapabilityKey:result.invocation.selectedCapabilityKey
      });
    }catch(error){
      if(requirement.requirementMode==='REQUIRED') requiredFailed=true;
      else optionalFailed=true;
      invocationResults.push({
        requirementKey:requirement.requirementKey,
        requirementMode:requirement.requirementMode,
        status:'FAIL',
        errorCode:error.code||'CAPABILITY_INVOCATION_ERROR',
        invocationId:error.details?.capabilityInvocationId||null
      });
    }
  }

  const invocationCount=invocationResults.filter(x=>x.invocationId).length;
  const passedInvocationCount=invocationResults.filter(x=>x.status==='PASS').length;
  const failedInvocationCount=invocationResults.filter(x=>x.status==='FAIL'||x.status==='HOLD').length;
  const blockingFailure=requiredInputMissing||requiredFailed||(policy.optionalFailureBlocks&&optionalFailed);

  let transitionInput;
  if(!blockingFailure){
    transitionInput={
      transitionType:'PASS',
      gateStatus:'PASS',
      blockingReason:null
    };
  }else{
    transitionInput=decideFailureTransition(
      stage,stageInstance,requiredInputMissing?'REQUIRED_INPUT_MISSING':'CAPABILITY_FAILURE'
    );
  }

  const transition=await transitionProjectStage({
    projectId,runId,taskId:task.id,stageKey,
    transitionType:transitionInput.transitionType,
    targetStageKey:transitionInput.targetStageKey,
    gateKey:stage.gatePolicyKey||undefined,
    gateStatus:transitionInput.gateStatus,
    idempotencyKey:`${sessionId}:${stageKey}:${sessionAttemptNo}:${transitionInput.transitionType}`,
    blockingReason:transitionInput.blockingReason,
    criteria:{
      autoOrchestration:true,
      requiredRequirementCount:required.length,
      optionalRequirementCount:optional.length,
      optionalFailureBlocks:policy.optionalFailureBlocks,
      allRequiredPassed:!requiredInputMissing&&!requiredFailed
    },
    evidence:{
      orchestrationSessionId:sessionId,
      invocationResults
    },
    actorKey
  });

  await finishAttempt(attemptId,{
    status:transitionInput.transitionType==='PASS'
      ? 'PASS'
      : transitionInput.transitionType==='ESCALATE'
        ? 'BLOCKED'
        : transitionInput.transitionType,
    invocationCount,passedInvocationCount,failedInvocationCount,
    gateStatus:transitionInput.gateStatus,
    transitionType:transitionInput.transitionType,
    transitionEventId:transition.id,
    decision:{
      requiredInputMissing,requiredFailed,optionalFailed,
      invocationResults
    }
  });

  return {
    transition,
    invocationCount,
    blocked:transitionInput.transitionType==='ESCALATE',
    retryTaskId:transitionInput.transitionType==='RETRY'?task.id:null
  };
};

export const orchestrateProjectWorkflow=async input=>{
  if(!input?.projectId||!input?.idempotencyKey) throw errorOf(
    'projectId and idempotencyKey are required','INVALID_WORKFLOW_ORCHESTRATION'
  );
  const maxStageTransitions=Math.max(1,Math.min(500,Number(input.maxStageTransitions)||100));
  const stageInputs=input.stageInputs||{};
  const db=getRuntimePool();

  const [existing]=await db.execute(
    'SELECT * FROM workflow_orchestration_sessions WHERE idempotency_key=? LIMIT 1',
    [input.idempotencyKey]
  );
  if(existing.length){
    if(existing[0].project_id!==input.projectId) throw errorOf(
      'Idempotency key belongs to another project',
      'WORKFLOW_ORCHESTRATION_IDEMPOTENCY_CONFLICT',409
    );
    return {...await getWorkflowOrchestrationSession(existing[0].id),idempotent:true};
  }

  const {lifecycle,template}=await loadProjectAndTemplate(input.projectId);
  if(lifecycle.project.status==='BLOCKED') throw errorOf(
    'Blocked projects require explicit stage resolution before starting a new orchestration session',
    'PROJECT_REQUIRES_STAGE_RESOLUTION',409
  );

  const run=await createRun({
    projectId:input.projectId,
    runType:'WORKFLOW_AUTO',
    status:'RUNNING',
    triggerSource:input.triggerSource||'USER',
    input:{
      orchestration:true,
      inputManifest:inputManifestOf(stageInputs)
    },
    runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
    workflowVersion:template.version,
    routerVersion:'capability-router-v1'
  });

  const sessionId=randomUUID();
  await db.execute(
    `INSERT INTO workflow_orchestration_sessions
      (id,tenant_id,workspace_id,project_id,run_id,workflow_template_id,status,current_stage_key,
       max_stage_transitions,input_manifest_json,idempotency_key)
     VALUES (?,?,?,?,?,?,'RUNNING',?,?,?,?)`,
    [
      sessionId,lifecycle.project.tenantId||lifecycle.project.tenant_id||run.tenantId,
      lifecycle.project.workspaceId||lifecycle.project.workspace_id||run.workspaceId,
      input.projectId,run.id,template.id,lifecycle.project.currentStageKey,
      maxStageTransitions,asJson(inputManifestOf(stageInputs)),input.idempotencyKey
    ]
  );

  let totalInvocations=0;
  let attempts=0;
  let stopReasonCode=null;
  let stopReasonMessage=null;
  let retryTaskId=null;
  let retryStageKey=null;

  while(attempts<maxStageTransitions){
    const current=await getProjectLifecycle(input.projectId);
    if(current.project.status==='COMPLETED'){
      await updateSession(sessionId,{
        status:'PASS',currentStageKey:null,stageAttempts:attempts,
        capabilityInvocationCount:totalInvocations,
        result:{projectStatus:'COMPLETED'},finished:true
      });
      return {...await getWorkflowOrchestrationSession(sessionId),idempotent:false};
    }
    if(current.project.status==='BLOCKED'){
      stopReasonCode='PROJECT_BLOCKED';
      stopReasonMessage='Project is blocked by an escalated stage';
      break;
    }
    const stageKey=current.project.currentStageKey;
    if(!stageKey){
      stopReasonCode='CURRENT_STAGE_MISSING';
      stopReasonMessage='Active project has no current stage';
      break;
    }

    attempts++;
    await updateSession(sessionId,{
      currentStageKey:stageKey,
      stageAttempts:attempts,
      capabilityInvocationCount:totalInvocations
    });

    const result=await executeCurrentStage({
      sessionId,runId:run.id,projectId:input.projectId,
      template,lifecycle:current,stageInputs,
      actorKey:input.actorKey||'WORKFLOW_ORCHESTRATOR',
      sessionAttemptNo:attempts,
      retryTaskId:retryStageKey===stageKey?retryTaskId:null
    });
    totalInvocations+=result.invocationCount;
    retryTaskId=result.retryTaskId||null;
    retryStageKey=result.retryTaskId?stageKey:null;
    await updateSession(sessionId,{
      stageAttempts:attempts,capabilityInvocationCount:totalInvocations
    });
    if(result.blocked){
      stopReasonCode='STAGE_ESCALATED';
      stopReasonMessage='Workflow stopped because a stage escalated';
      break;
    }
  }

  const finalLifecycle=await getProjectLifecycle(input.projectId);
  if(!stopReasonCode&&attempts>=maxStageTransitions){
    stopReasonCode='ORCHESTRATION_TRANSITION_LIMIT';
    stopReasonMessage='Maximum stage transitions reached before project completion';
  }

  const terminalStatus=finalLifecycle.project.status==='COMPLETED'
    ? 'PASS'
    : finalLifecycle.project.status==='BLOCKED'
      ? 'BLOCKED'
      : 'HOLD';

  await db.execute(
    `UPDATE runs SET status=?,error_code=?,error_category=?,error_message=?,
      finished_at=CASE WHEN ? IN ('PASS','BLOCKED') THEN CURRENT_TIMESTAMP(6) ELSE finished_at END
      WHERE id=?`,
    [
      terminalStatus==='PASS'?'PASS':terminalStatus==='BLOCKED'?'HOLD':'HOLD',
      terminalStatus==='PASS'?null:stopReasonCode,
      terminalStatus==='PASS'?null:'WORKFLOW_ORCHESTRATION',
      terminalStatus==='PASS'?null:stopReasonMessage,
      terminalStatus,run.id
    ]
  );
  await updateSession(sessionId,{
    status:terminalStatus,
    currentStageKey:finalLifecycle.project.currentStageKey,
    stopReasonCode,
    stopReasonMessage,
    stageAttempts:attempts,
    capabilityInvocationCount:totalInvocations,
    result:{projectStatus:finalLifecycle.project.status},
    finished:terminalStatus!=='HOLD'
  });
  return {...await getWorkflowOrchestrationSession(sessionId),idempotent:false};
};
