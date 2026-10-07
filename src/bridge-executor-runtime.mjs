import { randomUUID } from 'node:crypto';
import { getRuntimePool,updateTask,saveCheckpoint } from './runtime-db.mjs';
import { completeDirectCapabilityInvocation } from './capability-runtime.mjs';

const parseJson=value=>{
  if(value==null)return null;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const actorOf=principal=>({
  type:principal?.platformAdmin?'PLATFORM':(principal?.type||'UNKNOWN'),
  credentialId:principal?.credentialId||null,
  identityId:principal?.identityId||null
});
const NOVEL_SKILL_KEY='SKILL:NOVEL_CONTINUOUS_UPDATE';
const novelOutputKeys=new Set([
  'status','updatedChapters','reusedPassChapters','gateStatus',
  'checkpointPath','resumePoint','blockingReason'
]);
const validateBridgeEvidence=value=>{
  if(value==null)return null;
  const encoded=JSON.stringify(value);
  if(encoded.length>16384)throw errorOf(
    'Bridge evidence is too large','BRIDGE_EVIDENCE_TOO_LARGE',400
  );
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      if(/(?:^|_)(?:content|body|text|raw|source_body|chapter_text)(?:$|_)/i.test(key)){
        throw errorOf(
          'Bridge evidence must not contain source bodies or generated prose',
          'BRIDGE_SOURCE_BODY_NOT_ALLOWED',400,{field:key}
        );
      }
      walk(child);
    }
  };
  walk(value);
  return value;
};
const validateBridgeOutput=(row,value)=>{
  const output=value||{};
  const request=parseJson(row.request_json)||{};
  if(request.capabilityKey!==NOVEL_SKILL_KEY)return output;
  if(!output||typeof output!=='object'||Array.isArray(output))throw errorOf(
    'Novel bridge output must be an object','BRIDGE_OUTPUT_CONTRACT_VIOLATION',400
  );
  const unknown=Object.keys(output).filter(key=>!novelOutputKeys.has(key));
  if(unknown.length)throw errorOf(
    'Novel bridge output contains fields outside the status-only contract',
    'BRIDGE_SOURCE_BODY_NOT_ALLOWED',400,{fields:unknown}
  );
  for(const key of ['status','gateStatus','checkpointPath']){
    if(typeof output[key]!=='string'||!output[key].trim())throw errorOf(
      'Novel bridge output is missing required status metadata',
      'BRIDGE_OUTPUT_CONTRACT_VIOLATION',400,{field:key}
    );
  }
  for(const key of ['updatedChapters','reusedPassChapters']){
    if(output[key]!=null&&(!Array.isArray(output[key])||output[key].some(x=>typeof x!=='string'))){
      throw errorOf('Novel bridge chapter lists must contain strings','BRIDGE_OUTPUT_CONTRACT_VIOLATION',400,{field:key});
    }
  }
  return {
    status:output.status,
    updatedChapters:output.updatedChapters||[],
    reusedPassChapters:output.reusedPassChapters||[],
    gateStatus:output.gateStatus,
    checkpointPath:output.checkpointPath,
    resumePoint:output.resumePoint??null,
    blockingReason:output.blockingReason??null
  };
};

const normalize=row=>row?({
  id:row.id,
  triggerFireId:row.trigger_fire_id,
  capabilityInvocationId:row.capability_invocation_id,
  projectId:row.project_id||null,
  tenantId:row.tenant_id||null,
  workspaceId:row.workspace_id||null,
  transportMode:row.transport_mode,
  status:row.status,
  attemptCount:Number(row.attempt_count||0),
  maxAttempts:Number(row.max_attempts||0),
  claimedByCredentialId:row.claimed_by_credential_id||null,
  claimedByIdentityId:row.claimed_by_identity_id||null,
  claimedAt:row.claimed_at||null,
  leaseExpiresAt:row.lease_expires_at||null,
  nextAttemptAt:row.next_attempt_at||null,
  lastErrorCode:row.last_error_code||null,
  lastErrorMessage:row.last_error_message||null,
  request:parseJson(row.request_json),
  responseEvidence:parseJson(row.response_evidence_json),
  createdAt:row.created_at,
  completedAt:row.completed_at||null,
  deadLetteredAt:row.dead_lettered_at||null
}):null;

const event=async(db,row,eventType,principal,metadata=null)=>{
  const actor=actorOf(principal);
  await db.execute(
    `INSERT INTO trigger_dispatch_events
      (id,trigger_dispatch_id,trigger_fire_id,event_type,actor_type,actor_credential_id,actor_identity_id,attempt_no,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),row.id,row.trigger_fire_id,eventType,actor.type,
      actor.credentialId,actor.identityId,Number(row.attempt_count||0),asJson(metadata)
    ]
  );
};

const selectDispatch=async(db,dispatchId,forUpdate=false)=>{
  const [rows]=await db.execute(
    `SELECT d.*,f.project_id,f.run_id,f.task_id,f.id AS fire_id,
            p.tenant_id,p.workspace_id,t.task_key,t.stage_key AS task_stage_key
       FROM trigger_dispatches d
       JOIN trigger_fires f ON f.id=d.trigger_fire_id
       JOIN projects p ON p.id=f.project_id
       JOIN tasks t ON t.id=f.task_id
      WHERE d.id=? LIMIT 1${forUpdate?' FOR UPDATE':''}`,
    [dispatchId]
  );
  if(!rows.length)throw errorOf('Bridge dispatch not found','BRIDGE_DISPATCH_NOT_FOUND',404,{dispatchId});
  return rows[0];
};

export const resolveBridgeDispatchScope=async dispatchId=>{
  const db=getRuntimePool();
  const row=await selectDispatch(db,dispatchId,false);
  return {tenantId:row.tenant_id,workspaceId:row.workspace_id,projectId:row.project_id};
};

export const listBridgeDispatches=async({projectId,status='CLAIMABLE',limit=50}={})=>{
  if(!projectId)throw errorOf('projectId is required','BRIDGE_PROJECT_REQUIRED');
  const db=getRuntimePool();
  const safe=Math.max(1,Math.min(200,Number(limit)||50));
  let statusSql='';
  const params=[projectId];
  if(status==='CLAIMABLE'){
    statusSql=`AND (
      d.status='PENDING'
      OR (d.status='RETRY' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=CURRENT_TIMESTAMP(6)))
      OR (d.status='CLAIMED' AND d.lease_expires_at<CURRENT_TIMESTAMP(6))
    )`;
  }else if(status&&status!=='ALL'){
    statusSql='AND d.status=?';
    params.push(String(status).toUpperCase());
  }
  const [rows]=await db.execute(
    `SELECT d.*,f.project_id,p.tenant_id,p.workspace_id
       FROM trigger_dispatches d
       JOIN trigger_fires f ON f.id=d.trigger_fire_id
       JOIN projects p ON p.id=f.project_id
      WHERE f.project_id=? ${statusSql}
      ORDER BY d.created_at
      LIMIT ${safe}`,
    params
  );
  return rows.map(normalize);
};

const assertActorOwnsClaim=(row,principal)=>{
  if(principal?.platformAdmin)return;
  if(!principal?.credentialId||row.claimed_by_credential_id!==principal.credentialId){
    throw errorOf(
      'Bridge dispatch is leased to another executor',
      'BRIDGE_DISPATCH_LEASE_OWNERSHIP_REQUIRED',409,
      {dispatchId:row.id}
    );
  }
};

export const claimBridgeDispatch=async(dispatchId,{leaseSeconds=900}={},principal)=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  let claimed=null,exhausted=false;
  try{
    await conn.beginTransaction();
    let row=await selectDispatch(conn,dispatchId,true);
    if(row.status==='COMPLETED'||row.status==='DEAD_LETTER'){
      throw errorOf('Bridge dispatch is terminal','BRIDGE_DISPATCH_TERMINAL',409,{status:row.status});
    }
    const now=Date.now();
    const leaseExpired=row.lease_expires_at&&new Date(row.lease_expires_at).getTime()<=now;
    const retryReady=!row.next_attempt_at||new Date(row.next_attempt_at).getTime()<=now;
    const claimable=row.status==='PENDING'||
      (row.status==='RETRY'&&retryReady)||
      (row.status==='CLAIMED'&&leaseExpired);
    if(!claimable){
      throw errorOf(
        'Bridge dispatch is not claimable',
        row.status==='CLAIMED'?'BRIDGE_DISPATCH_LEASE_HELD':'BRIDGE_DISPATCH_NOT_READY',
        409,{status:row.status,leaseExpiresAt:row.lease_expires_at,nextAttemptAt:row.next_attempt_at}
      );
    }

    const actor=actorOf(principal);
    if(Number(row.attempt_count||0)>=Number(row.max_attempts||3)){
      // Take a short recovery lease without incrementing attempts, then terminalize
      // through the same crash-safe dead-letter path used by explicit executor failure.
      await conn.execute(
        `UPDATE trigger_dispatches
            SET status='CLAIMED',
                claimed_by_credential_id=?,
                claimed_by_identity_id=?,
                claimed_at=CURRENT_TIMESTAMP(6),
                lease_expires_at=TIMESTAMPADD(SECOND,30,CURRENT_TIMESTAMP(6)),
                next_attempt_at=NULL
          WHERE id=?`,
        [actor.credentialId,actor.identityId,dispatchId]
      );
      row=await selectDispatch(conn,dispatchId,true);
      await event(conn,row,'CLAIM_EXHAUSTED',principal,{reason:'MAX_ATTEMPTS_EXCEEDED'});
      exhausted=true;
    }else{
      const safeLease=Math.max(30,Math.min(3600,Number(leaseSeconds)||900));
      await conn.execute(
        `UPDATE trigger_dispatches
            SET status='CLAIMED',
                attempt_count=attempt_count+1,
                claimed_by_credential_id=?,
                claimed_by_identity_id=?,
                claimed_at=CURRENT_TIMESTAMP(6),
                lease_expires_at=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(6)),
                next_attempt_at=NULL
          WHERE id=?`,
        [actor.credentialId,actor.identityId,safeLease,dispatchId]
      );
      row=await selectDispatch(conn,dispatchId,true);
      await event(conn,row,leaseExpired?'RECLAIMED':'CLAIMED',principal,{leaseSeconds:safeLease});
      claimed=normalize(row);
    }
    await conn.commit();
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{
    conn.release();
  }

  if(exhausted){
    return failBridgeDispatch(dispatchId,{
      retryable:false,
      errorCode:'BRIDGE_MAX_ATTEMPTS_EXCEEDED',
      errorMessage:'Maximum bridge attempts exceeded'
    },principal);
  }
  return claimed;
};

export const renewBridgeDispatchLease=async(dispatchId,{leaseSeconds=900}={},principal)=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    let row=await selectDispatch(conn,dispatchId,true);
    if(row.status!=='CLAIMED')throw errorOf('Bridge dispatch is not claimed','BRIDGE_DISPATCH_NOT_CLAIMED',409);
    assertActorOwnsClaim(row,principal);
    if(row.lease_expires_at&&new Date(row.lease_expires_at).getTime()<=Date.now()){
      throw errorOf('Bridge dispatch lease has expired','BRIDGE_DISPATCH_LEASE_EXPIRED',409);
    }
    const safeLease=Math.max(30,Math.min(3600,Number(leaseSeconds)||900));
    await conn.execute(
      'UPDATE trigger_dispatches SET lease_expires_at=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(6)) WHERE id=?',
      [safeLease,dispatchId]
    );
    row=await selectDispatch(conn,dispatchId,true);
    await event(conn,row,'LEASE_RENEWED',principal,{leaseSeconds:safeLease});
    await conn.commit();
    return normalize(row);
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
};

export const completeBridgeDispatch=async(dispatchId,input,principal)=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  let row;
  try{
    await conn.beginTransaction();
    row=await selectDispatch(conn,dispatchId,true);
    if(row.status==='COMPLETED'){
      await conn.commit();
      return {...normalize(row),idempotent:true};
    }
    if(row.status!=='CLAIMED')throw errorOf('Bridge dispatch is not claimed','BRIDGE_DISPATCH_NOT_CLAIMED',409);
    assertActorOwnsClaim(row,principal);
    if(row.lease_expires_at&&new Date(row.lease_expires_at).getTime()<=Date.now()){
      throw errorOf('Bridge dispatch lease has expired','BRIDGE_DISPATCH_LEASE_EXPIRED',409);
    }
    await conn.commit();
  }catch(error){
    try{await conn.rollback();}catch{}
    conn.release();
    throw error;
  }
  conn.release();

  const safeOutput=validateBridgeOutput(row,input?.output||null);
  const safeEvidence=validateBridgeEvidence(input?.evidence||null);
  const completed=await completeDirectCapabilityInvocation(row.capability_invocation_id,{
    status:'PASS',output:safeOutput,evidence:{
      ...(safeEvidence||{}),
      bridgeExecutor:{
        credentialId:principal?.credentialId||null,
        identityId:principal?.identityId||null
      }
    }
  });

  const conn2=await db.getConnection();
  try{
    await conn2.beginTransaction();
    row=await selectDispatch(conn2,dispatchId,true);
    if(row.status==='COMPLETED'){
      await conn2.commit();
      return {...normalize(row),idempotent:true};
    }
    assertActorOwnsClaim(row,principal);
    await conn2.execute(
      `UPDATE trigger_dispatches
          SET status='COMPLETED',response_evidence_json=?,completed_at=CURRENT_TIMESTAMP(6),
              lease_expires_at=NULL,last_error_code=NULL,last_error_message=NULL
        WHERE id=?`,
      [asJson(safeEvidence||null),dispatchId]
    );
    row=await selectDispatch(conn2,dispatchId,true);
    await event(conn2,row,'COMPLETED',principal,{});
    await conn2.execute(
      `UPDATE trigger_fires
          SET status='PASS',result_json=?,error_code=NULL,error_message=NULL,finished_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [asJson(safeOutput),row.fire_id]
    );
    await conn2.commit();
  }catch(error){
    try{await conn2.rollback();}catch{}
    throw error;
  }finally{conn2.release();}

  await updateTask(row.task_id,{status:'PASS',output:safeOutput,finished:true});
  await saveCheckpoint(row.run_id,{
    taskId:row.task_id,checkpointType:'TRIGGER_COMPLETE',status:'VALID',
    stageKey:row.task_stage_key,stepKey:'PASS',
    state:{triggerFireId:row.fire_id,dispatchId,capabilityInvocationId:row.capability_invocation_id},
    completedTaskKeys:[row.task_key],blockedTaskKeys:[],pendingTaskKeys:[],
    resumeFromTaskKey:null,runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
    routerVersion:'trigger-router-v1'
  });
  return {dispatchId,triggerFireId:row.fire_id,status:'PASS',invocation:completed,idempotent:false};
};

export const failBridgeDispatch=async(dispatchId,input={},principal)=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  let row,terminal=false;
  try{
    await conn.beginTransaction();
    row=await selectDispatch(conn,dispatchId,true);
    if(row.status==='DEAD_LETTER')return {...normalize(row),idempotent:true};
    if(row.status!=='CLAIMED')throw errorOf('Bridge dispatch is not claimed','BRIDGE_DISPATCH_NOT_CLAIMED',409);
    assertActorOwnsClaim(row,principal);
    const retryable=input.retryable!==false;
    terminal=!retryable||Number(row.attempt_count)>=Number(row.max_attempts);
    if(terminal){
      // Keep the dispatch CLAIMED until the exact invocation is terminal.
      // This makes a retry safe if the process stops between invocation finalization and dispatch finalization.
    }else{
      const requestedRetry=input.retryAfterSeconds==null?60:Number(input.retryAfterSeconds);
      const retryAfter=Math.max(0,Math.min(86400,Number.isFinite(requestedRetry)?requestedRetry:60));
      await conn.execute(
        `UPDATE trigger_dispatches
            SET status='RETRY',lease_expires_at=NULL,claimed_at=NULL,
                claimed_by_credential_id=NULL,claimed_by_identity_id=NULL,
                next_attempt_at=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(6)),
                last_error_code=?,last_error_message=?
          WHERE id=?`,
        [retryAfter,input.errorCode||'BRIDGE_EXECUTOR_RETRY',input.errorMessage||'Bridge executor retry requested',dispatchId]
      );
      row=await selectDispatch(conn,dispatchId,true);
      await event(conn,row,'RETRY_SCHEDULED',principal,{retryAfterSeconds:retryAfter,errorCode:input.errorCode||null});
    }
    await conn.commit();
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}

  if(!terminal)return normalize(row);

  const completed=await completeDirectCapabilityInvocation(row.capability_invocation_id,{
    status:'FAIL',output:null,evidence:{
      bridgeExecutor:{
        credentialId:principal?.credentialId||null,
        identityId:principal?.identityId||null
      },
      deadLetter:true
    },
    errorCode:input.errorCode||'BRIDGE_EXECUTOR_FAILED',
    errorMessage:input.errorMessage||'Bridge executor failed'
  });

  const terminalConn=await db.getConnection();
  try{
    await terminalConn.beginTransaction();
    let terminalRow=await selectDispatch(terminalConn,dispatchId,true);
    if(terminalRow.status!=='DEAD_LETTER'){
      assertActorOwnsClaim(terminalRow,principal);
      await terminalConn.execute(
        `UPDATE trigger_dispatches
            SET status='DEAD_LETTER',dead_lettered_at=CURRENT_TIMESTAMP(6),completed_at=CURRENT_TIMESTAMP(6),
                lease_expires_at=NULL,last_error_code=?,last_error_message=?
          WHERE id=?`,
        [input.errorCode||'BRIDGE_EXECUTOR_FAILED',input.errorMessage||'Bridge executor failed',dispatchId]
      );
      terminalRow=await selectDispatch(terminalConn,dispatchId,true);
      await event(terminalConn,terminalRow,'DEAD_LETTER',principal,{
        retryable:input.retryable!==false,errorCode:input.errorCode||null
      });
    }
    await terminalConn.commit();
    row=terminalRow;
  }catch(error){
    try{await terminalConn.rollback();}catch{}
    throw error;
  }finally{terminalConn.release();}

  await updateTask(row.task_id,{
    status:'FAIL',errorCode:input.errorCode||'BRIDGE_EXECUTOR_FAILED',
    errorCategory:'EXTERNAL_EXECUTOR',errorMessage:input.errorMessage||'Bridge executor failed',finished:true
  });
  await db.execute(
    `UPDATE trigger_fires
        SET status='FAIL',error_code=?,error_message=?,finished_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [input.errorCode||'BRIDGE_EXECUTOR_FAILED',input.errorMessage||'Bridge executor failed',row.fire_id]
  );
  await saveCheckpoint(row.run_id,{
    taskId:row.task_id,checkpointType:'TRIGGER_COMPLETE',status:'INVALID',
    stageKey:row.task_stage_key,stepKey:'FAIL',
    state:{triggerFireId:row.fire_id,dispatchId,capabilityInvocationId:row.capability_invocation_id,deadLetter:true},
    completedTaskKeys:[],blockedTaskKeys:[row.task_key],pendingTaskKeys:[],
    resumeFromTaskKey:row.task_key,runtimeCommitSha:process.env.RUNTIME_COMMIT_SHA||null,
    routerVersion:'trigger-router-v1'
  });
  return {dispatchId,triggerFireId:row.fire_id,status:'DEAD_LETTER',invocation:completed,idempotent:false};
};

export const listBridgeDispatchEvents=async dispatchId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM trigger_dispatch_events
      WHERE trigger_dispatch_id=? ORDER BY created_at,id`,[dispatchId]
  );
  return rows.map(row=>({
    id:row.id,triggerDispatchId:row.trigger_dispatch_id,triggerFireId:row.trigger_fire_id,
    eventType:row.event_type,actorType:row.actor_type,
    actorCredentialId:row.actor_credential_id||null,actorIdentityId:row.actor_identity_id||null,
    attemptNo:Number(row.attempt_no||0),metadata:parseJson(row.metadata_json),createdAt:row.created_at
  }));
};
