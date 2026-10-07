import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { fireTrigger } from './trigger-runtime.mjs';

const GATE='G-M29-AUTOMATION';
const INTAKE_TYPES=new Set(['SCHEDULE','EVENT','WEBHOOK']);
const SCOPE_TYPES=new Set(['PROJECT','PROJECT_TYPE']);
const SECRET_KEY=/token|secret|password|credential|api.?key|authorization|cookie|raw.?body|^signature$/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const containsSecret=value=>{
  if(!value||typeof value!=='object')return false;
  for(const [key,child] of Object.entries(value)){
    if(SECRET_KEY.test(key))return true;
    if(containsSecret(child))return true;
  }
  return false;
};
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
};
const sha256=value=>createHash('sha256').update(JSON.stringify(stable(value??{}))).digest('hex');
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key,status FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadTrigger=async(triggerKey,db)=>{
  const [rows]=await db.execute('SELECT * FROM trigger_registry WHERE trigger_key=?',[triggerKey]);
  if(!rows.length)throw errorOf('Trigger not found','TRIGGER_NOT_FOUND',404,{triggerKey});
  return rows[0];
};
const triggerApplies=(trigger,project)=>{
  if(trigger.status!=='ACTIVE'||!Boolean(trigger.enabled))return false;
  if(trigger.scope_type==='PROJECT'&&trigger.scope_id!==project.id)return false;
  if(trigger.scope_type==='PROJECT_TYPE'&&trigger.scope_id!==project.project_type)return false;
  if(!SCOPE_TYPES.has(trigger.scope_type))return false;
  const metadata=parseJson(trigger.metadata_json)||{};
  if(metadata.targetProjectName&&metadata.targetProjectName!==project.name)return false;
  return true;
};

const parseCronField=(expr,min,max,{dow=false}={})=>{
  const values=new Set();
  const add=n=>{
    const v=Number(n);
    if(!Number.isInteger(v)||v<min||v>max)throw errorOf(
      'Cron field is invalid','M29_AUTOMATION_CRON_INVALID',409,{expr,min,max}
    );
    values.add(dow&&v===7?0:v);
  };
  for(const rawPart of String(expr).split(',')){
    const part=rawPart.trim();
    if(!part)throw errorOf('Cron field is invalid','M29_AUTOMATION_CRON_INVALID',409,{expr});
    const [base,stepRaw]=part.split('/');
    if(part.split('/').length>2)throw errorOf('Cron step is invalid','M29_AUTOMATION_CRON_INVALID',409,{expr});
    const step=stepRaw==null?1:Number(stepRaw);
    if(!Number.isInteger(step)||step<1)throw errorOf('Cron step is invalid','M29_AUTOMATION_CRON_INVALID',409,{expr});
    if(base==='*'){
      for(let i=min;i<=max;i+=step)add(i);
      continue;
    }
    if(base.includes('-')){
      const [aRaw,bRaw]=base.split('-');
      const a=Number(aRaw),b=Number(bRaw);
      if(!Number.isInteger(a)||!Number.isInteger(b)||a<min||b>max||a>b)
        throw errorOf('Cron range is invalid','M29_AUTOMATION_CRON_INVALID',409,{expr});
      for(let i=a;i<=b;i+=step)add(i);
      continue;
    }
    if(stepRaw!=null)throw errorOf('Cron step requires wildcard or range','M29_AUTOMATION_CRON_INVALID',409,{expr});
    add(base);
  }
  return values;
};
const cronMatches=(date,expr,timeZone)=>{
  const fields=String(expr||'').trim().split(/\s+/);
  if(fields.length!==5)throw errorOf('Cron must have five fields','M29_AUTOMATION_CRON_INVALID',409,{expr});
  let parts;
  try{
    parts=Object.fromEntries(
      new Intl.DateTimeFormat('en-US',{
        timeZone,year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',hourCycle:'h23',minute:'2-digit',weekday:'short'
      }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value])
    );
  }catch{
    throw errorOf('Trigger timezone is invalid','M29_AUTOMATION_TIMEZONE_INVALID',409,{timeZone});
  }
  const weekdayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  const minute=Number(parts.minute),hour=Number(parts.hour),day=Number(parts.day),
    month=Number(parts.month),dow=weekdayMap[parts.weekday];
  const [mExpr,hExpr,domExpr,monExpr,dowExpr]=fields;
  const minuteOk=parseCronField(mExpr,0,59).has(minute);
  const hourOk=parseCronField(hExpr,0,23).has(hour);
  const monthOk=parseCronField(monExpr,1,12).has(month);
  const domOk=parseCronField(domExpr,1,31).has(day);
  const dowOk=parseCronField(dowExpr,0,7,{dow:true}).has(dow);
  const domWildcard=domExpr==='*',dowWildcard=dowExpr==='*';
  const dayOk=domWildcard&&dowWildcard?true:domWildcard?dowOk:dowWildcard?domOk:(domOk||dowOk);
  return minuteOk&&hourOk&&monthOk&&dayOk;
};

export const resolveM29AutomationProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const registerM29AutomationTrigger=async(input={})=>{
  requireFields(input,[
    'triggerKey','triggerType','displayName','scopeType','scopeId','evidence'
  ],'INVALID_M29_AUTOMATION_TRIGGER');
  const triggerType=upper(input.triggerType),scopeType=upper(input.scopeType);
  if(!INTAKE_TYPES.has(triggerType))throw errorOf(
    'triggerType must be SCHEDULE/EVENT/WEBHOOK','M29_AUTOMATION_TRIGGER_TYPE_INVALID',409
  );
  if(!SCOPE_TYPES.has(scopeType))throw errorOf(
    'M29 automation trigger scope must be PROJECT or PROJECT_TYPE',
    'M29_AUTOMATION_SCOPE_INVALID',409
  );
  if(containsSecret(input.metadata)||containsSecret(input.evidence))
    throw errorOf('Automation trigger metadata must not contain credentials',
      'M29_AUTOMATION_SECRET_NOT_ALLOWED',400);

  if(triggerType==='SCHEDULE'){
    if(!nonEmpty(input.timezone)||!nonEmpty(input.scheduleExpr))
      throw errorOf('Schedule trigger requires timezone and scheduleExpr',
        'M29_AUTOMATION_SCHEDULE_REQUIRED',409);
    cronMatches(new Date(),input.scheduleExpr,input.timezone);
  }else if(!nonEmpty(input.eventType)){
    throw errorOf('Event/Webhook trigger requires eventType','M29_AUTOMATION_EVENT_TYPE_REQUIRED',409);
  }

  const db=getRuntimePool();
  const [existingRows]=await db.execute('SELECT * FROM trigger_registry WHERE trigger_key=?',[input.triggerKey]);
  if(existingRows.length){
    const existing=existingRows[0];
    const same=existing.trigger_type===triggerType&&existing.scope_type===scopeType&&
      existing.scope_id===input.scopeId&&
      (existing.timezone||null)===(input.timezone||null)&&
      (existing.schedule_expr||null)===(input.scheduleExpr||null)&&
      (existing.event_type||null)===(input.eventType||null);
    if(!same)throw errorOf('Trigger key already exists with different contract',
      'M29_AUTOMATION_TRIGGER_CONFLICT',409,{triggerKey:input.triggerKey});
    return {
      triggerId:existing.trigger_id,triggerKey:existing.trigger_key,triggerType:existing.trigger_type,
      enabled:Boolean(existing.enabled),idempotent:true
    };
  }

  const id=randomUUID();
  await db.execute(
    `INSERT INTO trigger_registry
      (trigger_id,trigger_key,trigger_type,display_name,status,scope_type,scope_id,timezone,
       schedule_expr,event_type,condition_expr,dedupe_window_seconds,enabled,metadata_json)
     VALUES (?,?,?,?, 'ACTIVE',?,?,?,?,?,?,?,?,?)`,
    [
      id,input.triggerKey,triggerType,input.displayName,scopeType,input.scopeId,
      input.timezone||null,input.scheduleExpr||null,input.eventType||null,input.conditionExpr||null,
      Math.max(1,Number(input.dedupeWindowSeconds)||3600),input.enabled===false?0:1,
      asJson({...input.metadata,source:'M29.3',evidence:input.evidence})
    ]
  );
  return {triggerId:id,triggerKey:input.triggerKey,triggerType,enabled:input.enabled!==false,idempotent:false};
};

const normalizeIntake=row=>row?({
  id:row.id,projectId:row.project_id,triggerId:row.trigger_id,intakeKey:row.intake_key,
  intakeType:row.intake_type,sourceRef:parseJson(row.source_ref_json),eventId:row.event_id||null,
  scheduledFireTime:row.scheduled_fire_time||null,occurredAt:row.occurred_at,
  payloadSha256:row.payload_sha256,payloadMeta:parseJson(row.payload_meta_json),
  verification:parseJson(row.verification_json),status:row.status,triggerFireId:row.trigger_fire_id||null,
  errorCode:row.error_code||null,errorMessage:row.error_message||null,createdAt:row.created_at,
  completedAt:row.completed_at||null
}):null;

export const ingestM29Automation=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['triggerKey','intakeType','intakeKey','sourceRef','evidence'],
    'INVALID_M29_AUTOMATION_INTAKE');
  const intakeType=upper(input.intakeType);
  if(!INTAKE_TYPES.has(intakeType))throw errorOf(
    'intakeType must be SCHEDULE/EVENT/WEBHOOK','M29_AUTOMATION_INTAKE_TYPE_INVALID',409
  );
  if([input.sourceRef,input.payload,input.capabilityInput,input.verification,input.evidence].some(containsSecret))
    throw errorOf('Automation intake must not contain raw credentials/secrets/signatures',
      'M29_AUTOMATION_SECRET_NOT_ALLOWED',400);

  const db=getRuntimePool(),project=await loadProject(projectId,db),trigger=await loadTrigger(input.triggerKey,db);
  if(!triggerApplies(trigger,project))throw errorOf(
    'Trigger is disabled or outside project scope','M29_AUTOMATION_TRIGGER_NOT_APPLICABLE',409
  );
  if(trigger.trigger_type!==intakeType)throw errorOf(
    'Intake type must match Trigger Registry type','M29_AUTOMATION_TRIGGER_TYPE_MISMATCH',409,
    {expected:trigger.trigger_type,actual:intakeType}
  );

  let scheduledFireTime=null,eventId=null;
  const occurredAt=input.occurredAt?new Date(input.occurredAt):new Date();
  if(Number.isNaN(occurredAt.getTime()))throw errorOf('occurredAt invalid','INVALID_DATE');
  if(intakeType==='SCHEDULE'){
    if(!nonEmpty(input.scheduledFireTime))throw errorOf(
      'Schedule intake requires scheduledFireTime','M29_AUTOMATION_SCHEDULE_TIME_REQUIRED',409
    );
    scheduledFireTime=new Date(input.scheduledFireTime);
    if(Number.isNaN(scheduledFireTime.getTime()))throw errorOf('scheduledFireTime invalid','INVALID_DATE');
    if(!cronMatches(scheduledFireTime,trigger.schedule_expr,trigger.timezone))
      throw errorOf('Scheduled fire time does not match trigger cron contract',
        'M29_AUTOMATION_SCHEDULE_NOT_DUE',409
      );
  }else{
    if(!nonEmpty(input.eventId)||!nonEmpty(input.eventType))throw errorOf(
      'Event/Webhook intake requires eventId and eventType','M29_AUTOMATION_EVENT_REQUIRED',409
    );
    if(trigger.event_type!==input.eventType)throw errorOf(
      'Event type does not match Trigger Registry','M29_AUTOMATION_EVENT_TYPE_MISMATCH',409
    );
    eventId=input.eventId;
  }
  if(intakeType==='WEBHOOK'){
    if(upper(input.verification?.status)!=='VERIFIED'||
       !nonEmpty(input.verification?.provider)||!nonEmpty(input.verification?.verificationRef))
      throw errorOf('Webhook intake requires upstream VERIFIED evidence',
        'M29_WEBHOOK_VERIFICATION_REQUIRED',409
      );
  }

  const payload=input.payload||{},payloadHash=sha256(payload);
  const id=randomUUID();
  try{
    await db.execute(
      `INSERT INTO m29_automation_intakes
        (id,project_id,trigger_id,intake_key,intake_type,source_ref_json,event_id,
         scheduled_fire_time,occurred_at,payload_sha256,payload_meta_json,verification_json,
         status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'RECEIVED',?,?)`,
      [
        id,projectId,trigger.trigger_id,input.intakeKey,intakeType,asJson(input.sourceRef),eventId,
        scheduledFireTime,occurredAt,payloadHash,asJson(payload),
        input.verification?asJson(input.verification):null,asJson(input.evidence),actorId
      ]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY'||error?.errno===1062){
      const [rows]=await db.execute(
        'SELECT * FROM m29_automation_intakes WHERE project_id=? AND trigger_id=? AND intake_key=?',
        [projectId,trigger.trigger_id,input.intakeKey]
      );
      const prior=rows[0];
      if(!prior)throw error;
      if(prior.payload_sha256!==payloadHash)throw errorOf(
        'Duplicate intake key has conflicting payload',
        'M29_AUTOMATION_INTAKE_CONFLICT',409,{intakeKey:input.intakeKey}
      );
      return {...normalizeIntake(prior),idempotent:true};
    }
    throw error;
  }

  try{
    const fire=await fireTrigger({
      triggerKey:input.triggerKey,projectId,
      ...(scheduledFireTime?{scheduledFireTime:scheduledFireTime.toISOString()}:{}),
      ...(eventId?{eventId}:{}),
      ...(input.capabilityInput?{capabilityInput:input.capabilityInput}:{}),
      triggerReason:`M29_AUTOMATION_${intakeType}`
    });
    await db.execute(
      `UPDATE m29_automation_intakes
          SET status='FIRED',trigger_fire_id=?,completed_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,[fire.id,id]
    );
    const [rows]=await db.execute('SELECT * FROM m29_automation_intakes WHERE id=?',[id]);
    return {...normalizeIntake(rows[0]),triggerFireStatus:fire.status,idempotent:false};
  }catch(error){
    await db.execute(
      `UPDATE m29_automation_intakes
          SET status='FAILED',error_code=?,error_message=?,completed_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [error.code||'M29_AUTOMATION_FIRE_FAILED',error.message,id]
    );
    throw error;
  }
};

export const runM29SchedulerTick=async(input={},actorId=null)=>{
  requireFields(input,['asOf','evidence'],'INVALID_M29_SCHEDULER_TICK');
  if(containsSecret(input.evidence))throw errorOf(
    'Scheduler evidence must not contain secrets','M29_AUTOMATION_SECRET_NOT_ALLOWED',400
  );
  const asOf=new Date(input.asOf);
  if(Number.isNaN(asOf.getTime()))throw errorOf('asOf invalid','INVALID_DATE');
  const slot=new Date(Math.floor(asOf.getTime()/60000)*60000);
  const db=getRuntimePool();
  const triggers=await listRows(db,
    `SELECT * FROM trigger_registry
      WHERE trigger_type='SCHEDULE' AND status='ACTIVE' AND enabled=TRUE
      ORDER BY trigger_key`
  );
  const fired=[],skipped=[],failed=[];
  for(const trigger of triggers){
    let due=false;
    try{due=cronMatches(slot,trigger.schedule_expr,trigger.timezone);}catch(error){
      failed.push({triggerKey:trigger.trigger_key,errorCode:error.code||'M29_AUTOMATION_CRON_INVALID'});
      continue;
    }
    if(!due){skipped.push({triggerKey:trigger.trigger_key,reason:'NOT_DUE'});continue;}
    let projects=[];
    if(trigger.scope_type==='PROJECT'){
      projects=await listRows(db,"SELECT * FROM projects WHERE id=? AND status='ACTIVE'",[trigger.scope_id]);
    }else if(trigger.scope_type==='PROJECT_TYPE'){
      projects=await listRows(db,"SELECT * FROM projects WHERE project_type=? AND status='ACTIVE'",[trigger.scope_id]);
    }else{
      skipped.push({triggerKey:trigger.trigger_key,reason:'UNSUPPORTED_SCOPE'});continue;
    }
    const metadata=parseJson(trigger.metadata_json)||{};
    if(metadata.targetProjectName)projects=projects.filter(p=>p.name===metadata.targetProjectName);
    for(const project of projects){
      try{
        const intake=await ingestM29Automation(project.id,{
          triggerKey:trigger.trigger_key,intakeType:'SCHEDULE',
          intakeKey:`SCHEDULE:${trigger.trigger_key}:${project.id}:${slot.toISOString().slice(0,16)}`,
          scheduledFireTime:slot.toISOString(),occurredAt:slot.toISOString(),
          sourceRef:{source:'M29_SCHEDULER_TICK',tickAt:asOf.toISOString()},
          payload:{scheduleExpr:trigger.schedule_expr,timezone:trigger.timezone,slot:slot.toISOString()},
          evidence:input.evidence
        },actorId);
        fired.push({triggerKey:trigger.trigger_key,projectId:project.id,intakeId:intake.id,
          triggerFireId:intake.triggerFireId,idempotent:intake.idempotent});
      }catch(error){
        failed.push({triggerKey:trigger.trigger_key,projectId:project.id,
          errorCode:error.code||'M29_SCHEDULER_FIRE_FAILED',errorMessage:error.message});
      }
    }
  }
  return {asOf,slot,triggerCount:triggers.length,firedCount:fired.length,
    skippedCount:skipped.length,failedCount:failed.length,fired,skipped,failed};
};

const applicableAutomationTriggers=async(project,db)=>{
  const rows=await listRows(db,
    `SELECT * FROM trigger_registry
      WHERE status='ACTIVE' AND enabled=TRUE
        AND trigger_type IN ('SCHEDULE','EVENT','WEBHOOK')
      ORDER BY trigger_key`
  );
  return rows.filter(t=>triggerApplies(t,project));
};

export const evaluateM29AutomationGate=async(projectId,input={})=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db),reasons=[];
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const [triggers,intakes]=await Promise.all([
    applicableAutomationTriggers(project,db),
    listRows(db,'SELECT * FROM m29_automation_intakes WHERE project_id=? ORDER BY occurred_at,id',[projectId])
  ]);
  if(!triggers.length)reasons.push('M29_AUTOMATION_TRIGGER_REQUIRED');
  const configuredTypes=[...new Set(triggers.map(x=>x.trigger_type))];
  const fired=intakes.filter(x=>x.status==='FIRED');
  const missingTypes=configuredTypes.filter(type=>!fired.some(x=>x.intake_type===type));
  if(missingTypes.length)reasons.push('M29_AUTOMATION_INTAKE_COVERAGE_INCOMPLETE');
  const failed=intakes.filter(x=>x.status==='FAILED');
  if(failed.length)reasons.push('M29_AUTOMATION_INTAKE_FAILED');

  const fireIds=[...new Set(fired.map(x=>x.trigger_fire_id).filter(Boolean))];
  let fireRows=[];
  if(fireIds.length){
    [fireRows]=await db.query(
      `SELECT id,project_id FROM trigger_fires WHERE id IN (${fireIds.map(()=>'?').join(',')})`,
      fireIds
    );
  }
  const fireMap=new Map(fireRows.map(x=>[x.id,x]));
  const invalidLineage=fired.filter(x=>!x.trigger_fire_id||fireMap.get(x.trigger_fire_id)?.project_id!==projectId);
  if(invalidLineage.length)reasons.push('M29_AUTOMATION_TRIGGER_FIRE_LINEAGE_INVALID');

  const evidence={
    configuredTriggerCount:triggers.length,
    configuredTriggerTypes:configuredTypes,
    automationIntakeCount:intakes.length,
    firedIntakeCount:fired.length,
    scheduleIntakeCount:fired.filter(x=>x.intake_type==='SCHEDULE').length,
    eventIntakeCount:fired.filter(x=>x.intake_type==='EVENT').length,
    webhookIntakeCount:fired.filter(x=>x.intake_type==='WEBHOOK').length,
    missingConfiguredIntakeTypes:missingTypes,
    failedIntakeIds:failed.map(x=>x.id),
    invalidLineageIntakeIds:invalidLineage.map(x=>x.id),
    reusesTriggerRuntime:true,
    reusesBridgeRetryDeadLetter:true,
    reusesWorkflowRetryRollback:true,
    readyForAutomationRuntime:reasons.length===0
  };
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO m29_automation_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
     VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf]
  );
  return result;
};

export const getM29AutomationState=async projectId=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  const [triggers,intakes,gates]=await Promise.all([
    applicableAutomationTriggers(project,db),
    listRows(db,'SELECT * FROM m29_automation_intakes WHERE project_id=? ORDER BY occurred_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_automation_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['自动化入口','调度扫描','Webhook 入口'],
      gateName:'自动化入口 / 调度 / Webhook 门禁',
      reliabilityPolicy:'复用 Trigger Runtime、Bridge Retry / Dead-letter 与 Workflow Retry / Rollback，不复制可靠性状态机'
    },
    triggers:triggers.map(x=>({
      triggerId:x.trigger_id,triggerKey:x.trigger_key,triggerType:x.trigger_type,
      displayName:x.display_name,scopeType:x.scope_type,scopeId:x.scope_id,
      timezone:x.timezone,scheduleExpr:x.schedule_expr,eventType:x.event_type,
      enabled:Boolean(x.enabled),metadata:parseJson(x.metadata_json)
    })),
    intakes:intakes.map(normalizeIntake),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
