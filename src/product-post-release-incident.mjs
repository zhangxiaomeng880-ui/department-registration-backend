import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SHA40=/^[0-9a-f]{40}$/i;
const SHA64=/^[0-9a-f]{64}$/i;
const SEVERITIES=new Set(['SEV1','SEV2','SEV3','SEV4']);
const ACTION_TYPES=new Set(['MITIGATE','ROLLBACK','FIX']);
const CORE_SECTIONS=['health','readiness','smokeCriticalFlow','errorIncident','performance','instrumentation','primaryMetric'];

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{
  if(v==null)return null;
  if(typeof v==='object')return v;
  try{return JSON.parse(v);}catch{return null;}
};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const assertStatusObject=(obj,key,allowed=new Set(['PASS','FAIL']))=>{
  if(!obj||typeof obj!=='object')throw errorOf(key+' is required','POST_RELEASE_SECTION_REQUIRED',409,{section:key});
  const status=upper(obj.status);
  if(!allowed.has(status))throw errorOf(
    key+' has unsupported status','INVALID_POST_RELEASE_SECTION_STATUS',409,{section:key,status}
  );
  if(status==='N_A'&&!nonEmpty(obj.rationale))throw errorOf(
    key+' N_A requires rationale','POST_RELEASE_NA_REASON_REQUIRED',409,{section:key}
  );
  return status;
};
const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_type FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Post-release domain requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const loadRollout=async(id,db)=>{
  const [rows]=await db.execute('SELECT * FROM product_release_rollouts WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Release Rollout not found','RELEASE_ROLLOUT_NOT_FOUND',404);
  return rows[0];
};
const loadIncident=async(id,db)=>{
  const [rows]=await db.execute('SELECT * FROM product_incidents WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Incident not found','INCIDENT_NOT_FOUND',404);
  return rows[0];
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};

export const resolvePostReleaseProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};
export const resolveIncidentScope=async incidentId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT i.id,i.project_id,p.workspace_id FROM product_incidents i
      JOIN projects p ON p.id=i.project_id WHERE i.id=?`,[incidentId]
  );
  if(!rows.length)throw errorOf('Incident not found','INCIDENT_NOT_FOUND',404);
  return {incidentId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveIncidentActionScope=async actionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT a.id,a.project_id,p.workspace_id FROM product_incident_actions a
      JOIN projects p ON p.id=a.project_id WHERE a.id=?`,[actionId]
  );
  if(!rows.length)throw errorOf('Incident Action not found','INCIDENT_ACTION_NOT_FOUND',404);
  return {incidentActionId:actionId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createPostReleaseVerification=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','verificationKey','exactCommitSha','artifactSha256','deploymentId',
    'health','readiness','smokeCriticalFlow','errorIncident','performance','instrumentation',
    'primaryMetric','userFeedback','operationsFeedback','evidence'
  ],'INVALID_POST_RELEASE_VERIFICATION');
  if(!SHA40.test(input.exactCommitSha)||!SHA64.test(input.artifactSha256))throw errorOf(
    'Exact commit SHA and artifact SHA-256 are required','INVALID_RELEASE_ARTIFACT_IDENTITY',409
  );
  const db=getRuntimePool(),rollout=await loadRollout(input.releaseRolloutId,db);
  if(rollout.project_id!==projectId)throw errorOf('Rollout scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409);
  if(!['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))throw errorOf(
    'Post-release verification requires RELEASED/FULLY_ROLLED_OUT rollout','POST_RELEASE_ROLLOUT_NOT_RELEASED',409
  );
  if(input.exactCommitSha.toLowerCase()!==rollout.exact_commit_sha||
     input.artifactSha256.toLowerCase()!==rollout.artifact_sha256||
     input.deploymentId!==rollout.deployment_id)throw errorOf(
    'Post-release verification must bind exact released deployment','POST_RELEASE_RELEASE_IDENTITY_MISMATCH',409
  );

  const statuses={};
  for(const key of CORE_SECTIONS)statuses[key]=assertStatusObject(input[key],key);
  statuses.userFeedback=assertStatusObject(input.userFeedback,'userFeedback',new Set(['PASS','WARN','FAIL','N_A']));
  statuses.operationsFeedback=assertStatusObject(input.operationsFeedback,'operationsFeedback',new Set(['PASS','WARN','FAIL','N_A']));
  const status=CORE_SECTIONS.some(k=>statuses[k]==='FAIL')?'FAIL':'PASS';
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_post_release_verifications
      (id,project_id,release_rollout_id,release_version_id,verification_key,status,
       exact_commit_sha,artifact_sha256,deployment_id,health_json,readiness_json,
       smoke_critical_flow_json,error_incident_json,performance_json,instrumentation_json,
       primary_metric_json,user_feedback_json,operations_feedback_json,evidence_json,
       verified_by_identity_id,verified_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,rollout.id,rollout.release_version_id,input.verificationKey,status,
     input.exactCommitSha.toLowerCase(),input.artifactSha256.toLowerCase(),input.deploymentId,
     asJson(input.health),asJson(input.readiness),asJson(input.smokeCriticalFlow),asJson(input.errorIncident),
     asJson(input.performance),asJson(input.instrumentation),asJson(input.primaryMetric),
     asJson(input.userFeedback),asJson(input.operationsFeedback),asJson(input.evidence),actorId,
     input.verifiedAt?new Date(input.verifiedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'RELEASE_ROLLOUT',sourceId:rollout.id,
    targetType:'POST_RELEASE_VERIFICATION',targetId:id,linkType:'VERIFIED_BY',actorId,evidence:{status}});
  return {id,projectId,releaseRolloutId:rollout.id,releaseVersionId:rollout.release_version_id,
    verificationKey:input.verificationKey,status,incidentRequired:status==='FAIL'};
};

export const createIncident=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','detectedVerificationId','incidentKey','title','severity',
    'signal','affectedScope','ownerIdentityId'
  ],'INVALID_INCIDENT');
  const severity=upper(input.severity);
  if(!SEVERITIES.has(severity))throw errorOf('Unsupported incident severity','INVALID_INCIDENT_SEVERITY',409,{severity});
  const db=getRuntimePool(),rollout=await loadRollout(input.releaseRolloutId,db);
  if(rollout.project_id!==projectId)throw errorOf('Rollout scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409);
  const [verifications]=await db.execute('SELECT * FROM product_post_release_verifications WHERE id=?',[input.detectedVerificationId]);
  if(!verifications.length)throw errorOf('Post-release verification not found','POST_RELEASE_VERIFICATION_NOT_FOUND',404);
  const verification=verifications[0];
  if(verification.project_id!==projectId||verification.release_rollout_id!==rollout.id||verification.status!=='FAIL')
    throw errorOf('Incident must originate from FAIL verification in same rollout','INCIDENT_FAIL_VERIFICATION_REQUIRED',409);
  const [owners]=await db.execute('SELECT id FROM identities WHERE id=?',[input.ownerIdentityId]);
  if(!owners.length)throw errorOf('Incident owner not found','INCIDENT_OWNER_NOT_FOUND',404);

  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_incidents
      (id,project_id,release_rollout_id,release_version_id,detected_verification_id,
       incident_key,title,severity,status,signal_json,affected_scope_json,owner_identity_id,detected_at)
     VALUES (?,?,?,?,?,?,?,?, 'DETECTED',?,?,?,?)`,
    [id,projectId,rollout.id,rollout.release_version_id,verification.id,input.incidentKey,input.title,severity,
     asJson(input.signal),asJson(input.affectedScope),input.ownerIdentityId,
     input.detectedAt?new Date(input.detectedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'POST_RELEASE_VERIFICATION',sourceId:verification.id,
    targetType:'INCIDENT',targetId:id,linkType:'DETECTED_AS',actorId,evidence:{severity}});
  return {id,projectId,incidentKey:input.incidentKey,severity,status:'DETECTED',
    releaseRolloutId:rollout.id,detectedVerificationId:verification.id};
};

export const triageIncident=async(incidentId,input={},actorId=null)=>{
  requireFields(input,['severity','classification','impact','decision','evidence'],'INVALID_INCIDENT_TRIAGE');
  const severity=upper(input.severity);
  if(!SEVERITIES.has(severity))throw errorOf('Unsupported incident severity','INVALID_INCIDENT_SEVERITY',409);
  const db=getRuntimePool(),incident=await loadIncident(incidentId,db);
  if(incident.status!=='DETECTED')throw errorOf('Only DETECTED incident can be triaged','INCIDENT_TRIAGE_STATE_INVALID',409,{status:incident.status});
  await db.execute(
    `UPDATE product_incidents SET severity=?,status='TRIAGED',triage_json=?,triaged_at=? WHERE id=?`,
    [severity,asJson({classification:input.classification,impact:input.impact,decision:input.decision,evidence:input.evidence}),
     input.triagedAt?new Date(input.triagedAt):new Date(),incidentId]
  );
  return {id:incidentId,projectId:incident.project_id,severity,status:'TRIAGED'};
};

const validateActionRef=async(db,incident,type,ref)=>{
  if(type==='MITIGATE'){
    requireFields(ref,['method'],'INVALID_MITIGATION_ACTION');
    return;
  }
  if(type==='ROLLBACK'){
    requireFields(ref,['targetReleaseVersionId','deploymentId'],'INVALID_ROLLBACK_ACTION');
    const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[ref.targetReleaseVersionId]);
    if(!versions.length||versions[0].project_id!==incident.project_id||
       versions[0].version_type!=='RELEASE_DISTRIBUTION'||!['LOCKED','RELEASED'].includes(versions[0].status))
      throw errorOf('Rollback target must be LOCKED/RELEASED release version in same project','INCIDENT_ROLLBACK_TARGET_INVALID',409);
    if(ref.targetReleaseVersionId===incident.release_version_id)throw errorOf(
      'Rollback target cannot be incident release version','INCIDENT_ROLLBACK_TARGET_SELF',409
    );
    return;
  }
  requireFields(ref,['changesetId','commitSha'],'INVALID_FIX_ACTION');
  if(!SHA40.test(ref.commitSha))throw errorOf('Fix action requires exact commit SHA','INVALID_COMMIT_SHA',409);
  const [changesets]=await db.execute('SELECT * FROM product_engineering_changesets WHERE id=?',[ref.changesetId]);
  if(!changesets.length||changesets[0].project_id!==incident.project_id||
     changesets[0].commit_sha.toLowerCase()!==ref.commitSha.toLowerCase())
    throw errorOf('Fix action Changeset/Commit mismatch','INCIDENT_FIX_CHANGESET_MISMATCH',409);
};

export const createIncidentAction=async(incidentId,input={},actorId=null)=>{
  requireFields(input,['actionKey','actionType','actionRef','result','evidence'],'INVALID_INCIDENT_ACTION');
  const type=upper(input.actionType);
  if(!ACTION_TYPES.has(type))throw errorOf('Unsupported incident action type','INVALID_INCIDENT_ACTION_TYPE',409,{type});
  const db=getRuntimePool(),incident=await loadIncident(incidentId,db);
  if(!['TRIAGED','MITIGATING'].includes(incident.status))throw errorOf(
    'Incident action requires TRIAGED/MITIGATING incident','INCIDENT_ACTION_STATE_INVALID',409,{status:incident.status}
  );
  await validateActionRef(db,incident,type,input.actionRef);
  if(upper(input.result.status)!=='APPLIED')throw errorOf(
    'Incident action must be APPLIED before verification','INCIDENT_ACTION_APPLIED_REQUIRED',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_incident_actions
      (id,project_id,incident_id,action_key,action_type,status,action_ref_json,result_json,
       evidence_json,actor_identity_id,started_at,completed_at)
     VALUES (?,?,?,?,?,'APPLIED',?,?,?,?,?,?)`,
    [id,incident.project_id,incidentId,input.actionKey,type,asJson(input.actionRef),asJson(input.result),
     asJson(input.evidence),actorId,input.startedAt?new Date(input.startedAt):new Date(),
     input.completedAt?new Date(input.completedAt):new Date()]
  );
  await db.execute(
    `UPDATE product_incidents SET status='MITIGATING',mitigation_summary_json=?,mitigated_at=? WHERE id=?`,
    [asJson({actionId:id,actionType:type,result:input.result}),input.completedAt?new Date(input.completedAt):new Date(),incidentId]
  );
  await insertTrace(db,{projectId:incident.project_id,sourceType:'INCIDENT',sourceId:incidentId,
    targetType:'INCIDENT_ACTION',targetId:id,linkType:'MITIGATED_BY',actorId,evidence:{actionType:type}});
  return {id,projectId:incident.project_id,incidentId,actionKey:input.actionKey,actionType:type,status:'APPLIED'};
};

export const verifyIncidentAction=async(actionId,input={},actorId=null)=>{
  requireFields(input,['verificationId','evidence'],'INVALID_INCIDENT_ACTION_VERIFICATION');
  const db=getRuntimePool();
  const [actions]=await db.execute('SELECT * FROM product_incident_actions WHERE id=?',[actionId]);
  if(!actions.length)throw errorOf('Incident Action not found','INCIDENT_ACTION_NOT_FOUND',404);
  const action=actions[0];
  if(action.status!=='APPLIED')throw errorOf('Only APPLIED action can be verified','INCIDENT_ACTION_VERIFY_STATE_INVALID',409);
  const incident=await loadIncident(action.incident_id,db);
  if(incident.status!=='MITIGATING')throw errorOf('Incident must be MITIGATING','INCIDENT_VERIFY_STATE_INVALID',409);
  const [verifications]=await db.execute('SELECT * FROM product_post_release_verifications WHERE id=?',[input.verificationId]);
  if(!verifications.length)throw errorOf('Post-release verification not found','POST_RELEASE_VERIFICATION_NOT_FOUND',404);
  const verification=verifications[0];
  if(verification.project_id!==incident.project_id||verification.release_rollout_id!==incident.release_rollout_id||
     verification.status!=='PASS')throw errorOf(
    'Incident action verification requires PASS post-release verification for same rollout',
    'INCIDENT_PASS_VERIFICATION_REQUIRED',409
  );
  if(new Date(verification.verified_at).getTime()<new Date(action.completed_at).getTime())throw errorOf(
    'Verification must occur after incident action','INCIDENT_VERIFICATION_TOO_EARLY',409
  );
  await db.execute(
    "UPDATE product_incident_actions SET status='VERIFIED',verified_at=? WHERE id=?",
    [input.verifiedAt?new Date(input.verifiedAt):new Date(),actionId]
  );
  await db.execute(
    "UPDATE product_incidents SET status='RESOLVED',resolved_at=? WHERE id=?",
    [input.verifiedAt?new Date(input.verifiedAt):new Date(),incident.id]
  );
  await insertTrace(db,{projectId:incident.project_id,sourceType:'INCIDENT_ACTION',sourceId:actionId,
    targetType:'POST_RELEASE_VERIFICATION',targetId:verification.id,linkType:'VERIFIED_BY',actorId,evidence:input.evidence});
  return {id:actionId,projectId:incident.project_id,incidentId:incident.id,status:'VERIFIED',
    incidentStatus:'RESOLVED',verificationId:verification.id};
};

export const createIncidentReview=async(incidentId,input={},actorId=null)=>{
  requireFields(input,[
    'verificationId','reviewKey','rootCause','timeline','customerImpact','prevention','evidence'
  ],'INVALID_INCIDENT_REVIEW');
  if(!Array.isArray(input.backlogItems)||!input.backlogItems.length)throw errorOf(
    'Incident Review requires at least one Backlog item','INCIDENT_REVIEW_BACKLOG_REQUIRED',409
  );
  if(!Array.isArray(input.knowledgeRefs)||!input.knowledgeRefs.length)throw errorOf(
    'Incident Review requires Knowledge references','INCIDENT_REVIEW_KNOWLEDGE_REQUIRED',409
  );
  const db=getRuntimePool(),incident=await loadIncident(incidentId,db);
  if(incident.status!=='RESOLVED')throw errorOf(
    'Incident Review requires RESOLVED incident','INCIDENT_REVIEW_STATE_INVALID',409,{status:incident.status}
  );
  const [verifications]=await db.execute('SELECT * FROM product_post_release_verifications WHERE id=?',[input.verificationId]);
  if(!verifications.length||verifications[0].project_id!==incident.project_id||
     verifications[0].release_rollout_id!==incident.release_rollout_id||verifications[0].status!=='PASS')
    throw errorOf('Incident Review requires PASS recovery verification','INCIDENT_REVIEW_PASS_VERIFICATION_REQUIRED',409);
  const [actions]=await db.execute(
    "SELECT id FROM product_incident_actions WHERE incident_id=? AND status='VERIFIED'",[incidentId]
  );
  if(!actions.length)throw errorOf('Incident Review requires VERIFIED action','INCIDENT_REVIEW_VERIFIED_ACTION_REQUIRED',409);

  const conn=await db.getConnection(),reviewId=randomUUID(),backlogIds=[];
  try{
    await conn.beginTransaction();
    for(const item of input.backlogItems){
      requireFields(item,['itemKey','itemType','title','priority','acceptanceCriteria','evidence'],'INVALID_INCIDENT_BACKLOG_ITEM');
      const id=randomUUID();backlogIds.push(id);
      await conn.execute(
        `INSERT INTO project_work_items
          (id,project_id,item_key,item_type,title,stage_key,priority,status,
           acceptance_criteria_json,evidence_json,metadata_json)
         VALUES (?,?,?,?,?,'PD_18_KNOWLEDGE',?,'PLANNED',?,?,?)`,
        [id,incident.project_id,item.itemKey,upper(item.itemType),item.title,upper(item.priority),
         asJson(item.acceptanceCriteria),asJson(item.evidence),
         asJson({source:'INCIDENT_REVIEW',incidentId,reviewId})]
      );
    }
    await conn.execute(
      `INSERT INTO product_incident_reviews
        (id,project_id,incident_id,verification_id,review_key,root_cause_json,timeline_json,
         customer_impact_json,prevention_json,backlog_work_item_ids_json,knowledge_refs_json,
         evidence_json,reviewed_by_identity_id,reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reviewId,incident.project_id,incidentId,input.verificationId,input.reviewKey,asJson(input.rootCause),
       asJson(input.timeline),asJson(input.customerImpact),asJson(input.prevention),asJson(backlogIds),
       asJson(input.knowledgeRefs),asJson(input.evidence),actorId,
       input.reviewedAt?new Date(input.reviewedAt):new Date()]
    );
    await conn.execute(
      "UPDATE product_incidents SET status='CLOSED',closed_at=? WHERE id=?",
      [input.reviewedAt?new Date(input.reviewedAt):new Date(),incidentId]
    );
    for(const id of backlogIds)await insertTrace(conn,{projectId:incident.project_id,sourceType:'INCIDENT',
      sourceId:incidentId,targetType:'WORK_ITEM',targetId:id,linkType:'CREATES_BACKLOG',actorId,evidence:{reviewId}});
    await insertTrace(conn,{projectId:incident.project_id,sourceType:'INCIDENT',sourceId:incidentId,
      targetType:'INCIDENT_REVIEW',targetId:reviewId,linkType:'REVIEWED_AS',actorId,evidence:{verificationId:input.verificationId}});
    await conn.commit();
    return {id:reviewId,projectId:incident.project_id,incidentId,status:'CLOSED',
      verificationId:input.verificationId,backlogWorkItemIds:backlogIds,knowledgeRefs:input.knowledgeRefs};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const getPostReleaseOperationsState=async projectId=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const [verifications,incidents,actions,reviews]=await Promise.all([
    db.execute('SELECT * FROM product_post_release_verifications WHERE project_id=? ORDER BY verified_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_incidents WHERE project_id=? ORDER BY detected_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_incident_actions WHERE project_id=? ORDER BY started_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_incident_reviews WHERE project_id=? ORDER BY reviewed_at,id',[projectId]).then(x=>x[0])
  ]);
  const latest=verifications.at(-1)||null;
  const open=incidents.filter(x=>x.status!=='CLOSED');
  const failingWithoutIncident=verifications.filter(v=>v.status==='FAIL'&&!incidents.some(i=>i.detected_verification_id===v.id));
  return {
    projectId,
    operationalStatus:open.length||failingWithoutIncident.length||latest?.status==='FAIL'?'DEGRADED':latest?'HEALTHY':'UNVERIFIED',
    latestVerificationId:latest?.id||null,
    unownedFailureVerificationIds:failingWithoutIncident.map(x=>x.id),
    verifications:verifications.map(x=>({
      id:x.id,releaseRolloutId:x.release_rollout_id,releaseVersionId:x.release_version_id,
      verificationKey:x.verification_key,status:x.status,exactCommitSha:x.exact_commit_sha,
      artifactSha256:x.artifact_sha256,deploymentId:x.deployment_id,
      health:parseJson(x.health_json),readiness:parseJson(x.readiness_json),
      smokeCriticalFlow:parseJson(x.smoke_critical_flow_json),errorIncident:parseJson(x.error_incident_json),
      performance:parseJson(x.performance_json),instrumentation:parseJson(x.instrumentation_json),
      primaryMetric:parseJson(x.primary_metric_json),userFeedback:parseJson(x.user_feedback_json),
      operationsFeedback:parseJson(x.operations_feedback_json),verifiedAt:x.verified_at
    })),
    incidents:incidents.map(x=>({
      id:x.id,releaseRolloutId:x.release_rollout_id,incidentKey:x.incident_key,title:x.title,
      severity:x.severity,status:x.status,detectedVerificationId:x.detected_verification_id,
      signal:parseJson(x.signal_json),affectedScope:parseJson(x.affected_scope_json),
      triage:parseJson(x.triage_json),detectedAt:x.detected_at,triagedAt:x.triaged_at||null,
      resolvedAt:x.resolved_at||null,closedAt:x.closed_at||null
    })),
    actions:actions.map(x=>({
      id:x.id,incidentId:x.incident_id,actionKey:x.action_key,actionType:x.action_type,status:x.status,
      actionRef:parseJson(x.action_ref_json),result:parseJson(x.result_json),
      startedAt:x.started_at,completedAt:x.completed_at||null,verifiedAt:x.verified_at||null
    })),
    reviews:reviews.map(x=>({
      id:x.id,incidentId:x.incident_id,verificationId:x.verification_id,reviewKey:x.review_key,
      rootCause:parseJson(x.root_cause_json),prevention:parseJson(x.prevention_json),
      backlogWorkItemIds:parseJson(x.backlog_work_item_ids_json),
      knowledgeRefs:parseJson(x.knowledge_refs_json),reviewedAt:x.reviewed_at
    }))
  };
};
