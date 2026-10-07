import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M30-SEARCH-AUDIT';
const REQUIRED_SEARCH_TYPES=['PROJECT','MILESTONE','WORK_ITEM','CAPABILITY','ENVIRONMENT','CONNECTION','INCIDENT','RELEASE_CANDIDATE','BACKUP'];
const REQUIRED_AUDIT_CATEGORIES=['AUTHORIZATION','APPROVAL','GATE','HEALTH','INCIDENT','RELEASE','BACKUP'];

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const hashOf=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
const clean=v=>v==null?'':String(v).trim();
const searchText=(...parts)=>parts.flat().filter(v=>v!=null&&v!=='').map(v=>
  typeof v==='object'?JSON.stringify(v):String(v)
).join(' | ');

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const row=await one(db,'SELECT id,tenant_id,workspace_key,name,status FROM workspaces WHERE id=?',[workspaceId]);
  if(!row)throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return row;
};
export const resolveM30SearchAuditWorkspaceScope=async workspaceId=>{
  const w=await loadWorkspace(workspaceId);return {tenantId:w.tenant_id,workspaceId:w.id};
};

const insertSearch=async(conn,w,doc)=>{
  await conn.execute(`INSERT INTO platform_search_documents
    (id,tenant_id,workspace_id,project_id,object_type,object_id,object_key,title,subtitle,
     search_text,status,metadata_json,source_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),w.tenant_id,w.id,doc.projectId||null,doc.objectType,String(doc.objectId),
     doc.objectKey||null,doc.title,doc.subtitle||null,doc.searchText||'',doc.status||null,
     asJson(doc.metadata||{}),doc.sourceUpdatedAt||null]);
};

export const rebuildWorkspaceGlobalSearch=async workspaceId=>{
  const pool=getRuntimePool(),w=await loadWorkspace(workspaceId,pool),conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute('DELETE FROM platform_search_documents WHERE workspace_id=?',[workspaceId]);

    const projects=await list(conn,`SELECT id,project_key,name,project_type,status,updated_at
      FROM projects WHERE workspace_id=? ORDER BY created_at,id`,[workspaceId]);
    for(const x of projects)await insertSearch(conn,w,{
      projectId:x.id,objectType:'PROJECT',objectId:x.id,objectKey:x.project_key,title:x.name,
      subtitle:x.project_type,searchText:searchText(x.project_key,x.name,x.project_type,x.status),
      status:x.status,metadata:{projectType:x.project_type},sourceUpdatedAt:x.updated_at
    });

    const milestones=await list(conn,`SELECT m.*,p.project_key,p.name project_name
      FROM project_milestones m JOIN projects p ON p.id=m.project_id
      WHERE p.workspace_id=? ORDER BY m.sequence_no,m.id`,[workspaceId]);
    for(const x of milestones)await insertSearch(conn,w,{
      projectId:x.project_id,objectType:'MILESTONE',objectId:x.id,objectKey:x.milestone_key,
      title:x.display_name,subtitle:x.project_name,
      searchText:searchText(x.milestone_key,x.display_name,x.objective,x.project_name,x.management_status,x.health),
      status:x.management_status,metadata:{projectKey:x.project_key,health:x.health,progressPercent:x.progress_percent},
      sourceUpdatedAt:x.updated_at
    });

    const workItems=await list(conn,`SELECT wi.*,p.project_key,p.name project_name
      FROM project_work_items wi JOIN projects p ON p.id=wi.project_id
      WHERE p.workspace_id=? ORDER BY wi.created_at,wi.id`,[workspaceId]);
    for(const x of workItems)await insertSearch(conn,w,{
      projectId:x.project_id,objectType:'WORK_ITEM',objectId:x.id,objectKey:x.item_key,title:x.title,
      subtitle:x.project_name,searchText:searchText(x.item_key,x.title,x.item_type,x.stage_key,x.priority,x.status,x.project_name),
      status:x.status,metadata:{projectKey:x.project_key,itemType:x.item_type,priority:x.priority,stageKey:x.stage_key},
      sourceUpdatedAt:x.updated_at
    });

    const knowledge=await list(conn,`SELECT k.*,p.id project_id,p.project_key,p.name project_name
      FROM knowledge_contexts k JOIN runs r ON r.id=k.run_id JOIN projects p ON p.id=r.project_id
      WHERE p.workspace_id=? ORDER BY k.retrieved_at,k.id`,[workspaceId]);
    for(const x of knowledge)await insertSearch(conn,w,{
      projectId:x.project_id,objectType:'KNOWLEDGE',objectId:x.id,
      objectKey:[x.source_provider,x.source_file_id,x.source_version||''].join(':'),
      title:x.source_name||x.source_path||x.source_file_id,subtitle:x.project_name,
      searchText:searchText(x.source_provider,x.source_name,x.source_path,x.source_file_id,x.source_version,
        x.context_role,x.retrieval_query,x.project_name),
      status:x.source_status||'CURRENT',
      metadata:{projectKey:x.project_key,provider:x.source_provider,contextRole:x.context_role,
        contentSha256:x.content_sha256},sourceUpdatedAt:x.source_modified_at||x.retrieved_at
    });

    const capabilities=await list(conn,`SELECT capability_key,capability_type,display_name,version,status,
      routable,adapter_key,metadata_json,updated_at FROM capability_registry
      WHERE status IN ('ACTIVE','DISABLED') ORDER BY capability_type,capability_key`);
    for(const x of capabilities)await insertSearch(conn,w,{
      objectType:'CAPABILITY',objectId:x.capability_key,objectKey:x.capability_key,title:x.display_name,
      subtitle:x.capability_type,searchText:searchText(x.capability_key,x.display_name,x.capability_type,x.version,x.adapter_key),
      status:x.status,metadata:{capabilityType:x.capability_type,version:x.version,routable:Boolean(x.routable),
        adapterKey:x.adapter_key,source:parseJson(x.metadata_json)},sourceUpdatedAt:x.updated_at
    });

    const environments=await list(conn,'SELECT * FROM platform_environments WHERE workspace_id=? ORDER BY environment_type,environment_key',[workspaceId]);
    for(const x of environments)await insertSearch(conn,w,{
      objectType:'ENVIRONMENT',objectId:x.id,objectKey:x.environment_key,title:x.display_name,
      subtitle:x.environment_type,searchText:searchText(x.environment_key,x.display_name,x.environment_type,
        x.release_channel,x.health_status,x.provider_key,parseJson(x.external_ref_json)),
      status:x.status,metadata:{environmentType:x.environment_type,healthStatus:x.health_status,
        releaseChannel:x.release_channel,providerKey:x.provider_key},sourceUpdatedAt:x.updated_at
    });

    const connections=await list(conn,'SELECT * FROM platform_connections WHERE workspace_id=? ORDER BY connection_type,connection_key',[workspaceId]);
    for(const x of connections)await insertSearch(conn,w,{
      objectType:'CONNECTION',objectId:x.id,objectKey:x.connection_key,title:x.display_name,
      subtitle:x.connection_type,searchText:searchText(x.connection_key,x.display_name,x.connection_type,
        x.provider_key,x.adapter_key,x.health_status,parseJson(x.capability_scope_json)),
      status:x.status,metadata:{connectionType:x.connection_type,healthStatus:x.health_status,
        providerKey:x.provider_key,adapterKey:x.adapter_key},sourceUpdatedAt:x.updated_at
    });

    const incidents=await list(conn,'SELECT * FROM platform_incidents WHERE workspace_id=? ORDER BY opened_at DESC,id',[workspaceId]);
    for(const x of incidents)await insertSearch(conn,w,{
      objectType:'INCIDENT',objectId:x.id,objectKey:x.incident_key,title:x.title,subtitle:x.severity,
      searchText:searchText(x.incident_key,x.title,x.severity,x.status,parseJson(x.root_cause_json),parseJson(x.resolution_json)),
      status:x.status,metadata:{severity:x.severity,primaryAlertId:x.primary_alert_id},sourceUpdatedAt:x.updated_at
    });

    const candidates=await list(conn,'SELECT * FROM platform_release_candidates WHERE workspace_id=? ORDER BY frozen_at DESC,id',[workspaceId]);
    for(const x of candidates)await insertSearch(conn,w,{
      objectType:'RELEASE_CANDIDATE',objectId:x.id,objectKey:x.candidate_key,title:x.version_label,
      subtitle:x.release_type,searchText:searchText(x.candidate_key,x.version_label,x.release_type,x.exact_runtime_sha,
        x.migration_fingerprint,x.status),
      status:x.status,metadata:{exactRuntimeSha:x.exact_runtime_sha,artifactSha256:x.artifact_sha256,
        migrationFingerprint:x.migration_fingerprint},sourceUpdatedAt:x.created_at
    });

    const backups=await list(conn,'SELECT * FROM platform_backup_snapshots WHERE workspace_id=? ORDER BY captured_at DESC,id',[workspaceId]);
    for(const x of backups)await insertSearch(conn,w,{
      objectType:'BACKUP',objectId:x.id,objectKey:x.backup_key,title:x.backup_key,subtitle:x.backup_type,
      searchText:searchText(x.backup_key,x.backup_type,x.exact_runtime_sha,x.manifest_sha256,x.storage_ref,
        x.verification_status),
      status:x.verification_status,metadata:{exactRuntimeSha:x.exact_runtime_sha,manifestSha256:x.manifest_sha256,
        storageRef:x.storage_ref,isSynthetic:Boolean(x.is_synthetic)},sourceUpdatedAt:x.captured_at
    });

    await conn.commit();
    const rows=await list(pool,`SELECT object_type,COUNT(*) count FROM platform_search_documents
      WHERE workspace_id=? GROUP BY object_type ORDER BY object_type`,[workspaceId]);
    return {workspaceId,indexedCount:rows.reduce((n,x)=>n+Number(x.count),0),
      coverage:Object.fromEntries(rows.map(x=>[x.object_type,Number(x.count)]))};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
};

export const searchWorkspaceGlobal=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const q=clean(input.q);
  if(q.length<2)throw errorOf('Global search query must contain at least 2 characters','M30_SEARCH_QUERY_TOO_SHORT');
  const limit=Math.min(100,Math.max(1,Number(input.limit||30)));
  const types=Array.isArray(input.types)?input.types.map(x=>String(x).toUpperCase()).filter(Boolean):[];
  const like='%'+q+'%';
  const params=[q,q+'%',like,like,like,like,workspaceId];
  let typeSql='';
  if(types.length){typeSql=' AND object_type IN ('+types.map(()=>'?').join(',')+')';params.push(...types);}
  params.push(limit);
  const rows=await list(db,`SELECT *,
    CASE WHEN title=? THEN 100 WHEN title LIKE ? THEN 80 WHEN title LIKE ? THEN 60
         WHEN object_key LIKE ? THEN 50 WHEN subtitle LIKE ? THEN 35 WHEN search_text LIKE ? THEN 20 ELSE 0 END relevance
    FROM platform_search_documents
    WHERE workspace_id=? ${typeSql}
      AND (title LIKE ? OR object_key LIKE ? OR subtitle LIKE ? OR search_text LIKE ?)
    ORDER BY relevance DESC,source_updated_at DESC,indexed_at DESC LIMIT ?`,
    [...params.slice(0,7+types.length),like,like,like,like,limit]);
  return {workspaceId,q,count:rows.length,results:rows.map(x=>({
    objectType:x.object_type,objectId:x.object_id,objectKey:x.object_key,title:x.title,subtitle:x.subtitle,
    status:x.status,projectId:x.project_id,relevance:Number(x.relevance),metadata:parseJson(x.metadata_json),
    sourceUpdatedAt:x.source_updated_at,indexedAt:x.indexed_at
  }))};
};

const insertAudit=async(conn,w,event)=>{
  const evidence={sourceRef:{type:event.sourceType,id:String(event.sourceId)},category:event.category,
    eventType:event.eventType,actorRef:event.actorRef||null,objectType:event.objectType||null,
    objectId:event.objectId||null,status:event.status||null,occurredAt:event.occurredAt,
    payload:event.payload||{}};
  await conn.execute(`INSERT INTO platform_audit_evidence_index
    (id,tenant_id,workspace_id,project_id,source_type,source_id,category,event_type,actor_ref,
     object_type,object_id,status,occurred_at,evidence_sha256,evidence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),w.tenant_id,w.id,event.projectId||null,event.sourceType,String(event.sourceId),
     event.category,event.eventType,event.actorRef||null,event.objectType||null,event.objectId?String(event.objectId):null,
     event.status||null,event.occurredAt,hashOf(evidence),asJson(evidence)]);
};

export const rebuildWorkspaceAuditEvidence=async workspaceId=>{
  const pool=getRuntimePool(),w=await loadWorkspace(workspaceId,pool),conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute('DELETE FROM platform_audit_evidence_index WHERE workspace_id=?',[workspaceId]);

    const authz=await list(conn,'SELECT * FROM authorization_decisions WHERE workspace_id=? ORDER BY created_at,id',[workspaceId]);
    for(const x of authz)await insertAudit(conn,w,{sourceType:'AUTHORIZATION_DECISION',sourceId:x.id,category:'AUTHORIZATION',
      eventType:'AUTHORIZATION_'+x.decision,actorRef:x.identity_id||x.credential_id,objectType:'API_PATH',objectId:x.path,
      status:x.decision,occurredAt:x.created_at,payload:{method:x.method,path:x.path,permissionKey:x.permission_key,reasonCode:x.reason_code}});

    const approvals=await list(conn,'SELECT * FROM approval_requests WHERE workspace_id=? ORDER BY created_at,id',[workspaceId]);
    for(const x of approvals)await insertAudit(conn,w,{projectId:x.project_id,sourceType:'APPROVAL_REQUEST',sourceId:x.id,
      category:'APPROVAL',eventType:x.requested_action,actorRef:x.requested_by_identity_id,
      objectType:x.target_type,objectId:x.target_id,status:x.status,occurredAt:x.created_at,
      payload:{requestKey:x.request_key,riskLevel:x.risk_level,requiredRole:x.required_role,
        effectiveObjectType:x.effective_object_type,effectiveObjectId:x.effective_object_id,
        effectiveVersion:x.effective_version,context:parseJson(x.context_json),evidence:parseJson(x.evidence_json)}});

    const decisions=await list(conn,`SELECT d.*,a.workspace_id,a.project_id,a.target_type,a.target_id,a.requested_action
      FROM approval_decisions d JOIN approval_requests a ON a.id=d.approval_request_id
      WHERE a.workspace_id=? ORDER BY d.created_at,d.id`,[workspaceId]);
    for(const x of decisions)await insertAudit(conn,w,{projectId:x.project_id,sourceType:'APPROVAL_DECISION',sourceId:x.id,
      category:'APPROVAL',eventType:'DECISION_'+x.decision,actorRef:x.decided_by_identity_id,
      objectType:x.target_type,objectId:x.target_id,status:x.decision,occurredAt:x.created_at,
      payload:{approvalRequestId:x.approval_request_id,requestedAction:x.requested_action,reason:x.reason,
        evidence:parseJson(x.evidence_json)}});

    const runtimeAudit=await list(conn,`SELECT a.* FROM audit_logs a JOIN projects p ON p.id=a.project_id
      WHERE p.workspace_id=? ORDER BY a.created_at,a.id`,[workspaceId]);
    for(const x of runtimeAudit)await insertAudit(conn,w,{projectId:x.project_id,sourceType:'RUNTIME_AUDIT_LOG',
      sourceId:String(x.id),category:'RUNTIME_AUDIT',eventType:x.event_type,actorRef:x.actor_key,
      objectType:x.object_type,objectId:x.object_id,status:null,occurredAt:x.created_at,
      payload:{runId:x.run_id,taskId:x.task_id,actorType:x.actor_type,event:parseJson(x.event_json)}});

    const gates=await list(conn,`SELECT g.*,r.project_id FROM gate_results g JOIN runs r ON r.id=g.run_id
      JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? ORDER BY g.decided_at,g.id`,[workspaceId]);
    for(const x of gates)await insertAudit(conn,w,{projectId:x.project_id,sourceType:'GATE_RESULT',sourceId:x.id,
      category:'GATE',eventType:x.gate_key,actorRef:x.decided_by,objectType:'RUN',objectId:x.run_id,
      status:x.status,occurredAt:x.decided_at,payload:{stageKey:x.stage_key,taskId:x.task_id,
        criteria:parseJson(x.criteria_json),evidence:parseJson(x.evidence_json),blockingReason:x.blocking_reason}});

    const qa=await list(conn,`SELECT q.*,r.project_id FROM qa_evidence q JOIN runs r ON r.id=q.run_id
      JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? ORDER BY q.verified_at,q.id`,[workspaceId]);
    for(const x of qa)await insertAudit(conn,w,{projectId:x.project_id,sourceType:'QA_EVIDENCE',sourceId:x.id,
      category:'QA',eventType:x.qa_case_key,actorRef:x.verified_by,objectType:'RUN',objectId:x.run_id,
      status:x.status,occurredAt:x.verified_at,payload:{taskId:x.task_id,gateResultId:x.gate_result_id,
        evidenceType:x.evidence_type,evidenceUri:x.evidence_uri,evidence:parseJson(x.evidence_json),
        issueSeverity:x.issue_severity,issueSummary:x.issue_summary}});

    const health=await list(conn,'SELECT * FROM platform_health_events WHERE workspace_id=? ORDER BY observed_at,id',[workspaceId]);
    for(const x of health)await insertAudit(conn,w,{sourceType:'PLATFORM_HEALTH_EVENT',sourceId:x.id,category:'HEALTH',
      eventType:x.subject_type+'_HEALTH',actorRef:x.source,objectType:x.subject_type,objectId:x.subject_id,
      status:x.health_status,occurredAt:x.observed_at,payload:{previousStatus:x.previous_status,
        reasonCode:x.reason_code,latencyMs:x.latency_ms,evidence:parseJson(x.evidence_json)}});

    const incidentEvents=await list(conn,`SELECT e.*,i.workspace_id,i.incident_key,i.primary_alert_id
      FROM platform_incident_events e JOIN platform_incidents i ON i.id=e.incident_id
      WHERE i.workspace_id=? ORDER BY e.occurred_at,e.id`,[workspaceId]);
    for(const x of incidentEvents)await insertAudit(conn,w,{sourceType:'INCIDENT_EVENT',sourceId:x.id,category:'INCIDENT',
      eventType:x.event_type,actorRef:x.actor_identity_id,objectType:'INCIDENT',objectId:x.incident_id,
      status:x.to_status||x.from_status,occurredAt:x.occurred_at,payload:{incidentKey:x.incident_key,
        primaryAlertId:x.primary_alert_id,fromStatus:x.from_status,toStatus:x.to_status,
        event:parseJson(x.payload_json),evidence:parseJson(x.evidence_json)}});

    const promotions=await list(conn,'SELECT * FROM platform_release_promotions WHERE workspace_id=? ORDER BY requested_at,id',[workspaceId]);
    for(const x of promotions)await insertAudit(conn,w,{sourceType:'RELEASE_PROMOTION',sourceId:x.id,category:'RELEASE',
      eventType:'RELEASE_PROMOTION',actorRef:x.promoted_by_identity_id||x.requested_by_identity_id,
      objectType:'RELEASE_CANDIDATE',objectId:x.candidate_id,status:x.status,
      occurredAt:x.promoted_at||x.requested_at,payload:{sourceEnvironmentId:x.source_environment_id,
        targetEnvironmentId:x.target_environment_id,riskLevel:x.risk_level,approvalRequestId:x.approval_request_id,
        rollbackRuntimeSha:x.rollback_runtime_sha,executionMode:x.execution_mode,
        executionReceipt:parseJson(x.execution_receipt_json)}});

    const rollbacks=await list(conn,'SELECT * FROM platform_rollback_requests WHERE workspace_id=? ORDER BY requested_at,id',[workspaceId]);
    for(const x of rollbacks)await insertAudit(conn,w,{sourceType:'RELEASE_ROLLBACK',sourceId:x.id,category:'RELEASE',
      eventType:'RELEASE_ROLLBACK',actorRef:x.completed_by_identity_id||x.requested_by_identity_id,
      objectType:'RELEASE_PROMOTION',objectId:x.promotion_id,status:x.status,
      occurredAt:x.completed_at||x.requested_at,payload:{rollbackRuntimeSha:x.rollback_runtime_sha,
        riskLevel:x.risk_level,approvalRequestId:x.approval_request_id,executionMode:x.execution_mode,
        executionReceipt:parseJson(x.execution_receipt_json)}});

    const backups=await list(conn,'SELECT * FROM platform_backup_snapshots WHERE workspace_id=? ORDER BY captured_at,id',[workspaceId]);
    for(const x of backups)await insertAudit(conn,w,{sourceType:'BACKUP_SNAPSHOT',sourceId:x.id,category:'BACKUP',
      eventType:'BACKUP_CAPTURED',actorRef:x.created_by_identity_id,objectType:'ENVIRONMENT',objectId:x.environment_id,
      status:x.verification_status,occurredAt:x.captured_at,payload:{backupKey:x.backup_key,backupType:x.backup_type,
        exactRuntimeSha:x.exact_runtime_sha,manifestSha256:x.manifest_sha256,storageRef:x.storage_ref,
        verification:parseJson(x.verification_json),isSynthetic:Boolean(x.is_synthetic)}});

    const restores=await list(conn,'SELECT * FROM platform_restore_rehearsals WHERE workspace_id=? ORDER BY completed_at,id',[workspaceId]);
    for(const x of restores)await insertAudit(conn,w,{sourceType:'RESTORE_REHEARSAL',sourceId:x.id,category:'RESTORE',
      eventType:'RESTORE_REHEARSAL',actorRef:x.executed_by_identity_id,objectType:'ENVIRONMENT',objectId:x.target_environment_id,
      status:x.status,occurredAt:x.completed_at,payload:{backupSnapshotId:x.backup_snapshot_id,
        executionMode:x.execution_mode,isSynthetic:Boolean(x.is_synthetic),
        restoreReceipt:parseJson(x.restore_receipt_json),verification:parseJson(x.verification_json)}});

    const gateTables=[
      ['M30_OPS_GATE','m30_ops_foundation_gate_evaluations','G-M30-OPS-FOUNDATION'],
      ['M30_RELEASE_GATE','m30_release_rollback_gate_evaluations','G-M30-RELEASE-ROLLBACK'],
      ['M30_ALERT_GATE','m30_alert_incident_gate_evaluations','G-M30-ALERT-INCIDENT'],
      ['M30_BACKUP_GATE','m30_retention_backup_gate_evaluations','G-M30-RETENTION-BACKUP']
    ];
    for(const [sourceType,table,gateKey] of gateTables){
      const rows=await list(conn,`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY as_of,id`,[workspaceId]);
      for(const x of rows)await insertAudit(conn,w,{sourceType,sourceId:x.id,category:'GATE',eventType:gateKey,
        actorRef:'SYSTEM',objectType:'WORKSPACE',objectId:workspaceId,status:x.status,occurredAt:x.as_of,
        payload:{reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json)}});
    }

    await conn.commit();
    const rows=await list(pool,`SELECT category,COUNT(*) count FROM platform_audit_evidence_index
      WHERE workspace_id=? GROUP BY category ORDER BY category`,[workspaceId]);
    return {workspaceId,indexedCount:rows.reduce((n,x)=>n+Number(x.count),0),
      coverage:Object.fromEntries(rows.map(x=>[x.category,Number(x.count)]))};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
};

export const getWorkspaceAuditEvidence=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const limit=Math.min(200,Math.max(1,Number(input.limit||50)));
  const clauses=['workspace_id=?'],params=[workspaceId];
  if(input.category){clauses.push('category=?');params.push(String(input.category).toUpperCase());}
  if(input.status){clauses.push('status=?');params.push(String(input.status).toUpperCase());}
  if(input.projectId){clauses.push('project_id=?');params.push(input.projectId);}
  params.push(limit);
  const rows=await list(db,`SELECT * FROM platform_audit_evidence_index
    WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC,indexed_at DESC LIMIT ?`,params);
  return {workspaceId,count:rows.length,items:rows.map(x=>({
    sourceType:x.source_type,sourceId:x.source_id,category:x.category,eventType:x.event_type,
    actorRef:x.actor_ref,objectType:x.object_type,objectId:x.object_id,status:x.status,
    projectId:x.project_id,occurredAt:x.occurred_at,evidenceSha256:x.evidence_sha256,
    evidence:parseJson(x.evidence_json),indexedAt:x.indexed_at
  }))};
};

export const rebuildWorkspaceSearchAudit=async workspaceId=>{
  const search=await rebuildWorkspaceGlobalSearch(workspaceId);
  const audit=await rebuildWorkspaceAuditEvidence(workspaceId);
  return {workspaceId,search,audit};
};

export const evaluateM30SearchAuditGate=async(workspaceId,input={})=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();
  const upstream=await one(db,`SELECT status FROM m30_retention_backup_gate_evaluations
    WHERE workspace_id=? AND gate_key='G-M30-RETENTION-BACKUP' ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]);
  const searchRows=await list(db,`SELECT object_type,COUNT(*) count FROM platform_search_documents
    WHERE workspace_id=? GROUP BY object_type`,[workspaceId]);
  const auditRows=await list(db,`SELECT category,COUNT(*) count FROM platform_audit_evidence_index
    WHERE workspace_id=? GROUP BY category`,[workspaceId]);
  const searchCoverage=Object.fromEntries(searchRows.map(x=>[x.object_type,Number(x.count)]));
  const auditCoverage=Object.fromEntries(auditRows.map(x=>[x.category,Number(x.count)]));
  const missingSearch=REQUIRED_SEARCH_TYPES.filter(x=>!searchCoverage[x]);
  const missingAudit=REQUIRED_AUDIT_CATEGORIES.filter(x=>!auditCoverage[x]);
  const badHash=await count(db,`SELECT COUNT(*) count FROM platform_audit_evidence_index
    WHERE workspace_id=? AND (CHAR_LENGTH(evidence_sha256)<>64 OR evidence_sha256 REGEXP '[^0-9a-f]')`,[workspaceId]);
  const reasons=[];
  if(upstream?.status!=='PASS')reasons.push('M30_RETENTION_BACKUP_PASS_REQUIRED');
  if(missingSearch.length)reasons.push('M30_GLOBAL_SEARCH_COVERAGE_REQUIRED');
  if(missingAudit.length)reasons.push('M30_AUDIT_EVIDENCE_COVERAGE_REQUIRED');
  if(badHash>0)reasons.push('M30_AUDIT_EVIDENCE_HASH_INVALID');
  const evidence={upstreamRetentionBackupStatus:upstream?.status||null,searchCoverage,auditCoverage,
    missingSearchTypes:missingSearch,missingAuditCategories:missingAudit,badEvidenceHashCount:badHash,
    sourceOfTruthPolicy:'INDEX_REFERENCES_SOURCE_FACTS',workspaceScoped:true};
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_search_audit_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30SearchAuditState=async workspaceId=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const [searchCoverage,auditCoverage,gates]=await Promise.all([
    list(db,`SELECT object_type,COUNT(*) count FROM platform_search_documents
      WHERE workspace_id=? GROUP BY object_type ORDER BY object_type`,[workspaceId]),
    list(db,`SELECT category,COUNT(*) count FROM platform_audit_evidence_index
      WHERE workspace_id=? GROUP BY category ORDER BY category`,[workspaceId]),
    list(db,`SELECT * FROM m30_search_audit_gate_evaluations
      WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId])
  ]);
  return {
    frontend:{language:'zh-CN',searchTitle:'全局搜索',auditTitle:'审计 / 证据中心',
      policy:'Search/Audit 是 Workspace-scoped 索引与聚合视图；原始 Project/Runtime/Gate/Approval/Health/Release/Backup 表仍是 Source-of-Truth。'},
    searchCoverage:Object.fromEntries(searchCoverage.map(x=>[x.object_type,Number(x.count)])),
    auditCoverage:Object.fromEntries(auditCoverage.map(x=>[x.category,Number(x.count)])),
    latestGate:gates[0]?{id:gates[0].id,status:gates[0].status,
      reasonCodes:parseJson(gates[0].reason_codes_json),evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),
      asOf:gates[0].as_of}:null
  };
};
