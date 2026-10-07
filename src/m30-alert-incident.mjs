import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M30-ALERT-INCIDENT';
const SEVERITIES=new Set(['INFO','WARNING','CRITICAL']);
const INCIDENT_TRANSITIONS={
  OPEN:new Set(['ACKNOWLEDGED','RESOLVED']),
  ACKNOWLEDGED:new Set(['RESOLVED']),
  RESOLVED:new Set()
};

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const nonEmpty=v=>{
  if(v==null)return false;if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const row=await one(db,'SELECT id,tenant_id,workspace_key,name FROM workspaces WHERE id=?',[workspaceId]);
  if(!row)throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return row;
};
const loadRule=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_alert_rules WHERE id=?',[id]);
  if(!row)throw errorOf('Alert rule not found','M30_ALERT_RULE_NOT_FOUND',404);
  return row;
};
const loadAlert=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_alert_events WHERE id=?',[id]);
  if(!row)throw errorOf('Alert event not found','M30_ALERT_NOT_FOUND',404);
  return row;
};
const loadIncident=async(id,db=getRuntimePool())=>{
  const row=await one(db,'SELECT * FROM platform_incidents WHERE id=?',[id]);
  if(!row)throw errorOf('Incident not found','M30_INCIDENT_NOT_FOUND',404);
  return row;
};

export const resolveM30AlertRuleScope=async id=>{
  const x=await loadRule(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};
export const resolveM30AlertScope=async id=>{
  const x=await loadAlert(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};
export const resolveM30IncidentScope=async id=>{
  const x=await loadIncident(id);return {tenantId:x.tenant_id,workspaceId:x.workspace_id};
};

export const createPlatformAlertRule=async(workspaceId,input={},actorId=null)=>{
  requireFields(input,['ruleKey','displayName','sourceType','severity','condition','evidence'],'INVALID_M30_ALERT_RULE');
  const sourceType=upper(input.sourceType),severity=upper(input.severity);
  if(sourceType!=='PLATFORM_HEALTH')throw errorOf(
    'M30.3 currently requires governed PLATFORM_HEALTH facts','M30_ALERT_SOURCE_UNSUPPORTED',409
  );
  if(!SEVERITIES.has(severity))throw errorOf('Invalid alert severity','M30_ALERT_SEVERITY_INVALID');
  const statuses=(input.condition?.healthStatuses||[]).map(upper);
  const subjects=(input.condition?.subjectTypes||[]).map(upper);
  if(!statuses.length||statuses.some(x=>!['DEGRADED','DOWN'].includes(x)))throw errorOf(
    'Alert condition must include DEGRADED/DOWN healthStatuses','M30_ALERT_HEALTH_CONDITION_INVALID',409
  );
  if(!subjects.length||subjects.some(x=>!['ENVIRONMENT','CONNECTION'].includes(x)))throw errorOf(
    'Alert condition must include ENVIRONMENT/CONNECTION subjectTypes','M30_ALERT_SUBJECT_CONDITION_INVALID',409
  );
  const db=getRuntimePool(),w=await loadWorkspace(workspaceId,db),id=randomUUID();
  await db.execute(`INSERT INTO platform_alert_rules
    (id,tenant_id,workspace_id,rule_key,display_name,source_type,severity,condition_json,
     dedupe_window_seconds,status,evidence_json,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
    [id,w.tenant_id,workspaceId,input.ruleKey,input.displayName,sourceType,severity,asJson(input.condition),
     Number(input.dedupeWindowSeconds||3600),asJson(input.evidence),actorId]);
  return {id,workspaceId,ruleKey:input.ruleKey,displayName:input.displayName,
    sourceType,severity,status:'ACTIVE',condition:input.condition};
};

export const evaluatePlatformAlertRule=async(ruleId,input={})=>{
  const db=getRuntimePool(),rule=await loadRule(ruleId,db);
  if(rule.status!=='ACTIVE')throw errorOf('Alert rule is not active','M30_ALERT_RULE_NOT_ACTIVE',409);
  const condition=parseJson(rule.condition_json)||{},statuses=(condition.healthStatuses||[]).map(upper);
  const subjects=(condition.subjectTypes||[]).map(upper),asOf=input.asOf?asDate(input.asOf):new Date();
  const lookbackSeconds=Math.max(60,Number(condition.lookbackSeconds||3600));
  const from=new Date(asOf.getTime()-lookbackSeconds*1000);
  const statusQs=statuses.map(()=>'?').join(','),subjectQs=subjects.map(()=>'?').join(',');
  const facts=await list(db,`SELECT * FROM platform_health_events
    WHERE workspace_id=? AND observed_at>=? AND observed_at<=?
      AND health_status IN (${statusQs}) AND subject_type IN (${subjectQs})
    ORDER BY observed_at,id`,[rule.workspace_id,from,asOf,...statuses,...subjects]);
  const created=[];
  for(const fact of facts){
    const existing=await one(db,`SELECT id,status FROM platform_alert_events
      WHERE alert_rule_id=? AND source_fact_type='PLATFORM_HEALTH_EVENT' AND source_fact_id=?`,[rule.id,fact.id]);
    if(existing){created.push({id:existing.id,status:existing.status,idempotent:true});continue;}
    const id=randomUUID(),alertKey=rule.rule_key+':'+fact.subject_type+':'+fact.subject_id+':'+fact.id;
    await db.execute(`INSERT INTO platform_alert_events
      (id,tenant_id,workspace_id,alert_rule_id,alert_key,source_type,source_fact_type,source_fact_id,
       subject_type,subject_id,severity,status,title,payload_json,evidence_json,detected_at)
      VALUES (?,?,?,?,?,'PLATFORM_HEALTH','PLATFORM_HEALTH_EVENT',?,?,?,?, 'OPEN',?,?,?,?)`,
      [id,rule.tenant_id,rule.workspace_id,rule.id,alertKey,fact.id,fact.subject_type,fact.subject_id,
       rule.severity,rule.display_name,asJson({healthStatus:fact.health_status,reasonCode:fact.reason_code,
         latencyMs:fact.latency_ms,observedAt:fact.observed_at}),
       asJson({ruleEvidence:parseJson(rule.evidence_json),healthEventEvidence:parseJson(fact.evidence_json)}),fact.observed_at]);
    created.push({id,status:'OPEN',sourceFactId:fact.id,subjectType:fact.subject_type,subjectId:fact.subject_id,idempotent:false});
  }
  return {ruleId:rule.id,workspaceId:rule.workspace_id,evaluatedAt:asOf,matchedFactCount:facts.length,alerts:created};
};

export const createPlatformIncident=async(alertId,input={},actorId=null)=>{
  requireFields(input,['incidentKey','title','evidence'],'INVALID_M30_INCIDENT');
  const db=getRuntimePool(),alert=await loadAlert(alertId,db);
  if(alert.status!=='OPEN')throw errorOf('Incident requires OPEN alert','M30_INCIDENT_ALERT_NOT_OPEN',409);
  const existing=await one(db,'SELECT * FROM platform_incidents WHERE primary_alert_id=?',[alert.id]);
  if(existing)return {id:existing.id,alertId:alert.id,status:existing.status,idempotent:true};
  const id=randomUUID(),openedAt=input.openedAt?asDate(input.openedAt):new Date();
  await db.execute(`INSERT INTO platform_incidents
    (id,tenant_id,workspace_id,incident_key,primary_alert_id,severity,title,status,owner_identity_id,
     evidence_json,opened_at,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,'OPEN',?,?,?,?)`,
    [id,alert.tenant_id,alert.workspace_id,input.incidentKey,alert.id,upper(input.severity||alert.severity),
     input.title,input.ownerIdentityId||null,asJson(input.evidence),openedAt,actorId]);
  await db.execute(`INSERT INTO platform_incident_events
    (id,incident_id,event_type,from_status,to_status,payload_json,evidence_json,actor_identity_id,occurred_at)
    VALUES (?,?,'OPENED',NULL,'OPEN',?,?,?,?)`,
    [randomUUID(),id,asJson({primaryAlertId:alert.id}),asJson(input.evidence),actorId,openedAt]);
  return {id,workspaceId:alert.workspace_id,alertId:alert.id,incidentKey:input.incidentKey,
    severity:upper(input.severity||alert.severity),status:'OPEN',openedAt,idempotent:false};
};

export const transitionPlatformIncident=async(incidentId,input={},actorId=null)=>{
  requireFields(input,['action','evidence'],'INVALID_M30_INCIDENT_TRANSITION');
  const action=upper(input.action),toStatus=action==='ACKNOWLEDGE'?'ACKNOWLEDGED':action==='RESOLVE'?'RESOLVED':null;
  if(!toStatus)throw errorOf('Unsupported incident action','M30_INCIDENT_ACTION_INVALID');
  const db=getRuntimePool(),incident=await loadIncident(incidentId,db);
  if(incident.status===toStatus)return {id:incident.id,status:toStatus,idempotent:true};
  if(!INCIDENT_TRANSITIONS[incident.status]?.has(toStatus))throw errorOf(
    'Incident transition is not allowed','M30_INCIDENT_TRANSITION_INVALID',409,{from:incident.status,to:toStatus}
  );
  const occurredAt=input.occurredAt?asDate(input.occurredAt):new Date();
  if(toStatus==='RESOLVED'){
    requireFields(input,['rootCause','resolution'],'INVALID_M30_INCIDENT_RESOLUTION');
    const alert=await loadAlert(incident.primary_alert_id,db);
    const recovery=await one(db,`SELECT * FROM platform_health_events
      WHERE workspace_id=? AND subject_type=? AND subject_id=? AND health_status='HEALTHY'
        AND observed_at>? AND observed_at<=?
      ORDER BY observed_at DESC,id DESC LIMIT 1`,
      [incident.workspace_id,alert.subject_type,alert.subject_id,alert.detected_at,occurredAt]);
    if(!recovery)throw errorOf(
      'Incident cannot resolve without HEALTHY recovery evidence after the alert',
      'M30_INCIDENT_RECOVERY_EVIDENCE_REQUIRED',409
    );
    await db.execute(`UPDATE platform_incidents
      SET status='RESOLVED',root_cause_json=?,resolution_json=?,resolved_at=? WHERE id=?`,
      [asJson(input.rootCause),asJson({...input.resolution,recoveryHealthEventId:recovery.id}),occurredAt,incident.id]);
    await db.execute(`UPDATE platform_alert_events SET status='RESOLVED',resolved_at=? WHERE id=?`,
      [occurredAt,alert.id]);
  }else{
    await db.execute(`UPDATE platform_incidents SET status='ACKNOWLEDGED',owner_identity_id=COALESCE(?,owner_identity_id),
      acknowledged_at=? WHERE id=?`,[input.ownerIdentityId||actorId||null,occurredAt,incident.id]);
  }
  await db.execute(`INSERT INTO platform_incident_events
    (id,incident_id,event_type,from_status,to_status,payload_json,evidence_json,actor_identity_id,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),incident.id,toStatus==='RESOLVED'?'RESOLVED':'ACKNOWLEDGED',incident.status,toStatus,
     asJson(toStatus==='RESOLVED'?{rootCause:input.rootCause,resolution:input.resolution}:{ownerIdentityId:input.ownerIdentityId||actorId||null}),
     asJson(input.evidence),actorId,occurredAt]);
  return {id:incident.id,status:toStatus,occurredAt,idempotent:false};
};

export const evaluateM30AlertIncidentGate=async(workspaceId,input={})=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();
  const upstream=await one(db,`SELECT status FROM m30_release_rollback_gate_evaluations
    WHERE workspace_id=? AND gate_key='G-M30-RELEASE-ROLLBACK' ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]);
  const [rules,alerts,resolvedIncidents,recoveryEvents]=await Promise.all([
    count(db,"SELECT COUNT(*) count FROM platform_alert_rules WHERE workspace_id=? AND status='ACTIVE'",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM platform_alert_events WHERE workspace_id=?",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM platform_incidents WHERE workspace_id=? AND status='RESOLVED'",[workspaceId]),
    count(db,`SELECT COUNT(*) count FROM platform_incidents i
      JOIN platform_alert_events a ON a.id=i.primary_alert_id
      JOIN platform_health_events h ON h.workspace_id=i.workspace_id AND h.subject_type=a.subject_type
       AND h.subject_id=a.subject_id AND h.health_status='HEALTHY'
       AND h.observed_at>a.detected_at AND h.observed_at<=i.resolved_at
      WHERE i.workspace_id=? AND i.status='RESOLVED'`,[workspaceId])
  ]);
  const reasons=[];
  if(upstream?.status!=='PASS')reasons.push('M30_RELEASE_ROLLBACK_PASS_REQUIRED');
  if(rules<1)reasons.push('M30_ACTIVE_ALERT_RULE_REQUIRED');
  if(alerts<1)reasons.push('M30_ALERT_EVENT_REQUIRED');
  if(resolvedIncidents<1)reasons.push('M30_RESOLVED_INCIDENT_REQUIRED');
  if(recoveryEvents<1)reasons.push('M30_INCIDENT_RECOVERY_EVIDENCE_REQUIRED');
  const evidence={upstreamReleaseRollbackStatus:upstream?.status||null,activeRuleCount:rules,
    alertEventCount:alerts,resolvedIncidentCount:resolvedIncidents,recoveryEvidenceCount:recoveryEvents,
    incidentResolutionRequiresRecovery:true};
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_alert_incident_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30AlertIncidentState=async workspaceId=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const [rules,alerts,incidents,events,gates]=await Promise.all([
    list(db,'SELECT * FROM platform_alert_rules WHERE workspace_id=? ORDER BY created_at,id',[workspaceId]),
    list(db,'SELECT * FROM platform_alert_events WHERE workspace_id=? ORDER BY detected_at DESC,created_at DESC',[workspaceId]),
    list(db,'SELECT * FROM platform_incidents WHERE workspace_id=? ORDER BY opened_at DESC,created_at DESC',[workspaceId]),
    list(db,`SELECT e.* FROM platform_incident_events e JOIN platform_incidents i ON i.id=e.incident_id
      WHERE i.workspace_id=? ORDER BY e.occurred_at,e.created_at`,[workspaceId]),
    list(db,`SELECT * FROM m30_alert_incident_gate_evaluations
      WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId])
  ]);
  return {
    frontend:{language:'zh-CN',title:'告警 / 事故管理',
      policy:'告警必须绑定真实 Runtime/Health 事实；Incident RESOLVED 必须存在故障后的 HEALTHY 恢复证据。'},
    rules:rules.map(x=>({id:x.id,ruleKey:x.rule_key,displayName:x.display_name,sourceType:x.source_type,
      severity:x.severity,condition:parseJson(x.condition_json),status:x.status})),
    alerts:alerts.map(x=>({id:x.id,alertKey:x.alert_key,ruleId:x.alert_rule_id,sourceFactId:x.source_fact_id,
      subjectType:x.subject_type,subjectId:x.subject_id,severity:x.severity,status:x.status,title:x.title,
      payload:parseJson(x.payload_json),detectedAt:x.detected_at,resolvedAt:x.resolved_at})),
    incidents:incidents.map(x=>({id:x.id,incidentKey:x.incident_key,primaryAlertId:x.primary_alert_id,
      severity:x.severity,title:x.title,status:x.status,ownerIdentityId:x.owner_identity_id,
      rootCause:parseJson(x.root_cause_json),resolution:parseJson(x.resolution_json),
      openedAt:x.opened_at,acknowledgedAt:x.acknowledged_at,resolvedAt:x.resolved_at})),
    incidentEvents:events.map(x=>({id:x.id,incidentId:x.incident_id,eventType:x.event_type,
      fromStatus:x.from_status,toStatus:x.to_status,payload:parseJson(x.payload_json),occurredAt:x.occurred_at})),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,
      reasonCodes:parseJson(gates[0].reason_codes_json),evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),
      asOf:gates[0].as_of}:null
  };
};
