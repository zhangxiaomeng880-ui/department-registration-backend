import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const UPDATE_STATUSES=new Set(['ON_TRACK','AT_RISK','OFF_TRACK']);
const MILESTONE_HEALTH=new Set(['ON_TRACK','AT_RISK','OFF_TRACK']);
const VERSION_TYPES=new Set(['PRODUCT_CONTENT','RELEASE_DISTRIBUTION']);
const VERSION_STATUSES=new Set(['DRAFT','CANDIDATE','LOCKED','RELEASED','RETIRED']);
const TARGET_TYPES=new Set(['PROJECT','MILESTONE','STRATEGIC_ITEM']);
const TERMINAL_WORK_ITEM_STATUSES=new Set(['COMPLETED','CANCELLED']);
const COMPLETED_WORK_ITEM_STATUSES=new Set(['COMPLETED']);
const TERMINAL_DEPENDENCY_STATUSES=new Set(['RESOLVED','COMPLETED','CANCELLED','INACTIVE']);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const upper=value=>value==null?null:String(value).toUpperCase();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const dateOnly=value=>{
  if(!value) return null;
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
};
const utcStart=value=>{
  const d=value?new Date(value):new Date();
  if(Number.isNaN(d.getTime())) throw errorOf('Invalid date','INVALID_DATE',400,{value});
  return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
};
const addDays=(date,days)=>new Date(date.getTime()+Number(days)*86400000);
const compareDates=(a,b)=>a&&b?utcStart(a).getTime()-utcStart(b).getTime():null;
const normalizeKeys=value=>{
  if(!Array.isArray(value)) return [];
  return value.map(item=>{
    if(typeof item==='string') return item;
    if(item&&typeof item==='object') return item.key||item.gateKey||item.name||item.id||null;
    return null;
  }).filter(Boolean);
};
const validatePercent=(value,label='percent')=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100) throw errorOf(
    `${label} must be between 0 and 100`,'INVALID_PERCENT',400,{value}
  );
  return round2(n);
};
const healthRank=value=>({ON_TRACK:0,AT_RISK:1,OFF_TRACK:2}[value]??0);
const worstHealth=values=>values.reduce((worst,value)=>
  healthRank(value)>healthRank(worst)?value:worst,'ON_TRACK'
);
const projectHealthFromMilestone=value=>({ON_TRACK:'GREEN',AT_RISK:'AMBER',OFF_TRACK:'RED'}[value]||'GREEN');

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadMilestone=async(milestoneId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    `SELECT m.*,p.workspace_id,p.status AS project_status,p.health AS project_health,
            p.update_cadence_days AS project_update_cadence_days,
            p.last_update_at AS project_last_update_at,p.stale_after_at AS project_stale_after_at
       FROM project_milestones m
       JOIN projects p ON p.id=m.project_id WHERE m.id=?`,
    [milestoneId]
  );
  if(!rows.length) throw errorOf('Milestone not found','MILESTONE_NOT_FOUND',404);
  return rows[0];
};
const loadStrategicItem=async(id,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM strategic_items WHERE id=?',[id]);
  if(!rows.length) throw errorOf('Strategic item not found','STRATEGIC_ITEM_NOT_FOUND',404);
  return rows[0];
};

const targetScope=async(targetType,targetId,db=getRuntimePool())=>{
  const type=upper(targetType);
  if(!TARGET_TYPES.has(type)) throw errorOf(
    'targetType must be PROJECT, MILESTONE or STRATEGIC_ITEM','INVALID_GOVERNANCE_UPDATE_TARGET'
  );
  if(type==='PROJECT'){
    const row=await loadProject(targetId,db);
    return {type,row,workspaceId:row.workspace_id,projectId:row.id};
  }
  if(type==='MILESTONE'){
    const row=await loadMilestone(targetId,db);
    return {type,row,workspaceId:row.workspace_id,projectId:row.project_id};
  }
  const row=await loadStrategicItem(targetId,db);
  return {type,row,workspaceId:row.workspace_id,projectId:null};
};

export const resolveGovernanceTargetScope=async(targetType,targetId)=>{
  const scope=await targetScope(targetType,targetId);
  return {targetType:scope.type,targetId,workspaceId:scope.workspaceId,projectId:scope.projectId};
};

export const createGovernanceUpdate=async input=>{
  if(!input?.targetType||!input?.targetId||!input?.updateStatus) throw errorOf(
    'targetType, targetId and updateStatus are required','INVALID_GOVERNANCE_UPDATE'
  );
  const status=upper(input.updateStatus);
  if(!UPDATE_STATUSES.has(status)) throw errorOf(
    'updateStatus must be ON_TRACK, AT_RISK or OFF_TRACK','INVALID_GOVERNANCE_UPDATE_STATUS'
  );
  const progress=input.progressPercent==null?null:validatePercent(input.progressPercent,'progressPercent');
  const observedAt=input.observedAt?new Date(input.observedAt):new Date();
  if(Number.isNaN(observedAt.getTime())) throw errorOf('Invalid observedAt','INVALID_DATE');
  const db=getRuntimePool();
  const scope=await targetScope(input.targetType,input.targetId,db);
  const cadenceInput=input.cadenceDays==null?null:Number(input.cadenceDays);
  if(cadenceInput!=null&&(!Number.isInteger(cadenceInput)||cadenceInput<1||cadenceInput>365)) throw errorOf(
    'cadenceDays must be an integer between 1 and 365','INVALID_UPDATE_CADENCE'
  );
  const cadence=cadenceInput??(
    scope.type==='PROJECT'?scope.row.update_cadence_days:
    scope.type==='MILESTONE'?scope.row.update_cadence_days:
    scope.row.update_cadence_days
  );
  const staleAfter=cadence?addDays(observedAt,cadence):null;
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO governance_updates
      (id,workspace_id,project_id,target_type,target_id,update_status,progress_percent,
       target_end,forecast_end,blocker_text,decision_needed,next_action,evidence_json,
       observed_at,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,scope.workspaceId,scope.projectId,scope.type,input.targetId,status,progress,
      input.targetEnd||null,input.forecastEnd||null,input.blocker||null,
      input.decisionNeeded||null,input.nextAction||null,asJson(input.evidence||null),
      observedAt,input.createdByIdentityId||null
    ]
  );
  if(scope.type==='PROJECT'){
    await db.execute(
      `UPDATE projects SET update_cadence_days=COALESCE(?,update_cadence_days),
        last_update_at=?,stale_after_at=?,health=? WHERE id=?`,
      [cadenceInput,observedAt,staleAfter,projectHealthFromMilestone(status),input.targetId]
    );
  }else if(scope.type==='MILESTONE'){
    await db.execute(
      `UPDATE project_milestones SET update_cadence_days=COALESCE(?,update_cadence_days),
        last_update_at=?,stale_after_at=?,health=?,
        forecast_end=COALESCE(?,forecast_end) WHERE id=?`,
      [cadenceInput,observedAt,staleAfter,status,input.forecastEnd||null,input.targetId]
    );
  }else{
    await db.execute(
      `UPDATE strategic_items SET update_cadence_days=COALESCE(?,update_cadence_days),
        last_update_at=?,stale_after_at=?,health=? WHERE id=?`,
      [cadenceInput,observedAt,staleAfter,projectHealthFromMilestone(status),input.targetId]
    );
  }
  return {
    id,targetType:scope.type,targetId:input.targetId,projectId:scope.projectId,
    workspaceId:scope.workspaceId,updateStatus:status,progressPercent:progress,
    observedAt,staleAfterAt:staleAfter
  };
};

export const listGovernanceUpdates=async({projectId=null,targetType=null,targetId=null,limit=100}={})=>{
  if(!projectId&&!targetId) throw errorOf(
    'projectId or targetId is required','INVALID_GOVERNANCE_UPDATE_QUERY'
  );
  const db=getRuntimePool(),where=[],params=[];
  if(projectId){where.push('project_id=?');params.push(projectId);}
  if(targetType){where.push('target_type=?');params.push(upper(targetType));}
  if(targetId){where.push('target_id=?');params.push(targetId);}
  const safeLimit=Math.max(1,Math.min(500,Number(limit)||100));
  const [rows]=await db.execute(
    `SELECT * FROM governance_updates WHERE ${where.join(' AND ')}
      ORDER BY observed_at DESC,id DESC LIMIT ${safeLimit}`,params
  );
  return rows.map(row=>({
    id:row.id,workspaceId:row.workspace_id,projectId:row.project_id||null,
    targetType:row.target_type,targetId:row.target_id,updateStatus:row.update_status,
    progressPercent:row.progress_percent==null?null:Number(row.progress_percent),
    targetEnd:row.target_end||null,forecastEnd:row.forecast_end||null,
    blocker:row.blocker_text||null,decisionNeeded:row.decision_needed||null,
    nextAction:row.next_action||null,evidence:parseJson(row.evidence_json),
    observedAt:row.observed_at,createdByIdentityId:row.created_by_identity_id||null
  }));
};

export const createCapacitySnapshot=async input=>{
  if(!input?.projectId||!input?.targetType||!input?.targetId) throw errorOf(
    'projectId, targetType and targetId are required','INVALID_CAPACITY_SNAPSHOT'
  );
  const type=upper(input.targetType);
  if(!['PROJECT','MILESTONE'].includes(type)) throw errorOf(
    'Capacity targetType must be PROJECT or MILESTONE','INVALID_CAPACITY_TARGET'
  );
  const project=await loadProject(input.projectId);
  if(type==='MILESTONE'){
    const milestone=await loadMilestone(input.targetId);
    if(milestone.project_id!==input.projectId) throw errorOf(
      'Milestone does not belong to project','CAPACITY_SCOPE_MISMATCH',409
    );
  }else if(input.targetId!==input.projectId){
    throw errorOf('Project capacity targetId must equal projectId','CAPACITY_SCOPE_MISMATCH',409);
  }
  const hours=input.availableHoursPerCalendarDay==null?null:Number(input.availableHoursPerCalendarDay);
  const throughput=input.throughputItemsPerCalendarDay==null?null:Number(input.throughputItemsPerCalendarDay);
  if((hours==null||hours<=0)&&(throughput==null||throughput<=0)) throw errorOf(
    'A positive availableHoursPerCalendarDay or throughputItemsPerCalendarDay is required',
    'CAPACITY_SIGNAL_REQUIRED'
  );
  const observedAt=input.observedAt?new Date(input.observedAt):new Date();
  const expiresAt=input.expiresAt?new Date(input.expiresAt):null;
  if(Number.isNaN(observedAt.getTime())||(expiresAt&&Number.isNaN(expiresAt.getTime()))) throw errorOf(
    'Invalid capacity snapshot date','INVALID_DATE'
  );
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO governance_capacity_snapshots
      (id,project_id,target_type,target_id,available_hours_per_calendar_day,
       throughput_items_per_calendar_day,capacity_units_json,source_json,observed_at,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,project.id,type,input.targetId,hours,throughput,
      asJson(input.capacityUnits||null),asJson(input.source||null),observedAt,expiresAt
    ]
  );
  return {
    id,projectId:input.projectId,targetType:type,targetId:input.targetId,
    availableHoursPerCalendarDay:hours,throughputItemsPerCalendarDay:throughput,
    observedAt,expiresAt
  };
};

const latestCapacity=async(milestone,asOf,db)=>{
  const [rows]=await db.execute(
    `SELECT * FROM governance_capacity_snapshots
      WHERE project_id=? AND (
        (target_type='MILESTONE' AND target_id=?)
        OR (target_type='PROJECT' AND target_id=?)
      )
      AND observed_at<=?
      AND (expires_at IS NULL OR expires_at>?)
      ORDER BY CASE target_type WHEN 'MILESTONE' THEN 0 ELSE 1 END,observed_at DESC,id DESC
      LIMIT 1`,
    [milestone.project_id,milestone.id,milestone.project_id,asOf,asOf]
  );
  return rows[0]||null;
};

const latestGateStatuses=async(projectId,gateKeys,db)=>{
  if(!gateKeys.length) return {};
  const placeholders=gateKeys.map(()=>'?').join(',');
  const [rows]=await db.execute(
    `SELECT gate_key,status,blocking_reason,decided_at FROM (
       SELECT g.gate_key,g.status,g.blocking_reason,g.decided_at,
              ROW_NUMBER() OVER(PARTITION BY g.gate_key ORDER BY g.decided_at DESC,g.id DESC) AS rn
         FROM gate_results g
         JOIN runs r ON r.id=g.run_id
        WHERE r.project_id=? AND g.gate_key IN (${placeholders})
      ) x WHERE rn=1`,
    [projectId,...gateKeys]
  );
  return Object.fromEntries(rows.map(row=>[row.gate_key,{
    status:row.status,blockingReason:row.blocking_reason||null,decidedAt:row.decided_at
  }]));
};

const workItemStats=rows=>{
  const active=rows.filter(row=>upper(row.status)!=='CANCELLED');
  const completed=active.filter(row=>COMPLETED_WORK_ITEM_STATUSES.has(upper(row.status)));
  const hasAnyEstimate=active.some(row=>row.estimate_hours!=null&&Number(row.estimate_hours)>0);
  const weight=row=>hasAnyEstimate
    ? Math.max(0,Number(row.estimate_hours||0))
    : 1;
  const totalWeight=active.reduce((sum,row)=>sum+weight(row),0);
  const completedWeight=completed.reduce((sum,row)=>sum+weight(row),0);
  const calculated=totalWeight<=0?0:round2(completedWeight/totalWeight*100);
  const remaining=active.filter(row=>!COMPLETED_WORK_ITEM_STATUSES.has(upper(row.status)));
  return {
    totalCount:active.length,completedCount:completed.length,remainingCount:remaining.length,
    hasAnyEstimate,totalWeight,completedWeight,calculatedProgressPercent:calculated,
    remainingEstimateHours:round2(remaining.reduce((sum,row)=>sum+Math.max(0,Number(row.estimate_hours||0)),0)),
    missingEstimateCount:remaining.filter(row=>row.estimate_hours==null||Number(row.estimate_hours)<=0).length,
    blockedCount:remaining.filter(row=>upper(row.status)==='BLOCKED').length
  };
};

const forecastFromCapacity=(milestone,stats,capacity,asOf)=>{
  if(stats.remainingCount===0) return {
    forecastEnd:dateOnly(asOf),forecastMethod:'NO_REMAINING_WORK',forecastConfidence:'HIGH',
    capacitySignal:{status:'AVAILABLE',reason:'NO_REMAINING_WORK'}
  };
  if(!capacity) return {
    forecastEnd:null,forecastMethod:null,forecastConfidence:null,
    capacitySignal:{status:'UNKNOWN',reason:'INSUFFICIENT_CAPACITY_SIGNAL'}
  };
  const hours=capacity.available_hours_per_calendar_day==null?null:Number(capacity.available_hours_per_calendar_day);
  const throughput=capacity.throughput_items_per_calendar_day==null?null:Number(capacity.throughput_items_per_calendar_day);
  let days=null,method=null,confidence='MEDIUM';
  if(hours>0&&stats.remainingEstimateHours>0){
    days=Math.max(1,Math.ceil(stats.remainingEstimateHours/hours));
    method='CAPACITY_HOURS_PER_CALENDAR_DAY';
    if(stats.missingEstimateCount>0) confidence='LOW';
  }else if(throughput>0){
    days=Math.max(1,Math.ceil(stats.remainingCount/throughput));
    method='THROUGHPUT_ITEMS_PER_CALENDAR_DAY';
    confidence='MEDIUM';
  }
  if(days==null) return {
    forecastEnd:null,forecastMethod:null,forecastConfidence:null,
    capacitySignal:{status:'UNKNOWN',reason:'CAPACITY_SIGNAL_NOT_APPLICABLE'}
  };
  const forecast=addDays(utcStart(asOf),days);
  let utilization=null,status='UNKNOWN';
  if(milestone.planned_end&&hours>0&&stats.remainingEstimateHours>0){
    const daysToTarget=Math.max(1,Math.ceil(
      (utcStart(milestone.planned_end).getTime()-utcStart(asOf).getTime())/86400000
    )+1);
    const available=daysToTarget*hours;
    utilization=available>0?round2(stats.remainingEstimateHours/available*100):null;
    status=utilization==null?'UNKNOWN':utilization>100?'OVER_CAPACITY':utilization>85?'TIGHT':'AVAILABLE';
  }
  return {
    forecastEnd:dateOnly(forecast),forecastMethod:method,forecastConfidence:confidence,
    capacitySignal:{
      status,utilizationPercent:utilization,
      availableHoursPerCalendarDay:hours,
      throughputItemsPerCalendarDay:throughput,
      observedAt:capacity.observed_at,expiresAt:capacity.expires_at||null
    }
  };
};

const deliverableEvidenceState=(required,completionEvidence)=>{
  const expected=normalizeKeys(required);
  if(!expected.length) return {required:[],satisfied:[],missing:[],pass:true};
  const actual=normalizeKeys(completionEvidence?.deliverables||[]);
  const actualSet=new Set(actual);
  const missing=expected.filter(key=>!actualSet.has(key));
  return {required:expected,satisfied:expected.filter(key=>actualSet.has(key)),missing,pass:missing.length===0};
};

const blockerState=async(milestone,workItems,db)=>{
  const itemIds=new Set(workItems.map(row=>row.id));
  const [rows]=await db.execute(
    `SELECT * FROM project_blockers WHERE project_id=? AND status='OPEN' ORDER BY created_at,id`,
    [milestone.project_id]
  );
  const relevant=rows.filter(row=>
    (upper(row.blocking_object_type)==='MILESTONE'&&row.blocking_object_id===milestone.id)||
    (upper(row.blocking_object_type)==='WORK_ITEM'&&itemIds.has(row.blocking_object_id))
  );
  return relevant.map(row=>({
    id:row.id,blockerKey:row.blocker_key,reason:row.reason,waitingOn:row.waiting_on||null,
    resumeCondition:row.resume_condition||null,ownerIdentityId:row.owner_identity_id||null
  }));
};

const dependencyState=async(milestone,workItems,blockers,db)=>{
  const itemIds=new Set(workItems.map(row=>row.id));
  const [rows]=await db.execute(
    `SELECT * FROM project_dependencies WHERE project_id=? AND critical_path=TRUE ORDER BY created_at,id`,
    [milestone.project_id]
  );
  const related=rows.filter(row=>
    row.source_id===milestone.id||row.target_id===milestone.id||
    itemIds.has(row.source_id)||itemIds.has(row.target_id)
  );
  const active=related.filter(row=>!TERMINAL_DEPENDENCY_STATUSES.has(upper(row.status)));
  const blockedIds=new Set(blockers.flatMap(x=>[x.id]));
  const violation=active.some(row=>{
    const ext=parseJson(row.external_reference_json)||{};
    return ext.violation===true||ext.delay===true||ext.blocked===true;
  })||blockers.length>0;
  return {
    criticalPathCount:related.length,activeCriticalPathCount:active.length,
    violation,active:active.map(row=>({
      id:row.id,sourceType:row.source_type,sourceId:row.source_id,
      targetType:row.target_type,targetId:row.target_id,
      dependencyType:row.dependency_type,status:row.status
    }))
  };
};

const riskState=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT id,risk_key,title,probability,impact,status FROM project_risks
      WHERE project_id=? AND status='OPEN'`,[projectId]
  );
  const high=rows.filter(row=>['HIGH','CRITICAL'].includes(upper(row.impact)));
  return {
    openCount:rows.length,highImpactCount:high.length,
    highImpact:high.map(row=>({
      id:row.id,riskKey:row.risk_key,title:row.title,
      probability:row.probability,impact:row.impact
    }))
  };
};

const stalenessState=(row,asOf)=>{
  const cadence=row.update_cadence_days==null?null:Number(row.update_cadence_days);
  const last=row.last_update_at||null;
  const staleAfter=row.stale_after_at||null;
  if(!cadence) return {configured:false,stale:false,missingUpdate:false,cadenceDays:null,lastUpdateAt:last,staleAfterAt:staleAfter};
  if(!last) return {configured:true,stale:true,missingUpdate:true,cadenceDays:cadence,lastUpdateAt:null,staleAfterAt:null};
  const stale=staleAfter?new Date(staleAfter).getTime()<asOf.getTime():new Date(last).getTime()+cadence*86400000<asOf.getTime();
  return {configured:true,stale,missingUpdate:false,cadenceDays:cadence,lastUpdateAt:last,staleAfterAt:staleAfter};
};

export const getMilestoneIntelligence=async(milestoneId,{asOf=new Date(),persist=false}={})=>{
  const db=getRuntimePool();
  const milestone=await loadMilestone(milestoneId,db);
  const at=asOf instanceof Date?asOf:new Date(asOf);
  if(Number.isNaN(at.getTime())) throw errorOf('Invalid asOf','INVALID_DATE');
  const [workItems]=await db.execute(
    'SELECT * FROM project_work_items WHERE milestone_id=? ORDER BY created_at,id',[milestoneId]
  );
  const stats=workItemStats(workItems);
  const requiredGateKeys=normalizeKeys(parseJson(milestone.required_gates_json));
  const gateStatuses=await latestGateStatuses(milestone.project_id,requiredGateKeys,db);
  const missingGates=requiredGateKeys.filter(key=>gateStatuses[key]?.status!=='PASS');
  const blockers=await blockerState(milestone,workItems,db);
  const dependencies=await dependencyState(milestone,workItems,blockers,db);
  const risks=await riskState(milestone.project_id,db);
  const capacity=await latestCapacity(milestone,at,db);
  const forecast=forecastFromCapacity(milestone,stats,capacity,at);
  const staleness=stalenessState(milestone,at);
  const completionEvidence=parseJson(milestone.completion_evidence_json);
  const deliverables=deliverableEvidenceState(
    parseJson(milestone.required_deliverables_json),completionEvidence
  );
  const override=milestone.progress_override_percent==null?null:Number(milestone.progress_override_percent);
  const effectiveProgress=override==null?stats.calculatedProgressPercent:round2(override);
  const overdue=Boolean(
    milestone.planned_end&&upper(milestone.management_status)!=='COMPLETED'&&
    utcStart(milestone.planned_end).getTime()<utcStart(at).getTime()
  );
  const forecastLate=Boolean(
    forecast.forecastEnd&&milestone.planned_end&&compareDates(forecast.forecastEnd,milestone.planned_end)>0
  );
  const latestUpdates=await listGovernanceUpdates({targetType:'MILESTONE',targetId:milestoneId,limit:1});
  const latestUpdate=latestUpdates[0]||null;
  const gateFailure=requiredGateKeys.some(key=>gateStatuses[key]?.status==='FAIL');
  const gateHold=requiredGateKeys.some(key=>gateStatuses[key]?.status==='HOLD');
  const healthReasons=[];
  let health='ON_TRACK';
  if(upper(milestone.management_status)==='BLOCKED'||blockers.length||overdue||dependencies.violation||gateFailure){
    health='OFF_TRACK';
    if(upper(milestone.management_status)==='BLOCKED') healthReasons.push('MILESTONE_BLOCKED');
    if(blockers.length) healthReasons.push('ACTIVE_BLOCKER');
    if(overdue) healthReasons.push('TARGET_DATE_OVERDUE');
    if(dependencies.violation) healthReasons.push('CRITICAL_PATH_VIOLATION');
    if(gateFailure) healthReasons.push('REQUIRED_GATE_FAIL');
  }else if(
    staleness.stale||forecastLate||forecast.capacitySignal.status==='OVER_CAPACITY'||
    risks.highImpactCount>0||gateHold||latestUpdate?.updateStatus==='AT_RISK'
  ){
    health='AT_RISK';
    if(staleness.stale) healthReasons.push('STALE_UPDATE');
    if(forecastLate) healthReasons.push('FORECAST_LATE');
    if(forecast.capacitySignal.status==='OVER_CAPACITY') healthReasons.push('OVER_CAPACITY');
    if(risks.highImpactCount>0) healthReasons.push('HIGH_IMPACT_RISK');
    if(gateHold) healthReasons.push('REQUIRED_GATE_HOLD');
    if(latestUpdate?.updateStatus==='AT_RISK') healthReasons.push('LATEST_UPDATE_AT_RISK');
  }
  if(latestUpdate?.updateStatus==='OFF_TRACK'&&health!=='OFF_TRACK'){
    health='OFF_TRACK';healthReasons.push('LATEST_UPDATE_OFF_TRACK');
  }
  const completionReady=
    effectiveProgress===100&&missingGates.length===0&&deliverables.pass&&blockers.length===0;

  const result={
    milestoneId:milestone.id,projectId:milestone.project_id,milestoneKey:milestone.milestone_key,
    displayName:milestone.display_name,managementStatus:milestone.management_status,
    workflowStatus:milestone.status,health,healthReasons,
    progress:{
      calculatedPercent:stats.calculatedProgressPercent,
      overridePercent:override,effectivePercent:effectiveProgress,
      overrideReason:milestone.progress_override_reason||null,
      totalWorkItems:stats.totalCount,completedWorkItems:stats.completedCount,
      blockedWorkItems:stats.blockedCount,remainingWorkItems:stats.remainingCount,
      remainingEstimateHours:stats.remainingEstimateHours,
      missingEstimateCount:stats.missingEstimateCount
    },
    forecast:{
      targetEnd:milestone.planned_end||null,
      forecastEnd:forecast.forecastEnd,method:forecast.forecastMethod,
      confidence:forecast.forecastConfidence,late:forecastLate
    },
    capacity:forecast.capacitySignal,
    dependencies,
    risks,
    blockers,
    staleness,
    gates:{
      required:requiredGateKeys,statuses:gateStatuses,missingOrNotPass:missingGates,
      pass:missingGates.length===0
    },
    deliverables,
    completion:{
      ready:completionReady,evidence:completionEvidence,
      blockers:[
        ...(effectiveProgress===100?[]:['PROGRESS_NOT_100']),
        ...(missingGates.length?['REQUIRED_GATES_NOT_PASS']:[]),
        ...(deliverables.pass?[]:['REQUIRED_DELIVERABLES_MISSING']),
        ...(blockers.length?['ACTIVE_BLOCKERS']:[])
      ]
    },
    latestUpdate,
    asOf:at
  };
  if(persist){
    await db.execute(
      `UPDATE project_milestones SET calculated_progress_percent=?,progress_percent=?,
        health=?,forecast_end=?,forecast_method=?,forecast_confidence=?,
        capacity_signal_json=?,dependency_signal_json=? WHERE id=?`,
      [
        stats.calculatedProgressPercent,effectiveProgress,health,forecast.forecastEnd,
        forecast.forecastMethod,forecast.forecastConfidence,asJson(forecast.capacitySignal),
        asJson(dependencies),milestoneId
      ]
    );
  }
  return result;
};

export const refreshMilestoneIntelligence=(milestoneId,input={})=>
  getMilestoneIntelligence(milestoneId,{asOf:input.asOf||new Date(),persist:true});

export const overrideMilestoneProgress=async(milestoneId,input={})=>{
  const db=getRuntimePool();
  await loadMilestone(milestoneId,db);
  if(input.progressPercent==null){
    await db.execute(
      `UPDATE project_milestones SET progress_override_percent=NULL,
        progress_override_reason=NULL,progress_override_at=NULL WHERE id=?`,[milestoneId]
    );
  }else{
    const progress=validatePercent(input.progressPercent,'progressPercent');
    if(!input.reason) throw errorOf(
      'Manual progress override requires a reason','MILESTONE_PROGRESS_OVERRIDE_REASON_REQUIRED',409
    );
    await db.execute(
      `UPDATE project_milestones SET progress_override_percent=?,
        progress_override_reason=?,progress_override_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [progress,input.reason,milestoneId]
    );
  }
  return refreshMilestoneIntelligence(milestoneId,{});
};

export const completeMilestone=async(milestoneId,input={})=>{
  if(!input.completionEvidence||typeof input.completionEvidence!=='object') throw errorOf(
    'completionEvidence is required','MILESTONE_COMPLETION_EVIDENCE_REQUIRED',409
  );
  const db=getRuntimePool();
  const milestone=await loadMilestone(milestoneId,db);
  await db.execute(
    'UPDATE project_milestones SET completion_evidence_json=? WHERE id=?',
    [asJson(input.completionEvidence),milestoneId]
  );
  const intelligence=await refreshMilestoneIntelligence(milestoneId,{asOf:input.asOf||new Date()});
  if(!intelligence.completion.ready){
    throw errorOf(
      'Milestone completion gate is not satisfied','MILESTONE_COMPLETION_GATE_BLOCKED',409,
      {blockers:intelligence.completion.blockers}
    );
  }
  await db.execute(
    `UPDATE project_milestones SET management_status='COMPLETED',actual_end=CURRENT_TIMESTAMP(6),
      completed_by_identity_id=?,health='ON_TRACK',progress_percent=100,
      calculated_progress_percent=100 WHERE id=?`,
    [input.completedByIdentityId||null,milestoneId]
  );
  if(milestone.project_id){
    const [rows]=await db.execute(
      `SELECT id FROM project_milestones
        WHERE project_id=? AND management_status NOT IN ('COMPLETED','CANCELLED')
        ORDER BY sequence_no,id LIMIT 1`,[milestone.project_id]
    );
    await db.execute(
      'UPDATE projects SET current_milestone_id=? WHERE id=?',
      [rows[0]?.id||null,milestone.project_id]
    );
  }
  return getMilestoneIntelligence(milestoneId,{asOf:input.asOf||new Date(),persist:false});
};

export const createProjectVersion=async(projectId,input={})=>{
  if(!input.versionKey||!input.versionType||!input.label) throw errorOf(
    'versionKey, versionType and label are required','INVALID_PROJECT_VERSION'
  );
  const type=upper(input.versionType),status=upper(input.status||'DRAFT');
  if(!VERSION_TYPES.has(type)) throw errorOf('Invalid project version type','INVALID_PROJECT_VERSION_TYPE');
  if(!VERSION_STATUSES.has(status)) throw errorOf('Invalid project version status','INVALID_PROJECT_VERSION_STATUS');
  await loadProject(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_versions
      (id,project_id,version_key,version_type,label,status,source_pointer_json,evidence_json,effective_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.versionKey,type,input.label,status,asJson(input.sourcePointer||null),
      asJson(input.evidence||null),input.effectiveAt?new Date(input.effectiveAt):null
    ]
  );
  return {id,projectId,versionKey:input.versionKey,versionType:type,label:input.label,status};
};

export const updateProjectVersion=async(versionId,input={})=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_versions WHERE id=?',[versionId]);
  if(!rows.length) throw errorOf('Project version not found','PROJECT_VERSION_NOT_FOUND',404);
  const current=rows[0];
  const next=upper(input.status||current.status);
  if(!VERSION_STATUSES.has(next)) throw errorOf('Invalid project version status','INVALID_PROJECT_VERSION_STATUS');
  const allowed={
    DRAFT:new Set(['DRAFT','CANDIDATE','RETIRED']),
    CANDIDATE:new Set(['CANDIDATE','LOCKED','RETIRED']),
    LOCKED:new Set(['LOCKED','RELEASED','RETIRED']),
    RELEASED:new Set(['RELEASED','RETIRED']),
    RETIRED:new Set(['RETIRED'])
  };
  if(!allowed[current.status]?.has(next)) throw errorOf(
    'Project version lifecycle transition is not allowed','PROJECT_VERSION_TRANSITION_NOT_ALLOWED',409,
    {from:current.status,to:next}
  );
  await db.execute(
    `UPDATE project_versions SET status=?,
      evidence_json=COALESCE(?,evidence_json),
      effective_at=CASE WHEN ? IN ('LOCKED','RELEASED') THEN COALESCE(effective_at,CURRENT_TIMESTAMP(6)) ELSE effective_at END,
      retired_at=CASE WHEN ?='RETIRED' THEN CURRENT_TIMESTAMP(6) ELSE retired_at END
      WHERE id=?`,
    [next,input.evidence===undefined?null:asJson(input.evidence),next,next,versionId]
  );
  const [updated]=await db.execute('SELECT * FROM project_versions WHERE id=?',[versionId]);
  const row=updated[0];
  return {
    id:row.id,projectId:row.project_id,versionKey:row.version_key,versionType:row.version_type,
    label:row.label,status:row.status,effectiveAt:row.effective_at||null,retiredAt:row.retired_at||null
  };
};

export const listProjectVersions=async projectId=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM project_versions WHERE project_id=? ORDER BY created_at,id',[projectId]
  );
  return rows.map(row=>({
    id:row.id,projectId:row.project_id,versionKey:row.version_key,versionType:row.version_type,
    label:row.label,status:row.status,sourcePointer:parseJson(row.source_pointer_json),
    evidence:parseJson(row.evidence_json),effectiveAt:row.effective_at||null,retiredAt:row.retired_at||null
  }));
};

export const linkMilestoneVersion=async(milestoneId,input={})=>{
  if(!input.projectVersionId) throw errorOf('projectVersionId is required','INVALID_MILESTONE_VERSION_LINK');
  const milestone=await loadMilestone(milestoneId);
  const db=getRuntimePool();
  const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[input.projectVersionId]);
  if(!versions.length) throw errorOf('Project version not found','PROJECT_VERSION_NOT_FOUND',404);
  if(versions[0].project_id!==milestone.project_id) throw errorOf(
    'Milestone and version must belong to same project','MILESTONE_VERSION_SCOPE_MISMATCH',409
  );
  const role=upper(input.linkRole||'TARGET');
  if(!['TARGET','OUTPUT','VERIFIED_BY'].includes(role)) throw errorOf(
    'Invalid milestone version linkRole','INVALID_MILESTONE_VERSION_LINK_ROLE'
  );
  await db.execute(
    `INSERT INTO milestone_version_links(milestone_id,project_version_id,link_role)
     VALUES (?,?,?) ON DUPLICATE KEY UPDATE link_role=VALUES(link_role)`,
    [milestoneId,input.projectVersionId,role]
  );
  return {milestoneId,projectVersionId:input.projectVersionId,linkRole:role};
};

const milestoneVersionLinks=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT l.milestone_id,l.link_role,v.id AS version_id,v.version_key,v.version_type,v.label,v.status
       FROM milestone_version_links l
       JOIN project_versions v ON v.id=l.project_version_id
       JOIN project_milestones m ON m.id=l.milestone_id
      WHERE m.project_id=? ORDER BY m.sequence_no,v.created_at`,[projectId]
  );
  return rows.map(row=>({
    milestoneId:row.milestone_id,linkRole:row.link_role,projectVersionId:row.version_id,
    versionKey:row.version_key,versionType:row.version_type,label:row.label,status:row.status
  }));
};

export const getProjectIntelligence=async(projectId,{asOf=new Date(),persist=false}={})=>{
  const db=getRuntimePool();
  const project=await loadProject(projectId,db);
  const at=asOf instanceof Date?asOf:new Date(asOf);
  if(Number.isNaN(at.getTime())) throw errorOf('Invalid asOf','INVALID_DATE');
  const [milestones]=await db.execute(
    'SELECT id,sequence_no,management_status FROM project_milestones WHERE project_id=? ORDER BY sequence_no,id',
    [projectId]
  );
  const intelligence=[];
  for(const row of milestones){
    intelligence.push(await getMilestoneIntelligence(row.id,{asOf:at,persist}));
  }
  const incomplete=intelligence.filter(x=>x.managementStatus!=='COMPLETED'&&x.managementStatus!=='CANCELLED');
  const current=incomplete.find(x=>x.managementStatus==='ACTIVE')||incomplete[0]||null;
  const projectStaleness=stalenessState(project,at);
  const [projectBlockers]=await db.execute(
    "SELECT * FROM project_blockers WHERE project_id=? AND status='OPEN' ORDER BY created_at,id",[projectId]
  );
  const latestUpdates=await listGovernanceUpdates({projectId,targetType:'PROJECT',targetId:projectId,limit:1});
  const latestUpdate=latestUpdates[0]||null;
  let derivedMilestoneHealth=worstHealth(incomplete.map(x=>x.health));
  if(projectBlockers.length) derivedMilestoneHealth='OFF_TRACK';
  else if(projectStaleness.stale&&derivedMilestoneHealth==='ON_TRACK') derivedMilestoneHealth='AT_RISK';
  if(latestUpdate?.updateStatus) derivedMilestoneHealth=worstHealth([derivedMilestoneHealth,latestUpdate.updateStatus]);
  const health=projectHealthFromMilestone(derivedMilestoneHealth);
  const forecastEnds=incomplete.map(x=>x.forecast.forecastEnd).filter(Boolean).sort();
  const forecastEnd=forecastEnds.length?forecastEnds[forecastEnds.length-1]:null;
  const links=await milestoneVersionLinks(projectId,db);
  const result={
    projectId,status:project.status,health,derivedMilestoneHealth,
    currentMilestone:current?{
      milestoneId:current.milestoneId,milestoneKey:current.milestoneKey,
      displayName:current.displayName,health:current.health,
      progressPercent:current.progress.effectivePercent,
      targetEnd:current.forecast.targetEnd,forecastEnd:current.forecast.forecastEnd
    }:null,
    forecastEnd,
    milestoneCount:intelligence.length,
    completedMilestoneCount:intelligence.filter(x=>x.managementStatus==='COMPLETED').length,
    milestones:intelligence,
    staleness:projectStaleness,
    blockers:projectBlockers.map(row=>({
      id:row.id,blockerKey:row.blocker_key,reason:row.reason,
      waitingOn:row.waiting_on||null,resumeCondition:row.resume_condition||null,
      ownerIdentityId:row.owner_identity_id||null
    })),
    latestUpdate,
    milestoneVersionLinks:links,
    asOf:at
  };
  if(persist){
    await db.execute('UPDATE projects SET health=? WHERE id=?',[health,projectId]);
  }
  return result;
};

export const refreshProjectIntelligence=(projectId,input={})=>
  getProjectIntelligence(projectId,{asOf:input.asOf||new Date(),persist:true});
