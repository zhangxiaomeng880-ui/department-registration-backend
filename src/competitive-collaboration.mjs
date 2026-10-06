import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const BENCHMARK_TYPES=new Set(['PRODUCT_MARKET','CREATIVE_CONTENT','AI_CAPABILITY']);
const OBSERVATION_TYPES=new Set(['FACT','INFERENCE']);
const CONFIDENCE=new Set(['LOW','MEDIUM','HIGH']);
const APPROVAL_DECISIONS=new Set(['APPROVE','REJECT','REQUEST_CHANGE','EXPIRE']);
const APPROVAL_TERMINAL=new Set(['APPROVED','REJECTED','REQUEST_CHANGE','EXPIRED']);
const NOTIFICATION_STATUSES=new Set(['UNREAD','READ','DISMISSED']);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const upper=value=>value==null?null:String(value).toUpperCase();
const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asDate=value=>{
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime())) throw errorOf('Invalid date','INVALID_DATE',400,{value});
  return d;
};
const dateOnly=value=>asDate(value).toISOString().slice(0,10);
const addDays=(date,days)=>new Date(date.getTime()+Number(days)*86400000);

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    `SELECT w.id,w.tenant_id,w.status FROM workspaces w WHERE w.id=?`,[workspaceId]
  );
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  if(rows[0].status!=='ACTIVE') throw errorOf('Workspace is not active','WORKSPACE_NOT_ACTIVE',409);
  return rows[0];
};
const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadSubject=async(subjectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM benchmark_subjects WHERE id=?',[subjectId]);
  if(!rows.length) throw errorOf('Benchmark subject not found','BENCHMARK_SUBJECT_NOT_FOUND',404);
  return rows[0];
};
const assertProjectWorkspace=async(projectId,workspaceId,db)=>{
  if(!projectId) return null;
  const project=await loadProject(projectId,db);
  if(project.workspace_id!==workspaceId) throw errorOf(
    'Benchmark project must be in the same workspace','BENCHMARK_WORKSPACE_MISMATCH',409
  );
  return project;
};
const insertActivity=async(db,{tenantId,workspaceId,projectId=null,eventType,objectType,objectId,actorIdentityId=null,payload=null})=>{
  const id=randomUUID();
  await db.execute(
    `INSERT INTO activity_events
      (id,tenant_id,workspace_id,project_id,event_type,object_type,object_id,actor_identity_id,payload_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,tenantId,workspaceId,projectId,eventType,objectType,objectId,actorIdentityId,asJson(payload)]
  );
  return id;
};
const createNotification=async(db,{
  tenantId,workspaceId,projectId=null,recipientIdentityId=null,notificationType,severity='INFO',
  sourceType,sourceId,title,bodyText=null,dedupeKey=null
})=>{
  const id=randomUUID();
  try{
    await db.execute(
      `INSERT INTO notifications
        (id,tenant_id,workspace_id,project_id,recipient_identity_id,notification_type,severity,
         source_type,source_id,title,body_text,status,dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'UNREAD',?)`,
      [
        id,tenantId,workspaceId,projectId,recipientIdentityId,notificationType,severity,
        sourceType,sourceId,title,bodyText,dedupeKey
      ]
    );
    return id;
  }catch(error){
    if(error.code==='ER_DUP_ENTRY'&&dedupeKey){
      const [rows]=await db.execute('SELECT id FROM notifications WHERE dedupe_key=?',[dedupeKey]);
      return rows[0]?.id||null;
    }
    throw error;
  }
};

export const createBenchmarkDimension=async input=>{
  if(!input?.workspaceId||!input?.benchmarkType||!input?.dimensionKey||!input?.displayName) throw errorOf(
    'workspaceId, benchmarkType, dimensionKey and displayName are required','INVALID_BENCHMARK_DIMENSION'
  );
  const type=upper(input.benchmarkType);
  if(!BENCHMARK_TYPES.has(type)) throw errorOf('Invalid benchmarkType','INVALID_BENCHMARK_TYPE');
  const db=getRuntimePool();
  await loadWorkspace(input.workspaceId,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO benchmark_dimensions
      (id,workspace_id,benchmark_type,dimension_key,display_name,description,unit,comparison_direction,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,type,input.dimensionKey,input.displayName,input.description||null,
      input.unit||null,input.comparisonDirection||null,upper(input.status||'ACTIVE')
    ]
  );
  return {id,workspaceId:input.workspaceId,benchmarkType:type,dimensionKey:input.dimensionKey};
};

export const createBenchmarkSubject=async input=>{
  if(!input?.workspaceId||!input?.benchmarkType||!input?.subjectKey||!input?.name) throw errorOf(
    'workspaceId, benchmarkType, subjectKey and name are required','INVALID_BENCHMARK_SUBJECT'
  );
  const type=upper(input.benchmarkType);
  if(!BENCHMARK_TYPES.has(type)) throw errorOf('Invalid benchmarkType','INVALID_BENCHMARK_TYPE');
  if(type==='CREATIVE_CONTENT'){
    if(!input.creativeUsageRole||!input.rightsStatus||input.forbiddenCopying!==true) throw errorOf(
      'Creative benchmark requires usage role, rights status and forbiddenCopying=true',
      'CREATIVE_REFERENCE_GOVERNANCE_REQUIRED',409
    );
  }
  if(type==='AI_CAPABILITY'&&!input.capabilityKey) throw errorOf(
    'AI capability benchmark requires capabilityKey','CAPABILITY_BENCHMARK_CAPABILITY_REQUIRED',409
  );
  const db=getRuntimePool();
  const workspace=await loadWorkspace(input.workspaceId,db);
  await assertProjectWorkspace(input.projectId||null,input.workspaceId,db);
  if(input.capabilityKey){
    const [caps]=await db.execute('SELECT capability_key FROM capability_registry WHERE capability_key=?',[input.capabilityKey]);
    if(!caps.length) throw errorOf('Capability not found','CAPABILITY_NOT_FOUND',404);
  }
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO benchmark_subjects
      (id,workspace_id,project_id,benchmark_type,subject_key,name,capability_key,external_reference_json,
       creative_usage_role,rights_status,forbidden_copying,status,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.projectId||null,type,input.subjectKey,input.name,input.capabilityKey||null,
      asJson(input.externalReference||null),input.creativeUsageRole||null,input.rightsStatus||null,
      input.forbiddenCopying===true?1:0,upper(input.status||'ACTIVE'),asJson(input.metadata||null)
    ]
  );
  await insertActivity(db,{
    tenantId:workspace.tenant_id,workspaceId:input.workspaceId,projectId:input.projectId||null,
    eventType:'BENCHMARK_SUBJECT_CREATED',objectType:'BENCHMARK_SUBJECT',objectId:id,
    actorIdentityId:input.actorIdentityId||null,payload:{benchmarkType:type,subjectKey:input.subjectKey}
  });
  return {id,workspaceId:input.workspaceId,projectId:input.projectId||null,benchmarkType:type,subjectKey:input.subjectKey,name:input.name};
};

export const createBenchmarkSnapshot=async(subjectId,input={})=>{
  if(!input.sourceProvider||!input.sourceRef||!input.observedAt||!input.asOfDate||!input.freshnessDays) throw errorOf(
    'sourceProvider, sourceRef, observedAt, asOfDate and freshnessDays are required','INVALID_BENCHMARK_SNAPSHOT'
  );
  const freshnessDays=Number(input.freshnessDays);
  if(!Number.isInteger(freshnessDays)||freshnessDays<1||freshnessDays>3650) throw errorOf(
    'freshnessDays must be an integer between 1 and 3650','INVALID_BENCHMARK_FRESHNESS'
  );
  const observedAt=asDate(input.observedAt);
  const db=getRuntimePool(),subject=await loadSubject(subjectId,db);
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE benchmark_snapshots SET status='HISTORICAL' WHERE subject_id=? AND status='CURRENT'",
      [subjectId]
    );
    const id=input.id||randomUUID();
    const expiresAt=addDays(observedAt,freshnessDays);
    await conn.execute(
      `INSERT INTO benchmark_snapshots
        (id,subject_id,snapshot_key,source_provider,source_ref,observed_at,as_of_date,region,plan_key,
         version_label,freshness_days,expires_at,status,evidence_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CURRENT',?)`,
      [
        id,subjectId,input.snapshotKey||`SNAP-${observedAt.toISOString()}`,input.sourceProvider,
        input.sourceRef,observedAt,dateOnly(input.asOfDate),input.region||null,input.planKey||null,
        input.versionLabel||null,freshnessDays,expiresAt,asJson(input.evidence||null)
      ]
    );
    if(subject.benchmark_type==='CREATIVE_CONTENT'){
      await conn.execute(
        `INSERT INTO creative_references
          (id,subject_id,snapshot_id,usage_role,rights_status,forbidden_copying,reference_scope_json)
         VALUES (?,?,?,?,?,TRUE,?)`,
        [
          randomUUID(),subjectId,id,subject.creative_usage_role,subject.rights_status,
          asJson(input.referenceScope||null)
        ]
      );
    }
    await conn.commit();
    return {id,subjectId,status:'CURRENT',observedAt,asOfDate:dateOnly(input.asOfDate),expiresAt};
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
};

export const addBenchmarkObservation=async(snapshotId,input={})=>{
  if(!input.dimensionKey||!input.observationType||!input.statement||!input.confidence||!input.evidence) throw errorOf(
    'dimensionKey, observationType, statement, confidence and evidence are required','INVALID_BENCHMARK_OBSERVATION'
  );
  const type=upper(input.observationType),confidence=upper(input.confidence);
  if(!OBSERVATION_TYPES.has(type)) throw errorOf('Invalid observationType','INVALID_OBSERVATION_TYPE');
  if(!CONFIDENCE.has(confidence)) throw errorOf('Invalid confidence','INVALID_CONFIDENCE');
  const db=getRuntimePool();
  const [snapshots]=await db.execute('SELECT id FROM benchmark_snapshots WHERE id=?',[snapshotId]);
  if(!snapshots.length) throw errorOf('Benchmark snapshot not found','BENCHMARK_SNAPSHOT_NOT_FOUND',404);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO benchmark_observations
      (id,snapshot_id,dimension_key,observation_type,statement,value_json,confidence,evidence_json,source_locator_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,snapshotId,input.dimensionKey,type,input.statement,asJson(input.value||null),confidence,
      asJson(input.evidence),asJson(input.sourceLocator||null)
    ]
  );
  return {id,snapshotId,dimensionKey:input.dimensionKey,observationType:type,confidence};
};

export const createCapabilityBenchmarkRun=async(subjectId,input={})=>{
  if(!input.snapshotId||!input.evidence) throw errorOf(
    'snapshotId and evidence are required','INVALID_CAPABILITY_BENCHMARK_RUN'
  );
  const db=getRuntimePool(),subject=await loadSubject(subjectId,db);
  if(subject.benchmark_type!=='AI_CAPABILITY'||!subject.capability_key) throw errorOf(
    'Subject is not an AI capability benchmark','BENCHMARK_SUBJECT_TYPE_MISMATCH',409
  );
  const [snapshots]=await db.execute(
    'SELECT id,subject_id FROM benchmark_snapshots WHERE id=?',[input.snapshotId]
  );
  if(!snapshots.length||snapshots[0].subject_id!==subjectId) throw errorOf(
    'Snapshot does not belong to capability subject','BENCHMARK_SNAPSHOT_SCOPE_MISMATCH',409
  );
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO capability_benchmark_runs
      (id,subject_id,snapshot_id,capability_key,eval_run_id,quality_score,latency_ms,cost_amount,
       cost_currency,reliability_score,reference_support_json,rights_terms_json,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,subjectId,input.snapshotId,subject.capability_key,input.evalRunId||null,
      input.qualityScore==null?null:Number(input.qualityScore),
      input.latencyMs==null?null:Number(input.latencyMs),
      input.costAmount==null?null:Number(input.costAmount),input.costCurrency?upper(input.costCurrency):null,
      input.reliabilityScore==null?null:Number(input.reliabilityScore),
      asJson(input.referenceSupport||null),asJson(input.rightsTerms||null),asJson(input.evidence)
    ]
  );
  return {id,subjectId,capabilityKey:subject.capability_key,snapshotId:input.snapshotId};
};

export const createMarketSignal=async input=>{
  if(!input?.workspaceId||!input?.signalKey||!input?.signalType||!input?.summary||
     !input?.sourceProvider||!input?.sourceRef||!input?.observedAt||!input?.asOfDate||
     !input?.confidence||!input?.freshnessDays||!input?.evidence) throw errorOf(
    'Market signal requires scope, source, as-of, freshness, confidence and evidence',
    'INVALID_MARKET_SIGNAL'
  );
  const confidence=upper(input.confidence);
  if(!CONFIDENCE.has(confidence)) throw errorOf('Invalid confidence','INVALID_CONFIDENCE');
  const db=getRuntimePool(),workspace=await loadWorkspace(input.workspaceId,db);
  await assertProjectWorkspace(input.projectId||null,input.workspaceId,db);
  if(input.subjectId){
    const subject=await loadSubject(input.subjectId,db);
    if(subject.workspace_id!==input.workspaceId) throw errorOf('Signal subject workspace mismatch','BENCHMARK_WORKSPACE_MISMATCH',409);
  }
  const observedAt=asDate(input.observedAt),freshnessDays=Number(input.freshnessDays);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO market_signals
      (id,workspace_id,project_id,subject_id,signal_key,signal_type,summary,source_provider,source_ref,
       observed_at,as_of_date,confidence,expires_at,evidence_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.projectId||null,input.subjectId||null,input.signalKey,input.signalType,
      input.summary,input.sourceProvider,input.sourceRef,observedAt,dateOnly(input.asOfDate),confidence,
      addDays(observedAt,freshnessDays),asJson(input.evidence),upper(input.status||'ACTIVE')
    ]
  );
  await insertActivity(db,{
    tenantId:workspace.tenant_id,workspaceId:input.workspaceId,projectId:input.projectId||null,
    eventType:'MARKET_SIGNAL_CREATED',objectType:'MARKET_SIGNAL',objectId:id,
    actorIdentityId:input.actorIdentityId||null,payload:{signalType:input.signalType}
  });
  return {id,workspaceId:input.workspaceId,projectId:input.projectId||null,signalKey:input.signalKey};
};

export const createCompetitorChangeEvent=async(subjectId,input={})=>{
  if(!input.toSnapshotId||!input.changeType||!input.severity||!input.summary||!input.evidence) throw errorOf(
    'toSnapshotId, changeType, severity, summary and evidence are required','INVALID_COMPETITOR_CHANGE'
  );
  const db=getRuntimePool(),subject=await loadSubject(subjectId,db);
  const ids=[input.fromSnapshotId,input.toSnapshotId].filter(Boolean);
  if(ids.length){
    const placeholders=ids.map(()=>'?').join(',');
    const [rows]=await db.execute(
      `SELECT id,subject_id FROM benchmark_snapshots WHERE id IN (${placeholders})`,ids
    );
    if(rows.length!==ids.length||rows.some(row=>row.subject_id!==subjectId)) throw errorOf(
      'Change snapshots must belong to benchmark subject','BENCHMARK_SNAPSHOT_SCOPE_MISMATCH',409
    );
  }
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO competitor_change_events
      (id,subject_id,from_snapshot_id,to_snapshot_id,change_type,severity,summary,evidence_json,detected_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,subjectId,input.fromSnapshotId||null,input.toSnapshotId,input.changeType,upper(input.severity),
      input.summary,asJson(input.evidence),input.detectedAt?asDate(input.detectedAt):new Date()
    ]
  );
  const workspace=await loadWorkspace(subject.workspace_id,db);
  await insertActivity(db,{
    tenantId:workspace.tenant_id,workspaceId:subject.workspace_id,projectId:subject.project_id||null,
    eventType:'BENCHMARK_CHANGE_DETECTED',objectType:'BENCHMARK_CHANGE',objectId:id,
    payload:{subjectId,changeType:input.changeType,severity:upper(input.severity)}
  });
  return {id,subjectId,changeType:input.changeType,severity:upper(input.severity)};
};

export const linkBenchmarkDecision=async input=>{
  if(!input?.projectId||!input?.subjectId||!input?.linkRole||!input?.rationale) throw errorOf(
    'projectId, subjectId, linkRole and rationale are required','INVALID_BENCHMARK_DECISION_LINK'
  );
  const db=getRuntimePool(),project=await loadProject(input.projectId,db),subject=await loadSubject(input.subjectId,db);
  if(project.workspace_id!==subject.workspace_id) throw errorOf(
    'Benchmark and project must share workspace','BENCHMARK_WORKSPACE_MISMATCH',409
  );
  if(input.decisionId){
    const [decisions]=await db.execute('SELECT project_id FROM project_decisions WHERE id=?',[input.decisionId]);
    if(!decisions.length) throw errorOf('Project decision not found','PROJECT_DECISION_NOT_FOUND',404);
    if(decisions[0].project_id!==input.projectId) throw errorOf('Decision project mismatch','BENCHMARK_DECISION_SCOPE_MISMATCH',409);
  }
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO benchmark_decision_links
      (id,project_id,decision_id,subject_id,snapshot_id,observation_id,change_event_id,link_role,rationale)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,input.projectId,input.decisionId||null,input.subjectId,input.snapshotId||null,
      input.observationId||null,input.changeEventId||null,upper(input.linkRole),input.rationale
    ]
  );
  return {id,projectId:input.projectId,subjectId:input.subjectId,decisionId:input.decisionId||null,linkRole:upper(input.linkRole)};
};

export const getBenchmarkSubjectIntelligence=async(subjectId,{asOf=new Date()}={})=>{
  const db=getRuntimePool(),subject=await loadSubject(subjectId,db),at=asDate(asOf);
  const [snapshots]=await db.execute(
    'SELECT * FROM benchmark_snapshots WHERE subject_id=? ORDER BY observed_at DESC,id DESC',[subjectId]
  );
  const current=snapshots.find(row=>row.status==='CURRENT')||snapshots[0]||null;
  const [observations]=current
    ? await db.execute('SELECT * FROM benchmark_observations WHERE snapshot_id=? ORDER BY created_at,id',[current.id])
    : [[]];
  const [changes]=await db.execute(
    'SELECT * FROM competitor_change_events WHERE subject_id=? ORDER BY detected_at DESC,id DESC',[subjectId]
  );
  const [links]=await db.execute(
    'SELECT * FROM benchmark_decision_links WHERE subject_id=? ORDER BY created_at DESC,id DESC',[subjectId]
  );
  const [capRuns]=subject.benchmark_type==='AI_CAPABILITY'
    ? await db.execute('SELECT * FROM capability_benchmark_runs WHERE subject_id=? ORDER BY created_at DESC,id DESC',[subjectId])
    : [[]];
  const [creative]=subject.benchmark_type==='CREATIVE_CONTENT'
    ? await db.execute('SELECT * FROM creative_references WHERE subject_id=? ORDER BY created_at DESC,id DESC',[subjectId])
    : [[]];
  return {
    subject:{
      id:subject.id,workspaceId:subject.workspace_id,projectId:subject.project_id||null,
      benchmarkType:subject.benchmark_type,subjectKey:subject.subject_key,name:subject.name,
      capabilityKey:subject.capability_key||null,creativeUsageRole:subject.creative_usage_role||null,
      rightsStatus:subject.rights_status||null,forbiddenCopying:Boolean(subject.forbidden_copying)
    },
    currentSnapshot:current?{
      id:current.id,snapshotKey:current.snapshot_key,sourceProvider:current.source_provider,
      sourceRef:current.source_ref,observedAt:current.observed_at,asOfDate:current.as_of_date,
      region:current.region||null,planKey:current.plan_key||null,versionLabel:current.version_label||null,
      freshnessDays:Number(current.freshness_days),expiresAt:current.expires_at,
      stale:new Date(current.expires_at).getTime()<at.getTime()
    }:null,
    observations:observations.map(row=>({
      id:row.id,dimensionKey:row.dimension_key,observationType:row.observation_type,
      statement:row.statement,value:parseJson(row.value_json),confidence:row.confidence,
      evidence:parseJson(row.evidence_json),sourceLocator:parseJson(row.source_locator_json)
    })),
    changes:changes.map(row=>({
      id:row.id,changeType:row.change_type,severity:row.severity,summary:row.summary,
      fromSnapshotId:row.from_snapshot_id||null,toSnapshotId:row.to_snapshot_id,detectedAt:row.detected_at
    })),
    decisionLinks:links.map(row=>({
      id:row.id,projectId:row.project_id,decisionId:row.decision_id||null,
      linkRole:row.link_role,rationale:row.rationale
    })),
    capabilityRuns:capRuns.map(row=>({
      id:row.id,capabilityKey:row.capability_key,qualityScore:row.quality_score==null?null:Number(row.quality_score),
      latencyMs:row.latency_ms==null?null:Number(row.latency_ms),
      costAmount:row.cost_amount==null?null:Number(row.cost_amount),
      costCurrency:row.cost_currency||null,reliabilityScore:row.reliability_score==null?null:Number(row.reliability_score)
    })),
    creativeReferences:creative.map(row=>({
      id:row.id,usageRole:row.usage_role,rightsStatus:row.rights_status,
      forbiddenCopying:Boolean(row.forbidden_copying),referenceScope:parseJson(row.reference_scope_json)
    })),
    asOf:at
  };
};

export const getProjectCompetitiveIntelligence=async(projectId,{asOf=new Date()}={})=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db),at=asDate(asOf);
  const [subjects]=await db.execute(
    `SELECT DISTINCT s.* FROM benchmark_subjects s
      LEFT JOIN benchmark_decision_links l ON l.subject_id=s.id
      WHERE s.workspace_id=? AND (s.project_id=? OR l.project_id=?)
      ORDER BY s.benchmark_type,s.name,s.id`,
    [project.workspace_id,projectId,projectId]
  );
  const result=[];
  for(const row of subjects) result.push(await getBenchmarkSubjectIntelligence(row.id,{asOf:at}));
  const [signals]=await db.execute(
    `SELECT * FROM market_signals
      WHERE workspace_id=? AND (project_id=? OR project_id IS NULL)
      ORDER BY observed_at DESC,id DESC`,
    [project.workspace_id,projectId]
  );
  return {
    projectId,
    subjects:result,
    staleSubjectCount:result.filter(x=>x.currentSnapshot?.stale).length,
    signals:signals.map(row=>({
      id:row.id,signalKey:row.signal_key,signalType:row.signal_type,summary:row.summary,
      sourceProvider:row.source_provider,sourceRef:row.source_ref,observedAt:row.observed_at,
      asOfDate:row.as_of_date,confidence:row.confidence,expiresAt:row.expires_at,
      stale:new Date(row.expires_at).getTime()<at.getTime()
    })),
    asOf:at
  };
};

const loadApproval=async(id,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM approval_requests WHERE id=?',[id]);
  if(!rows.length) throw errorOf('Approval request not found','APPROVAL_REQUEST_NOT_FOUND',404);
  return rows[0];
};

export const createApprovalRequest=async input=>{
  if(!input?.workspaceId||!input?.requestKey||!input?.targetType||!input?.targetId||
     !input?.requestedAction||!input?.evidence) throw errorOf(
    'workspaceId, requestKey, target, requestedAction and evidence are required','INVALID_APPROVAL_REQUEST'
  );
  const db=getRuntimePool(),workspace=await loadWorkspace(input.workspaceId,db);
  await assertProjectWorkspace(input.projectId||null,input.workspaceId,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO approval_requests
      (id,tenant_id,workspace_id,project_id,request_key,target_type,target_id,required_role,
       approver_identity_id,requested_action,risk_level,context_json,evidence_json,due_at,escalation_at,
       status,effective_object_type,effective_object_id,effective_version,requested_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?)`,
    [
      id,workspace.tenant_id,input.workspaceId,input.projectId||null,input.requestKey,upper(input.targetType),
      String(input.targetId),input.requiredRole||null,input.approverIdentityId||null,input.requestedAction,
      upper(input.riskLevel||'MEDIUM'),asJson(input.context||null),asJson(input.evidence),
      input.dueAt?asDate(input.dueAt):null,input.escalationAt?asDate(input.escalationAt):null,
      input.effectiveObjectType||null,input.effectiveObjectId||null,input.effectiveVersion||null,
      input.requestedByIdentityId||null
    ]
  );
  await createNotification(db,{
    tenantId:workspace.tenant_id,workspaceId:input.workspaceId,projectId:input.projectId||null,
    recipientIdentityId:input.approverIdentityId||null,notificationType:'PENDING_APPROVAL',
    severity:upper(input.riskLevel||'MEDIUM')==='HIGH'?'WARNING':'INFO',
    sourceType:'APPROVAL_REQUEST',sourceId:id,title:`Approval required: ${input.requestedAction}`,
    bodyText:null,dedupeKey:`approval:${id}:pending`
  });
  await insertActivity(db,{
    tenantId:workspace.tenant_id,workspaceId:input.workspaceId,projectId:input.projectId||null,
    eventType:'APPROVAL_REQUESTED',objectType:'APPROVAL_REQUEST',objectId:id,
    actorIdentityId:input.requestedByIdentityId||null,
    payload:{requiredRole:input.requiredRole||null,riskLevel:upper(input.riskLevel||'MEDIUM')}
  });
  return {id,projectId:input.projectId||null,requestKey:input.requestKey,status:'PENDING'};
};

export const decideApproval=async(approvalId,input={})=>{
  if(!input.decision||!input.reason||!input.evidence) throw errorOf(
    'decision, reason and evidence are required','INVALID_APPROVAL_DECISION'
  );
  const decision=upper(input.decision);
  if(!APPROVAL_DECISIONS.has(decision)) throw errorOf('Invalid approval decision','INVALID_APPROVAL_DECISION');
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM approval_requests WHERE id=? FOR UPDATE',[approvalId]);
    if(!rows.length) throw errorOf('Approval request not found','APPROVAL_REQUEST_NOT_FOUND',404);
    const approval=rows[0];
    if(approval.status!=='PENDING') throw errorOf(
      'Approval request is already terminal','APPROVAL_ALREADY_DECIDED',409,{status:approval.status}
    );
    if(approval.approver_identity_id&&!input.adminOverride&&
       approval.approver_identity_id!==input.decidedByIdentityId){
      throw errorOf('Approval decision must be made by assigned approver','APPROVER_MISMATCH',403);
    }
    const status={
      APPROVE:'APPROVED',REJECT:'REJECTED',REQUEST_CHANGE:'REQUEST_CHANGE',EXPIRE:'EXPIRED'
    }[decision];
    const decisionId=randomUUID();
    await conn.execute(
      `INSERT INTO approval_decisions
        (id,approval_request_id,decision,reason,evidence_json,decided_by_identity_id)
       VALUES (?,?,?,?,?,?)`,
      [decisionId,approvalId,decision,input.reason,asJson(input.evidence),input.decidedByIdentityId||null]
    );
    await conn.execute(
      `UPDATE approval_requests SET status=?,decided_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [status,approvalId]
    );
    await createNotification(conn,{
      tenantId:approval.tenant_id,workspaceId:approval.workspace_id,projectId:approval.project_id||null,
      recipientIdentityId:approval.requested_by_identity_id||null,
      notificationType:'APPROVAL_DECIDED',severity:status==='REJECTED'?'WARNING':'INFO',
      sourceType:'APPROVAL_REQUEST',sourceId:approvalId,title:`Approval ${status.toLowerCase()}`,
      dedupeKey:`approval:${approvalId}:decision`
    });
    await insertActivity(conn,{
      tenantId:approval.tenant_id,workspaceId:approval.workspace_id,projectId:approval.project_id||null,
      eventType:'APPROVAL_DECIDED',objectType:'APPROVAL_REQUEST',objectId:approvalId,
      actorIdentityId:input.decidedByIdentityId||null,payload:{decision,status}
    });
    await conn.commit();
    return {approvalId,decisionId,decision,status};
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
};

export const refreshApprovalDeadlines=async({workspaceId,asOf=new Date()}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_APPROVAL_REFRESH');
  const db=getRuntimePool(),workspace=await loadWorkspace(workspaceId,db),at=asDate(asOf);
  const [rows]=await db.execute(
    `SELECT * FROM approval_requests WHERE workspace_id=? AND status='PENDING'
      AND ((due_at IS NOT NULL AND due_at<?) OR (escalation_at IS NOT NULL AND escalation_at<?))`,
    [workspaceId,at,at]
  );
  const results=[];
  for(const approval of rows){
    if(approval.due_at&&new Date(approval.due_at).getTime()<at.getTime()){
      try{
        results.push(await decideApproval(approval.id,{
          decision:'EXPIRE',reason:'Approval due time elapsed',
          evidence:{asOf:at.toISOString(),system:true},adminOverride:true
        }));
      }catch(error){
        if(error.code!=='APPROVAL_ALREADY_DECIDED') throw error;
      }
      continue;
    }
    if(approval.escalation_at&&new Date(approval.escalation_at).getTime()<at.getTime()){
      await createNotification(db,{
        tenantId:workspace.tenant_id,workspaceId,projectId:approval.project_id||null,
        recipientIdentityId:approval.approver_identity_id||null,notificationType:'APPROVAL_ESCALATION',
        severity:'WARNING',sourceType:'APPROVAL_REQUEST',sourceId:approval.id,
        title:'Approval escalation required',dedupeKey:`approval:${approval.id}:escalation`
      });
      results.push({approvalId:approval.id,status:'PENDING',escalated:true});
    }
  }
  return results;
};

export const listApprovalInbox=async({workspaceId,projectId=null,status='PENDING',limit=100}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_APPROVAL_QUERY');
  const db=getRuntimePool();
  const safe=Math.max(1,Math.min(500,Number(limit)||100));
  const params=[workspaceId],where=['workspace_id=?'];
  if(projectId){where.push('project_id=?');params.push(projectId);}
  if(status){where.push('status=?');params.push(upper(status));}
  const [rows]=await db.execute(
    `SELECT * FROM approval_requests WHERE ${where.join(' AND ')}
      ORDER BY CASE risk_level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
      due_at,created_at LIMIT ${safe}`,params
  );
  return rows.map(row=>({
    id:row.id,projectId:row.project_id||null,requestKey:row.request_key,targetType:row.target_type,
    targetId:row.target_id,requiredRole:row.required_role||null,approverIdentityId:row.approver_identity_id||null,
    requestedAction:row.requested_action,riskLevel:row.risk_level,status:row.status,
    dueAt:row.due_at||null,escalationAt:row.escalation_at||null,effectiveVersion:row.effective_version||null,
    createdAt:row.created_at,decidedAt:row.decided_at||null
  }));
};

export const listNotifications=async({workspaceId,projectId=null,recipientIdentityId=null,status=null,limit=100}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_NOTIFICATION_QUERY');
  const db=getRuntimePool(),where=['workspace_id=?'],params=[workspaceId];
  if(projectId){where.push('project_id=?');params.push(projectId);}
  if(recipientIdentityId){where.push('recipient_identity_id=?');params.push(recipientIdentityId);}
  if(status){where.push('status=?');params.push(upper(status));}
  const safe=Math.max(1,Math.min(500,Number(limit)||100));
  const [rows]=await db.execute(
    `SELECT * FROM notifications WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC,id DESC LIMIT ${safe}`,params
  );
  return rows.map(row=>({
    id:row.id,projectId:row.project_id||null,recipientIdentityId:row.recipient_identity_id||null,
    notificationType:row.notification_type,severity:row.severity,sourceType:row.source_type,
    sourceId:row.source_id,title:row.title,bodyText:row.body_text||null,status:row.status,
    createdAt:row.created_at,readAt:row.read_at||null,dismissedAt:row.dismissed_at||null
  }));
};

export const updateNotification=async(notificationId,input={})=>{
  const status=upper(input.status);
  if(!NOTIFICATION_STATUSES.has(status)) throw errorOf('Invalid notification status','INVALID_NOTIFICATION_STATUS');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,status FROM notifications WHERE id=?',[notificationId]);
  if(!rows.length) throw errorOf('Notification not found','NOTIFICATION_NOT_FOUND',404);
  await db.execute(
    `UPDATE notifications SET status=?,
      read_at=CASE WHEN ?='READ' THEN COALESCE(read_at,CURRENT_TIMESTAMP(6)) ELSE read_at END,
      dismissed_at=CASE WHEN ?='DISMISSED' THEN CURRENT_TIMESTAMP(6) ELSE dismissed_at END
      WHERE id=?`,
    [status,status,status,notificationId]
  );
  return {id:notificationId,status};
};

export const listActivityEvents=async({workspaceId,projectId=null,limit=100}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_ACTIVITY_QUERY');
  const db=getRuntimePool(),safe=Math.max(1,Math.min(500,Number(limit)||100));
  const [rows]=projectId
    ? await db.execute(
        `SELECT * FROM activity_events WHERE workspace_id=? AND project_id=?
          ORDER BY created_at DESC,id DESC LIMIT ${safe}`,[workspaceId,projectId]
      )
    : await db.execute(
        `SELECT * FROM activity_events WHERE workspace_id=?
          ORDER BY created_at DESC,id DESC LIMIT ${safe}`,[workspaceId]
      );
  return rows.map(row=>({
    id:row.id,projectId:row.project_id||null,eventType:row.event_type,objectType:row.object_type,
    objectId:row.object_id,actorIdentityId:row.actor_identity_id||null,
    payload:parseJson(row.payload_json),createdAt:row.created_at
  }));
};

export const createHumanGateApproval=async({
  projectId,stageKey,runId,taskId,gateKey,requestedByIdentityId=null,evidence={}
})=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  return createApprovalRequest({
    workspaceId:project.workspace_id,projectId,
    requestKey:`HUMAN_GATE:${runId}:${stageKey}:${taskId||'NO_TASK'}`,
    targetType:'STAGE',targetId:stageKey,requiredRole:'REVIEWER',
    requestedAction:`Approve Human Gate ${gateKey||stageKey}`,
    riskLevel:'HIGH',
    context:{runId,taskId,stageKey,gateKey},
    evidence,requestedByIdentityId,
    effectiveObjectType:'PROJECT_STAGE',
    effectiveObjectId:stageKey
  });
};
