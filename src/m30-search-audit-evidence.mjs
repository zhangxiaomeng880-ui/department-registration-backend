import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M30-SEARCH-AUDIT';
const SEARCH_TYPES=new Set([
  'PROJECT','MILESTONE','WORK_ITEM','DECISION','ASSET',
  'ENVIRONMENT','CONNECTION','RELEASE','INCIDENT','BACKUP'
]);

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const rows=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const upper=v=>v==null?null:String(v).trim().toUpperCase();

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const row=await one(db,'SELECT id,tenant_id,workspace_key,name,status FROM workspaces WHERE id=?',[workspaceId]);
  if(!row)throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return row;
};

export const resolveM30SearchAuditScope=async workspaceId=>{
  const w=await loadWorkspace(workspaceId);return {tenantId:w.tenant_id,workspaceId:w.id};
};

const normalizeSearch=(type,row)=>({
  type,id:String(row.id),key:row.object_key||null,title:row.title||null,
  subtitle:row.subtitle||null,status:row.status||null,projectId:row.project_id||null,
  metadata:row.metadata||null
});

const searchQueries={
  PROJECT:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,project_key object_key,name title,project_type subtitle,status,id project_id,NULL metadata
      FROM projects WHERE workspace_id=? AND (project_key LIKE ? OR name LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  MILESTONE:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT m.id,m.milestone_key object_key,m.display_name title,m.objective subtitle,
      m.management_status status,m.project_id,NULL metadata
      FROM project_milestones m JOIN projects p ON p.id=m.project_id
      WHERE p.workspace_id=? AND (m.milestone_key LIKE ? OR m.display_name LIKE ? OR COALESCE(m.objective,'') LIKE ?)
      ORDER BY m.sequence_no,m.id LIMIT ?`,[workspaceId,like,like,like,limit]),
  WORK_ITEM:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT w.id,w.item_key object_key,w.title,w.item_type subtitle,w.status,w.project_id,
      JSON_OBJECT('priority',w.priority,'stageKey',w.stage_key) metadata
      FROM project_work_items w JOIN projects p ON p.id=w.project_id
      WHERE p.workspace_id=? AND (w.item_key LIKE ? OR w.title LIKE ?)
      ORDER BY w.created_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  DECISION:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT d.id,d.decision_key object_key,d.title,'PROJECT_DECISION' subtitle,d.status,d.project_id,
      JSON_OBJECT('reversible',d.reversible,'effectiveVersion',d.effective_version) metadata
      FROM project_decisions d JOIN projects p ON p.id=d.project_id
      WHERE p.workspace_id=? AND (d.decision_key LIKE ? OR d.title LIKE ?)
      ORDER BY d.created_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  ASSET:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT a.id,a.asset_key object_key,a.display_name title,a.asset_type subtitle,a.status,
      a.owner_project_id project_id,JSON_OBJECT('libraryId',a.library_id,'immutable',a.immutable) metadata
      FROM aigc_assets a WHERE a.workspace_id=? AND (a.asset_key LIKE ? OR a.display_name LIKE ?)
      ORDER BY a.created_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  ENVIRONMENT:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,environment_key object_key,display_name title,environment_type subtitle,status,NULL project_id,
      JSON_OBJECT('healthStatus',health_status,'releaseChannel',release_channel) metadata
      FROM platform_environments WHERE workspace_id=? AND (environment_key LIKE ? OR display_name LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  CONNECTION:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,connection_key object_key,display_name title,connection_type subtitle,status,NULL project_id,
      JSON_OBJECT('healthStatus',health_status,'providerKey',provider_key,'adapterKey',adapter_key) metadata
      FROM platform_connections WHERE workspace_id=? AND (connection_key LIKE ? OR display_name LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  RELEASE:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,candidate_key object_key,version_label title,release_type subtitle,status,NULL project_id,
      JSON_OBJECT('exactRuntimeSha',exact_runtime_sha,'sourceEnvironmentId',source_environment_id) metadata
      FROM platform_release_candidates WHERE workspace_id=? AND (candidate_key LIKE ? OR version_label LIKE ?)
      ORDER BY frozen_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  INCIDENT:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,incident_key object_key,title,severity subtitle,status,NULL project_id,
      JSON_OBJECT('primaryAlertId',primary_alert_id,'ownerIdentityId',owner_identity_id) metadata
      FROM platform_incidents WHERE workspace_id=? AND (incident_key LIKE ? OR title LIKE ?)
      ORDER BY opened_at DESC LIMIT ?`,[workspaceId,like,like,limit]),
  BACKUP:async(db,workspaceId,like,limit)=>
    rows(db,`SELECT id,backup_key object_key,backup_key title,backup_type subtitle,verification_status status,
      NULL project_id,JSON_OBJECT('environmentId',environment_id,'exactRuntimeSha',exact_runtime_sha,
      'manifestSha256',manifest_sha256,'storageRef',storage_ref) metadata
      FROM platform_backup_snapshots WHERE workspace_id=? AND backup_key LIKE ?
      ORDER BY captured_at DESC LIMIT ?`,[workspaceId,like,limit])
};

export const globalWorkspaceSearch=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const q=String(input.q||'').trim();
  if(q.length<2)throw errorOf('Search query must contain at least 2 characters','M30_SEARCH_QUERY_TOO_SHORT');
  const requested=Array.isArray(input.types)&&input.types.length
    ? [...new Set(input.types.map(upper))]
    : [...SEARCH_TYPES];
  const invalid=requested.filter(x=>!SEARCH_TYPES.has(x));
  if(invalid.length)throw errorOf('Unsupported search type','M30_SEARCH_TYPE_INVALID',400,{types:invalid});
  const limit=Math.min(100,Math.max(1,Number(input.limit||30)));
  const perType=Math.max(3,Math.min(20,Math.ceil(limit/Math.max(1,requested.length))+2));
  const like='%'+q+'%';
  const groups=await Promise.all(requested.map(async type=>({
    type,items:(await searchQueries[type](db,workspaceId,like,perType)).map(row=>normalizeSearch(type,row))
  })));
  const flattened=groups.flatMap(g=>g.items).slice(0,limit);
  return {
    workspaceId,query:q,types:requested,total:flattened.length,
    byType:Object.fromEntries(groups.map(g=>[g.type,g.items.length])),
    results:flattened
  };
};

const auditRows=async(db,workspaceId,limit,since)=>{
  const timeClause=since?' AND %FIELD%>=?':'';
  const params=()=>since?[workspaceId,since,limit]:[workspaceId,limit];
  const execute=(sql,field)=>rows(db,sql.replace('%FIELD%',field),params());
  const sources=await Promise.all([
    execute(`SELECT 'AUTHORIZATION' source_type,id,decision event_type,permission_key object_type,
      path object_id,reason_code summary,created_at occurred_at,
      JSON_OBJECT('method',method,'identityId',identity_id,'credentialId',credential_id) evidence
      FROM authorization_decisions WHERE workspace_id=?${timeClause.replace('%FIELD%','created_at')}
      ORDER BY created_at DESC LIMIT ?`,'created_at'),
    execute(`SELECT 'ACTIVITY' source_type,id,event_type,object_type,object_id,NULL summary,created_at occurred_at,
      payload_json evidence FROM activity_events WHERE workspace_id=?${timeClause.replace('%FIELD%','created_at')}
      ORDER BY created_at DESC LIMIT ?`,'created_at'),
    execute(`SELECT 'APPROVAL' source_type,a.id,CONCAT('APPROVAL_',a.status) event_type,a.target_type object_type,
      a.target_id object_id,a.requested_action summary,a.created_at occurred_at,
      JSON_OBJECT('riskLevel',a.risk_level,'requestKey',a.request_key,'evidence',a.evidence_json) evidence
      FROM approval_requests a WHERE a.workspace_id=?${timeClause.replace('%FIELD%','a.created_at')}
      ORDER BY a.created_at DESC LIMIT ?`,'a.created_at'),
    execute(`SELECT 'RUNTIME_AUDIT' source_type,CAST(l.id AS CHAR) id,l.event_type,l.object_type,l.object_id,
      l.actor_key summary,l.created_at occurred_at,l.event_json evidence
      FROM audit_logs l JOIN projects p ON p.id=l.project_id
      WHERE p.workspace_id=?${timeClause.replace('%FIELD%','l.created_at')}
      ORDER BY l.created_at DESC LIMIT ?`,'l.created_at'),
    execute(`SELECT 'GATE_RESULT' source_type,g.id,CONCAT('GATE_',g.status) event_type,'GATE' object_type,
      g.gate_key object_id,g.blocking_reason summary,g.decided_at occurred_at,
      JSON_OBJECT('stageKey',g.stage_key,'criteria',g.criteria_json,'evidence',g.evidence_json,'decidedBy',g.decided_by) evidence
      FROM gate_results g JOIN runs r ON r.id=g.run_id JOIN projects p ON p.id=r.project_id
      WHERE p.workspace_id=?${timeClause.replace('%FIELD%','g.decided_at')}
      ORDER BY g.decided_at DESC LIMIT ?`,'g.decided_at'),
    execute(`SELECT 'QA_EVIDENCE' source_type,q.id,CONCAT('QA_',q.status) event_type,'QA_CASE' object_type,
      q.qa_case_key object_id,q.issue_summary summary,q.verified_at occurred_at,
      JSON_OBJECT('evidenceType',q.evidence_type,'evidenceUri',q.evidence_uri,'evidence',q.evidence_json,
      'verifiedBy',q.verified_by) evidence
      FROM qa_evidence q JOIN runs r ON r.id=q.run_id JOIN projects p ON p.id=r.project_id
      WHERE p.workspace_id=?${timeClause.replace('%FIELD%','q.verified_at')}
      ORDER BY q.verified_at DESC LIMIT ?`,'q.verified_at'),
    execute(`SELECT 'PLATFORM_HEALTH' source_type,id,CONCAT('HEALTH_',health_status) event_type,subject_type object_type,
      subject_id object_id,reason_code summary,observed_at occurred_at,evidence_json evidence
      FROM platform_health_events WHERE workspace_id=?${timeClause.replace('%FIELD%','observed_at')}
      ORDER BY observed_at DESC LIMIT ?`,'observed_at'),
    execute(`SELECT 'INCIDENT' source_type,id,CONCAT('INCIDENT_',status) event_type,'INCIDENT' object_type,
      incident_key object_id,title summary,opened_at occurred_at,
      JSON_OBJECT('severity',severity,'rootCause',root_cause_json,'resolution',resolution_json,'evidence',evidence_json) evidence
      FROM platform_incidents WHERE workspace_id=?${timeClause.replace('%FIELD%','opened_at')}
      ORDER BY opened_at DESC LIMIT ?`,'opened_at'),
    execute(`SELECT 'RESTORE' source_type,id,CONCAT('RESTORE_',status) event_type,'RESTORE_REHEARSAL' object_type,
      rehearsal_key object_id,execution_mode summary,completed_at occurred_at,
      JSON_OBJECT('backupSnapshotId',backup_snapshot_id,'receipt',restore_receipt_json,'verification',verification_json,
      'evidence',evidence_json) evidence
      FROM platform_restore_rehearsals WHERE workspace_id=?${timeClause.replace('%FIELD%','completed_at')}
      ORDER BY completed_at DESC LIMIT ?`,'completed_at')
  ]);
  const m30Tables=[
    ['M30_OPS_GATE','m30_ops_foundation_gate_evaluations'],
    ['M30_RELEASE_GATE','m30_release_rollback_gate_evaluations'],
    ['M30_INCIDENT_GATE','m30_alert_incident_gate_evaluations'],
    ['M30_BACKUP_GATE','m30_retention_backup_gate_evaluations']
  ];
  for(const [sourceType,table] of m30Tables){
    const p=since?[workspaceId,since,limit]:[workspaceId,limit];
    const clause=since?' AND as_of>=?':'';
    sources.push(await rows(db,`SELECT '${sourceType}' source_type,id,CONCAT('GATE_',status) event_type,
      'M30_GATE' object_type,gate_key object_id,NULL summary,as_of occurred_at,
      JSON_OBJECT('reasonCodes',reason_codes_json,'evidence',evidence_snapshot_json) evidence
      FROM ${table} WHERE workspace_id=?${clause} ORDER BY as_of DESC LIMIT ?`,p));
  }
  return sources.flat();
};

export const getWorkspaceAuditEvidence=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const limit=Math.min(300,Math.max(10,Number(input.limit||100)));
  const since=input.since?asDate(input.since):null;
  const all=await auditRows(db,workspaceId,Math.min(50,limit),since);
  const normalized=all.map(x=>({
    sourceType:x.source_type,id:String(x.id),eventType:x.event_type,objectType:x.object_type||null,
    objectId:x.object_id||null,summary:x.summary||null,occurredAt:x.occurred_at,
    evidence:parseJson(x.evidence)
  })).sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt)).slice(0,limit);
  const bySource={};
  for(const e of normalized)bySource[e.sourceType]=(bySource[e.sourceType]||0)+1;
  return {
    workspaceId,since,total:normalized.length,sourceTypeCount:Object.keys(bySource).length,bySource,
    timeline:normalized
  };
};

export const evaluateM30SearchAuditGate=async(workspaceId,input={})=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();
  const upstream=await one(db,`SELECT status FROM m30_retention_backup_gate_evaluations
    WHERE workspace_id=? AND gate_key='G-M30-RETENTION-BACKUP'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]);
  const probe=String(input.searchProbe||'M30').trim();
  const search=await globalWorkspaceSearch(workspaceId,{q:probe,limit:100});
  const audit=await getWorkspaceAuditEvidence(workspaceId,{limit:200});
  const resultTypes=[...new Set(search.results.map(x=>x.type))];
  const reasons=[];
  if(upstream?.status!=='PASS')reasons.push('M30_RETENTION_BACKUP_PASS_REQUIRED');
  if(search.total<2||resultTypes.length<2)reasons.push('M30_GLOBAL_SEARCH_CROSS_OBJECT_REQUIRED');
  if(audit.total<3||audit.sourceTypeCount<3)reasons.push('M30_AUDIT_MULTI_SOURCE_EVIDENCE_REQUIRED');
  const evidence={
    upstreamRetentionBackupStatus:upstream?.status||null,searchProbe:probe,
    searchResultCount:search.total,searchResultTypes:resultTypes,
    auditEventCount:audit.total,auditSourceTypeCount:audit.sourceTypeCount,
    auditSourceTypes:Object.keys(audit.bySource),workspaceScoped:true,readOnlyAggregate:true
  };
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_search_audit_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30SearchAuditState=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const gates=await rows(db,`SELECT * FROM m30_search_audit_gate_evaluations
    WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId]);
  return {
    frontend:{language:'zh-CN',title:'全局搜索 / 审计证据',
      policy:'全局搜索与审计视图只读复用现有事实源，并严格受 Workspace 权限边界约束。'},
    search:input.q?await globalWorkspaceSearch(workspaceId,input):null,
    audit:await getWorkspaceAuditEvidence(workspaceId,{limit:input.auditLimit||100,since:input.since}),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,
      reasonCodes:parseJson(gates[0].reason_codes_json),evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),
      asOf:gates[0].as_of}:null
  };
};
