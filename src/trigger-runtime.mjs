import { randomUUID } from 'node:crypto';
import { getRuntimePool,createRun,createTask,updateTask,saveCheckpoint } from './runtime-db.mjs';
import { invokeDirectCapability,completeDirectCapabilityInvocation } from './capability-runtime.mjs';
import { ensureCapabilityVersionSnapshot } from './capability-version-runtime.mjs';

const parseJson=value=>{
  if(value==null)return null;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const normalizeTrigger=row=>row?({
  triggerId:row.trigger_id,triggerKey:row.trigger_key,triggerType:row.trigger_type,
  displayName:row.display_name,status:row.status,scopeType:row.scope_type,scopeId:row.scope_id||null,
  timezone:row.timezone||null,scheduleExpr:row.schedule_expr||null,eventType:row.event_type||null,
  conditionExpr:row.condition_expr||null,dedupeWindowSeconds:Number(row.dedupe_window_seconds||0),
  enabled:Boolean(row.enabled),metadata:parseJson(row.metadata_json),
  createdAt:row.created_at,updatedAt:row.updated_at
}):null;
const normalizeBinding=row=>row?({
  id:row.id,triggerId:row.trigger_id,capabilityKey:row.capability_key,
  capabilityVersionId:row.capability_version_id,workflowTemplateId:row.workflow_template_id||null,
  stageKey:row.stage_key||null,priority:Number(row.priority),policy:parseJson(row.policy_json),
  enabled:Boolean(row.enabled),createdAt:row.created_at,updatedAt:row.updated_at
}):null;
const normalizeFire=row=>row?({
  id:row.id,triggerId:row.trigger_id,projectId:row.project_id,eventId:row.event_id||null,
  scheduledFireTime:row.scheduled_fire_time||null,dedupeKey:row.dedupe_key,status:row.status,
  runId:row.run_id||null,taskId:row.task_id||null,capabilityInvocationId:row.capability_invocation_id||null,
  result:parseJson(row.result_json),errorCode:row.error_code||null,errorMessage:row.error_message||null,
  createdAt:row.created_at,finishedAt:row.finished_at||null
}):null;
const normalizeDispatch=row=>row?({
  id:row.id,triggerFireId:row.trigger_fire_id,capabilityInvocationId:row.capability_invocation_id,
  transportMode:row.transport_mode,status:row.status,request:parseJson(row.request_json),
  responseEvidence:parseJson(row.response_evidence_json),createdAt:row.created_at,completedAt:row.completed_at||null
}):null;

export const listTriggers=async({enabled=null,triggerType=null}={})=>{
  const db=getRuntimePool(),where=[],params=[];
  if(enabled!=null){where.push('enabled=?');params.push(enabled?1:0);}
  if(triggerType){where.push('trigger_type=?');params.push(String(triggerType).toUpperCase());}
  const [rows]=await db.execute(
    `SELECT * FROM trigger_registry ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY trigger_key`,params
  );
  return rows.map(normalizeTrigger);
};

export const getTrigger=async triggerKey=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM trigger_registry WHERE trigger_key=?',[triggerKey]);
  if(!rows.length)throw errorOf('Trigger not found','TRIGGER_NOT_FOUND',404,{triggerKey});
  const trigger=normalizeTrigger(rows[0]);
  const [bindings]=await db.execute(
    'SELECT * FROM trigger_capability_bindings WHERE trigger_id=? ORDER BY priority,id',[trigger.triggerId]
  );
  return {...trigger,bindings:bindings.map(normalizeBinding)};
};

export const setTriggerEnabled=async(triggerKey,enabled)=>{
  const db=getRuntimePool();
  const [result]=await db.execute(
    'UPDATE trigger_registry SET enabled=? WHERE trigger_key=?',[enabled?1:0,triggerKey]
  );
  if(!result.affectedRows)throw errorOf('Trigger not found','TRIGGER_NOT_FOUND',404,{triggerKey});
  return getTrigger(triggerKey);
};

export const bindTriggerCapability=async input=>{
  if(!input?.triggerKey||!input?.capabilityKey)throw errorOf(
    'triggerKey and capabilityKey are required','INVALID_TRIGGER_BINDING'
  );
  const db=getRuntimePool();
  const [triggers]=await db.execute('SELECT trigger_id FROM trigger_registry WHERE trigger_key=?',[input.triggerKey]);
  if(!triggers.length)throw errorOf('Trigger not found','TRIGGER_NOT_FOUND',404);
  const version=input.capabilityVersionId
    ? {capabilityVersionId:input.capabilityVersionId}
    : await ensureCapabilityVersionSnapshot(input.capabilityKey,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO trigger_capability_bindings
      (id,trigger_id,capability_key,capability_version_id,workflow_template_id,stage_key,priority,policy_json,enabled)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       workflow_template_id=VALUES(workflow_template_id),stage_key=VALUES(stage_key),priority=VALUES(priority),
       policy_json=VALUES(policy_json),enabled=VALUES(enabled)`,
    [
      id,triggers[0].trigger_id,input.capabilityKey,version.capabilityVersionId,
      input.workflowTemplateId||null,input.stageKey||null,Number(input.priority||100),
      asJson(input.policy||null),input.enabled===false?0:1
    ]
  );
  return getTrigger(input.triggerKey);
};

const loadFireTarget=async(triggerKey,projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT t.*,p.id AS resolved_project_id,p.project_type,p.project_key,p.name AS project_name,p.status AS project_status
       FROM trigger_registry t
       JOIN projects p ON p.id=?
      WHERE t.trigger_key=?`,
    [projectId,triggerKey]
  );
  if(!rows.length)throw errorOf('Trigger/project target could not be resolved','TRIGGER_TARGET_NOT_FOUND',404);
  const row=rows[0];
  if(row.project_status!=='ACTIVE')throw errorOf('Trigger target project is not active','PROJECT_NOT_ACTIVE',409);
  if(row.scope_type==='PROJECT'&&row.scope_id!==projectId)throw errorOf(
    'Trigger is not scoped to this project','TRIGGER_SCOPE_MISMATCH',409
  );
  if(row.scope_type==='PROJECT_TYPE'&&row.scope_id&&row.scope_id!==row.project_type)throw errorOf(
    'Trigger project type scope mismatch','TRIGGER_SCOPE_MISMATCH',409
  );
  const metadata=parseJson(row.metadata_json)||{};
  if(metadata.targetProjectName&&metadata.targetProjectName!==row.project_name)throw errorOf(
    'Trigger target project name mismatch','TRIGGER_SCOPE_MISMATCH',409
  );
  return row;
};

const dedupeKeyOf=({triggerKey,projectId,scheduledFireTime,eventId})=>
  [triggerKey,projectId,eventId||scheduledFireTime||'manual'].join(':');

export const fireTrigger=async input=>{
  if(!input?.triggerKey||!input?.projectId)throw errorOf(
    'triggerKey and projectId are required','INVALID_TRIGGER_FIRE'
  );
  const db=getRuntimePool();
  const target=await loadFireTarget(input.triggerKey,input.projectId,db);
  if(!target.enabled&&!input.allowDisabledShadow)throw errorOf(
    'Trigger is disabled','TRIGGER_DISABLED',409,{triggerKey:input.triggerKey}
  );
  const [bindings]=await db.execute(
    `SELECT b.* FROM trigger_capability_bindings b
      WHERE b.trigger_id=? AND b.enabled=TRUE ORDER BY b.priority,b.id LIMIT 1`,
    [target.trigger_id]
  );
  if(!bindings.length)throw errorOf('Trigger has no enabled capability binding','TRIGGER_BINDING_NOT_FOUND',409);
  const binding=bindings[0];
  const dedupeKey=input.dedupeKey||dedupeKeyOf({
    triggerKey:target.trigger_key,projectId:input.projectId,
    scheduledFireTime:input.scheduledFireTime||null,eventId:input.eventId||null
  });
  const [existing]=await db.execute('SELECT * FROM trigger_fires WHERE dedupe_key=? LIMIT 1',[dedupeKey]);
  if(existing.length)return {...normalizeFire(existing[0]),idempotent:true};

  const fireId=randomUUID();
  await db.execute(
    `INSERT INTO trigger_fires
      (id,trigger_id,project_id,event_id,scheduled_fire_time,dedupe_key,status)
     VALUES (?,?,?,?,?,?,'RUNNING')`,
    [fireId,target.trigger_id,input.projectId,input.eventId||null,input.scheduledFireTime||null,dedupeKey]
  );

  let run=null,task=null,invocationResult=null;
  try{
    run=await createRun({
      projectId:input.projectId,runType:'TRIGGER',status:'RUNNING',
      triggerSource:`RUNTIME_TRIGGER:${target.trigger_key}`,
      input:{triggerKey:target.trigger_key,triggerFireId:fireId,eventId:input.eventId||null,
        scheduledFireTime:input.scheduledFireTime||null},
      runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
      routerVersion:'trigger-router-v1'
    });
    task=await createTask({
      runId:run.id,stageKey:binding.stage_key||'TRIGGER',
      taskKey:`trigger:${target.trigger_key}:${fireId}`,
      taskType:'TRIGGER_CAPABILITY',sequenceNo:1,
      input:{triggerKey:target.trigger_key,capabilityKey:binding.capability_key}
    });
    await db.execute('UPDATE trigger_fires SET run_id=?,task_id=? WHERE id=?',[run.id,task.id,fireId]);

    invocationResult=await invokeDirectCapability({
      projectId:input.projectId,runId:run.id,taskId:task.id,
      capabilityKey:binding.capability_key,capabilityVersionId:binding.capability_version_id,
      triggerFireId:fireId,input:input.capabilityInput||{
        projectKey:target.project_key,
        checkpointPath:parseJson(binding.policy_json)?.checkpointPath||null,
        sourceScopes:['/你好那年夏天/'],
        resumePoint:input.resumePoint||null,
        triggerReason:input.triggerReason||target.trigger_key
      }
    });

    const status=invocationResult.invocation.status;
    if(status==='HOLD'){
      const dispatchId=randomUUID();
      await db.execute(
        `INSERT INTO trigger_dispatches
          (id,trigger_fire_id,capability_invocation_id,transport_mode,status,request_json)
         VALUES (?,?,?,'CHATGPT_LIBRARY_BRIDGE','PENDING',?)`,
        [
          dispatchId,fireId,invocationResult.invocation.id,
          asJson({
            triggerKey:target.trigger_key,projectId:input.projectId,
            capabilityKey:binding.capability_key,capabilityVersionId:binding.capability_version_id,
            adapterKey:invocationResult.invocation.adapterKey,
            payload:invocationResult.output?.bridgeRequest||null
          })
        ]
      );
      await updateTask(task.id,{status:'BLOCKED',output:{dispatchId,status:'PENDING_EXTERNAL_CONTEXT'}});
      await saveCheckpoint(run.id,{
        taskId:task.id,checkpointType:'TRIGGER_BRIDGE',status:'VALID',
        stageKey:binding.stage_key||'TRIGGER',stepKey:'AWAIT_EXTERNAL_CONTEXT',
        state:{triggerFireId:fireId,dispatchId,capabilityInvocationId:invocationResult.invocation.id},
        pendingTaskKeys:[task.taskKey],blockedTaskKeys:[task.taskKey],
        resumeFromTaskKey:task.taskKey,runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
        routerVersion:'trigger-router-v1'
      });
      await db.execute(
        `UPDATE trigger_fires SET status='DISPATCH_PENDING',capability_invocation_id=?,result_json=? WHERE id=?`,
        [invocationResult.invocation.id,asJson({dispatchId,bridge:true}),fireId]
      );
    }else{
      await updateTask(task.id,{status:'PASS',output:invocationResult.output,finished:true});
      await db.execute(
        `UPDATE trigger_fires SET status='PASS',capability_invocation_id=?,result_json=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
        [invocationResult.invocation.id,asJson(invocationResult.output||null),fireId]
      );
    }
  }catch(error){
    if(task)await updateTask(task.id,{
      status:'FAIL',errorCode:error.code||'TRIGGER_EXECUTION_ERROR',errorCategory:'TRIGGER_RUNTIME',
      errorMessage:error.message,finished:true
    }).catch(()=>{});
    await db.execute(
      `UPDATE trigger_fires SET status='FAIL',error_code=?,error_message=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [error.code||'TRIGGER_EXECUTION_ERROR',error.message,fireId]
    );
    throw error;
  }

  const [rows]=await db.execute('SELECT * FROM trigger_fires WHERE id=?',[fireId]);
  return {...normalizeFire(rows[0]),idempotent:false};
};

export const listPendingTriggerDispatches=async({limit=50}={})=>{
  const db=getRuntimePool();
  const safe=Math.max(1,Math.min(200,Number(limit)||50));
  const [rows]=await db.execute(
    `SELECT * FROM trigger_dispatches WHERE status='PENDING' ORDER BY created_at LIMIT ${safe}`
  );
  return rows.map(normalizeDispatch);
};

export const completeTriggerDispatch=async(dispatchId,input)=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT d.*,f.run_id,f.task_id,f.id AS fire_id
       FROM trigger_dispatches d JOIN trigger_fires f ON f.id=d.trigger_fire_id
      WHERE d.id=? LIMIT 1`,[dispatchId]
  );
  if(!rows.length)throw errorOf('Trigger dispatch not found','TRIGGER_DISPATCH_NOT_FOUND',404);
  const row=rows[0];
  if(row.status==='COMPLETED')return normalizeDispatch(row);
  if(row.status!=='PENDING')throw errorOf('Trigger dispatch is not completable','TRIGGER_DISPATCH_NOT_PENDING',409);

  const status=input?.status==='FAIL'?'FAIL':'PASS';
  const completed=await completeDirectCapabilityInvocation(row.capability_invocation_id,{
    status,output:input?.output||null,evidence:input?.evidence||null,
    errorCode:input?.errorCode||null,errorMessage:input?.errorMessage||null
  });

  await db.execute(
    `UPDATE trigger_dispatches SET status='COMPLETED',response_evidence_json=?,completed_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
    [asJson(input?.evidence||null),dispatchId]
  );
  await updateTask(row.task_id,{
    status,output:input?.output||null,errorCode:input?.errorCode||null,
    errorCategory:status==='FAIL'?'EXTERNAL_EXECUTOR':null,errorMessage:input?.errorMessage||null,finished:true
  });
  await db.execute(
    `UPDATE trigger_fires SET status=?,result_json=?,error_code=?,error_message=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
    [status,asJson(input?.output||null),input?.errorCode||null,input?.errorMessage||null,row.fire_id]
  );
  await saveCheckpoint(row.run_id,{
    taskId:row.task_id,checkpointType:'TRIGGER_COMPLETE',status:status==='PASS'?'VALID':'INVALID',
    stageKey:'TRIGGER',stepKey:status,
    state:{triggerFireId:row.fire_id,dispatchId,capabilityInvocationId:row.capability_invocation_id},
    completedTaskKeys:status==='PASS'?[row.task_id]:[],blockedTaskKeys:status==='FAIL'?[row.task_id]:[],
    resumeFromTaskKey:null,runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
    routerVersion:'trigger-router-v1'
  });
  return {dispatchId,triggerFireId:row.fire_id,status,invocation:completed};
};

export const getTriggerFire=async fireId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM trigger_fires WHERE id=?',[fireId]);
  if(!rows.length)throw errorOf('Trigger fire not found','TRIGGER_FIRE_NOT_FOUND',404);
  return normalizeFire(rows[0]);
};
