import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcFoundationGate } from './aigc-foundation.mjs';

const GATE='G-AIGC-SCRIPT';
const KNOWLEDGE_STATUSES=new Set(['FACT','RULE','CURRENT','PENDING','EXPERIMENT','HISTORICAL','DEPRECATED']);
const STORY_CATEGORIES=new Set([
  'WORLD','CHARACTER','RELATIONSHIP','TIMELINE','BEAT','SCENE','DIALOGUE',
  'THEME','NATURAL_UNIT','SPOILER','CULTURAL_DEPENDENCY'
]);
const REQUIRED_NARRATIVE_CATEGORIES=[
  'WORLD','CHARACTER','RELATIONSHIP','TIMELINE','BEAT','SCENE','DIALOGUE',
  'THEME','NATURAL_UNIT','SPOILER','CULTURAL_DEPENDENCY'
];
const ACTIVE_TRUTH_STATUSES=new Set(['FACT','RULE','CURRENT']);
const IMPACT_TYPES=['SCENE','SHOT','ASSET','AUDIO','DISTRIBUTION'];
const SHA64=/^[0-9a-f]{64}$/i;

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
const stableValue=value=>{
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value)),'utf8'
).digest('hex');
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadAigcProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC script domain requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO aigc_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};

export const resolveAigcScriptProjectScope=async projectId=>{
  const p=await loadAigcProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const resolveAigcScriptVersionScope=async scriptVersionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT v.project_id,p.workspace_id
       FROM aigc_script_versions v JOIN projects p ON p.id=v.project_id
      WHERE v.id=?`,[scriptVersionId]
  );
  if(!rows.length)throw errorOf('Script version not found','AIGC_SCRIPT_VERSION_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcStoryKnowledge=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,['knowledgeKey','category','knowledgeStatus','title','content','scope','sourceRef','evidence'],
    'INVALID_AIGC_STORY_KNOWLEDGE');
  const category=upper(input.category),knowledgeStatus=upper(input.knowledgeStatus);
  if(!STORY_CATEGORIES.has(category))throw errorOf('Unsupported Story Knowledge category','AIGC_STORY_CATEGORY_INVALID',409,{category});
  if(!KNOWLEDGE_STATUSES.has(knowledgeStatus))throw errorOf('Unsupported Story Knowledge status','AIGC_STORY_STATUS_INVALID',409,{knowledgeStatus});
  if(['FACT','RULE'].includes(knowledgeStatus)&&input.immutable!==true)throw errorOf(
    'FACT/RULE Story Knowledge must be immutable','AIGC_STORY_TRUTH_IMMUTABLE_REQUIRED',409
  );
  const db=getRuntimePool(),id=randomUUID();
  if(input.supersedesId){
    const [prev]=await db.execute('SELECT * FROM aigc_story_knowledge_entries WHERE id=?',[input.supersedesId]);
    if(!prev.length||prev[0].project_id!==projectId)throw errorOf(
      'Superseded Story Knowledge is missing or outside project','AIGC_STORY_SUPERSEDES_INVALID',409
    );
    if(['FACT','RULE'].includes(prev[0].knowledge_status))throw errorOf(
      'FACT/RULE Story Knowledge cannot be silently superseded','AIGC_STORY_TRUTH_CHANGE_REQUEST_REQUIRED',409
    );
  }
  await db.execute(
    `INSERT INTO aigc_story_knowledge_entries
      (id,project_id,knowledge_key,category,knowledge_status,title,content_json,scope_json,
       source_ref_json,effective_script_version_key,gate_critical,immutable,supersedes_id,
       evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.knowledgeKey,category,knowledgeStatus,input.title,asJson(input.content),asJson(input.scope),
     asJson(input.sourceRef),input.effectiveScriptVersionKey||null,input.gateCritical===true?1:0,
     input.immutable===true?1:0,input.supersedesId||null,asJson(input.evidence),actorId]
  );
  return {id,projectId,knowledgeKey:input.knowledgeKey,category,knowledgeStatus,
    gateCritical:input.gateCritical===true,immutable:input.immutable===true};
};

export const createAigcScriptChangeRequest=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'changeKey','fromScriptVersionId','proposedVersionKey','reason','before','after',
    'impacts','approval','evidence'
  ],'INVALID_AIGC_SCRIPT_CHANGE_REQUEST');
  const db=getRuntimePool();
  const [fromRows]=await db.execute('SELECT * FROM aigc_script_versions WHERE id=?',[input.fromScriptVersionId]);
  const from=fromRows[0];
  if(!from||from.project_id!==projectId||from.status!=='LOCKED'||!from.is_current)throw errorOf(
    'Change Request must start from the current locked script','AIGC_SCRIPT_CHANGE_FROM_CURRENT_LOCK_REQUIRED',409
  );
  if(upper(input.approval.status)!=='APPROVED'||!nonEmpty(input.approval.approver))
    throw errorOf('Script Change Request requires explicit approval','AIGC_SCRIPT_CHANGE_APPROVAL_REQUIRED',409);

  const impacts=input.impacts||{};
  for(const type of IMPACT_TYPES){
    const impact=impacts[type];
    if(!impact||!['AFFECTED','N_A'].includes(upper(impact.disposition))||
       !nonEmpty(impact.rationale)||!nonEmpty(impact.revalidation))
      throw errorOf('Script Change Request requires complete five-domain impact analysis',
        'AIGC_SCRIPT_CHANGE_IMPACT_INCOMPLETE',409,{impactType:type});
    if(upper(impact.disposition)==='AFFECTED'&&(!Array.isArray(impact.affectedObjects)||!impact.affectedObjects.length))
      throw errorOf('Affected impact requires affected objects','AIGC_SCRIPT_CHANGE_AFFECTED_OBJECT_REQUIRED',409,{impactType:type});
  }

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const genericChangeId=randomUUID(),id=randomUUID();
    const genericImpacts=IMPACT_TYPES.map(type=>({
      impactType:type,disposition:upper(impacts[type].disposition),
      affectedObjects:impacts[type].affectedObjects||[],rationale:impacts[type].rationale,
      revalidation:impacts[type].revalidation
    }));
    await conn.execute(
      `INSERT INTO project_changes
        (id,project_id,change_key,before_json,change_reason,change_scope_json,impacted_objects_json,
         revalidation_scope_json,after_json,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [genericChangeId,projectId,input.changeKey,asJson(input.before),input.reason,
       asJson({domain:'AIGC_SCRIPT',fromScriptVersionId:from.id,proposedVersionKey:input.proposedVersionKey}),
       asJson(genericImpacts),asJson(Object.fromEntries(IMPACT_TYPES.map(t=>[t,impacts[t].revalidation]))),
       asJson(input.after),asJson(input.evidence),actorId]
    );
    await conn.execute(
      `INSERT INTO aigc_script_change_requests
        (id,project_id,change_key,project_change_id,from_script_version_id,proposed_version_key,
         reason,approval_json,status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?, 'APPROVED',?,?)`,
      [id,projectId,input.changeKey,genericChangeId,from.id,input.proposedVersionKey,input.reason,
       asJson(input.approval),asJson(input.evidence),actorId]
    );
    for(const type of IMPACT_TYPES){
      const impact=impacts[type];
      await conn.execute(
        `INSERT INTO aigc_script_change_impacts
          (id,project_id,script_change_request_id,impact_type,affected_objects_json,disposition,
           rationale,revalidation_json,status,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),projectId,id,type,asJson(impact.affectedObjects||[]),upper(impact.disposition),
         impact.rationale,asJson(impact.revalidation),'ASSESSED',asJson(impact.evidence||input.evidence)]
      );
    }
    await insertTrace(conn,{projectId,sourceType:'SCRIPT_VERSION',sourceId:from.id,
      targetType:'SCRIPT_CHANGE_REQUEST',targetId:id,linkType:'REQUESTS_CHANGE',actorId,evidence:{changeKey:input.changeKey}});
    await conn.commit();
    return {id,projectId,changeKey:input.changeKey,projectChangeId:genericChangeId,
      fromScriptVersionId:from.id,proposedVersionKey:input.proposedVersionKey,status:'APPROVED'};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createAigcScriptVersion=async(projectId,input={},actorId=null)=>{
  await loadAigcProject(projectId);
  requireFields(input,[
    'versionKey','versionNo','title','scriptFormat','sourceLocator','sceneStart','sceneEnd',
    'sceneCount','naturalUnits','structure','contentSha256','evidence'
  ],'INVALID_AIGC_SCRIPT_VERSION');
  const versionNo=Number(input.versionNo),sceneStart=Number(input.sceneStart),
    sceneEnd=Number(input.sceneEnd),sceneCount=Number(input.sceneCount);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf('versionNo must be positive integer','AIGC_SCRIPT_VERSION_NO_INVALID',409);
  if(!Number.isInteger(sceneStart)||!Number.isInteger(sceneEnd)||sceneStart<1||sceneEnd<sceneStart||
     !Number.isInteger(sceneCount)||sceneCount!==sceneEnd-sceneStart+1)
    throw errorOf('Scene range/count is inconsistent','AIGC_SCRIPT_SCENE_RANGE_INVALID',409);
  if(!SHA64.test(String(input.contentSha256)))throw errorOf('contentSha256 must be SHA-256','AIGC_SCRIPT_HASH_INVALID',409);

  const db=getRuntimePool();
  const [currentRows]=await db.execute(
    "SELECT * FROM aigc_script_versions WHERE project_id=? AND is_current=TRUE AND status='LOCKED' ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  const current=currentRows[0]||null;
  let change=null;
  if(current){
    if(!input.changeRequestId)throw errorOf(
      'Locked Script can only be revised through approved Change Request','AIGC_SCRIPT_CHANGE_REQUEST_REQUIRED',409,
      {currentScriptVersionId:current.id}
    );
    const [changes]=await db.execute('SELECT * FROM aigc_script_change_requests WHERE id=?',[input.changeRequestId]);
    change=changes[0];
    if(!change||change.project_id!==projectId||change.status!=='APPROVED'||
       change.from_script_version_id!==current.id||change.proposed_version_key!==input.versionKey)
      throw errorOf('Approved Change Request does not match new script version','AIGC_SCRIPT_CHANGE_REQUEST_INVALID',409);
  }else if(input.changeRequestId){
    throw errorOf('Initial script version must not use Change Request','AIGC_INITIAL_SCRIPT_CHANGE_REQUEST_FORBIDDEN',409);
  }

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_script_versions
      (id,project_id,version_key,version_no,title,script_format,source_locator_json,
       scene_start,scene_end,scene_count,natural_unit_json,structure_json,content_sha256,
       parent_script_version_id,change_request_id,status,is_current,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',FALSE,?,?)`,
    [id,projectId,input.versionKey,versionNo,input.title,upper(input.scriptFormat),asJson(input.sourceLocator),
     sceneStart,sceneEnd,sceneCount,asJson(input.naturalUnits),asJson(input.structure),
     String(input.contentSha256).toLowerCase(),current?.id||input.parentScriptVersionId||null,
     change?.id||null,asJson(input.evidence),actorId]
  );
  if(change)await insertTrace(db,{projectId,sourceType:'SCRIPT_CHANGE_REQUEST',sourceId:change.id,
    targetType:'SCRIPT_VERSION',targetId:id,linkType:'PROPOSES_VERSION',actorId,evidence:{versionKey:input.versionKey}});
  return {id,projectId,versionKey:input.versionKey,versionNo,status:'DRAFT',
    parentScriptVersionId:current?.id||input.parentScriptVersionId||null,changeRequestId:change?.id||null};
};

export const lockAigcScriptVersion=async(scriptVersionId,input={},actorId=null)=>{
  requireFields(input,['lockKey','continuityQa','approval','evidence'],'INVALID_AIGC_SCRIPT_LOCK');
  if(upper(input.approval.status)!=='APPROVED'||!nonEmpty(input.approval.approver))
    throw errorOf('Script Lock requires explicit approval','AIGC_SCRIPT_LOCK_APPROVAL_REQUIRED',409);
  for(const key of ['character','relationship','timeline','fact','naturalUnit']){
    if(upper(input.continuityQa[key])!=='PASS')throw errorOf(
      'Script continuity QA must PASS before lock','AIGC_SCRIPT_CONTINUITY_QA_REQUIRED',409,{dimension:key}
    );
  }

  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_script_versions WHERE id=?',[scriptVersionId]);
  const script=rows[0];
  if(!script)throw errorOf('Script version not found','AIGC_SCRIPT_VERSION_NOT_FOUND',404);
  if(script.status!=='DRAFT')throw errorOf('Only DRAFT script can be locked','AIGC_SCRIPT_LOCK_STATE_INVALID',409);
  const project=await loadAigcProject(script.project_id,db);
  const planGate=await evaluateAigcFoundationGate(project.id,'G-AIGC-PLAN',{persist:false},actorId);
  if(planGate.status!=='PASS')throw errorOf('G-AIGC-PLAN must PASS before Script Lock','G_AIGC_PLAN_REQUIRED',409,{
    reasonCodes:planGate.reasonCodes
  });

  const knowledge=await listRows(db,
    "SELECT * FROM aigc_story_knowledge_entries WHERE project_id=? AND knowledge_status NOT IN ('HISTORICAL','DEPRECATED') ORDER BY created_at,id",
    [project.id]
  );
  const required=project.project_subtype_key==='SHORT_DRAMA'||project.project_subtype_key==='NARRATIVE_FILM'
    ?REQUIRED_NARRATIVE_CATEGORIES:[];
  const covered=new Set(knowledge.filter(x=>ACTIVE_TRUTH_STATUSES.has(x.knowledge_status)).map(x=>x.category));
  const missing=required.filter(x=>!covered.has(x));
  if(missing.length)throw errorOf('Narrative Story Knowledge coverage is incomplete','AIGC_STORY_KNOWLEDGE_COVERAGE_INCOMPLETE',409,{missing});
  const unresolved=knowledge.filter(x=>x.gate_critical&&['PENDING','EXPERIMENT'].includes(x.knowledge_status));
  if(unresolved.length)throw errorOf('Gate-critical Story Knowledge is unresolved','AIGC_STORY_KNOWLEDGE_UNRESOLVED',409,{
    knowledgeIds:unresolved.map(x=>x.id)
  });

  if(script.change_request_id){
    const impacts=await listRows(db,'SELECT * FROM aigc_script_change_impacts WHERE script_change_request_id=?',[script.change_request_id]);
    const types=[...new Set(impacts.map(x=>x.impact_type))].sort();
    if(types.length!==IMPACT_TYPES.length||IMPACT_TYPES.some(x=>!types.includes(x))||
       impacts.some(x=>x.status!=='ASSESSED'))
      throw errorOf('Change Request impact analysis is incomplete','AIGC_SCRIPT_CHANGE_IMPACT_INCOMPLETE',409);
  }

  const knowledgeIds=knowledge.filter(x=>ACTIVE_TRUTH_STATUSES.has(x.knowledge_status)).map(x=>x.id);
  const lockSnapshotSha256=sha256({
    scriptVersionId:script.id,contentSha256:script.content_sha256,knowledgeIds:[...knowledgeIds].sort(),
    continuityQa:input.continuityQa
  });
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_script_versions SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND is_current=TRUE AND status='LOCKED'",
      [project.id]
    );
    await conn.execute("UPDATE aigc_script_versions SET status='LOCKED',is_current=TRUE WHERE id=?",[script.id]);
    const lockId=randomUUID();
    await conn.execute(
      `INSERT INTO aigc_script_locks
        (id,project_id,script_version_id,lock_key,story_knowledge_ids_json,continuity_qa_json,
         lock_snapshot_sha256,approval_json,evidence_json,status,locked_by_identity_id,locked_at)
       VALUES (?,?,?,?,?,?,?,?,?,'LOCKED',?,?)`,
      [lockId,project.id,script.id,input.lockKey,asJson(knowledgeIds),asJson(input.continuityQa),
       lockSnapshotSha256,asJson(input.approval),asJson(input.evidence),actorId,
       input.lockedAt?new Date(input.lockedAt):new Date()]
    );
    if(script.change_request_id){
      await conn.execute(
        "UPDATE aigc_script_change_requests SET status='APPLIED',applied_script_version_id=?,applied_at=CURRENT_TIMESTAMP(6) WHERE id=?",
        [script.id,script.change_request_id]
      );
    }
    for(const knowledgeId of knowledgeIds)await insertTrace(conn,{projectId:project.id,
      sourceType:'STORY_KNOWLEDGE',sourceId:knowledgeId,targetType:'SCRIPT_VERSION',targetId:script.id,
      linkType:'LOCKS_INTO',actorId,evidence:{lockKey:input.lockKey}});
    await insertTrace(conn,{projectId:project.id,sourceType:'SCRIPT_VERSION',sourceId:script.id,
      targetType:'SCRIPT_LOCK',targetId:lockId,linkType:'LOCKED_AS',actorId,evidence:{lockSnapshotSha256}});
    await conn.commit();
    return {id:lockId,projectId:project.id,scriptVersionId:script.id,lockKey:input.lockKey,
      status:'LOCKED',isCurrent:true,lockSnapshotSha256};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateAigcScriptGate=async(projectId,input={},actorId=null)=>{
  const project=await loadAigcProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};

  const planGate=await evaluateAigcFoundationGate(projectId,'G-AIGC-PLAN',{asOf,persist:false},actorId);
  if(planGate.status!=='PASS')reasons.push('G_AIGC_PLAN_NOT_PASS');

  const knowledge=await listRows(db,
    "SELECT * FROM aigc_story_knowledge_entries WHERE project_id=? AND knowledge_status NOT IN ('HISTORICAL','DEPRECATED') ORDER BY created_at,id",
    [projectId]
  );
  const required=project.project_subtype_key==='SHORT_DRAMA'||project.project_subtype_key==='NARRATIVE_FILM'
    ?REQUIRED_NARRATIVE_CATEGORIES:[];
  const covered=[...new Set(knowledge.filter(x=>ACTIVE_TRUTH_STATUSES.has(x.knowledge_status)).map(x=>x.category))];
  const missing=required.filter(x=>!covered.includes(x));
  evidence.storyKnowledgeCount=knowledge.length;
  evidence.storyCategoryCoverage=covered.sort();
  if(missing.length)reasons.push(...missing.map(x=>'AIGC_STORY_CATEGORY_REQUIRED:'+x));
  if(knowledge.some(x=>x.gate_critical&&['PENDING','EXPERIMENT'].includes(x.knowledge_status)))
    reasons.push('AIGC_GATE_CRITICAL_STORY_KNOWLEDGE_UNRESOLVED');

  const [scripts]=await db.execute(
    "SELECT * FROM aigc_script_versions WHERE project_id=? AND is_current=TRUE AND status='LOCKED' ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  const script=scripts[0]||null;
  evidence.currentScriptVersionId=script?.id||null;
  if(!script)reasons.push('AIGC_CURRENT_LOCKED_SCRIPT_REQUIRED');
  else{
    evidence.scriptVersionKey=script.version_key;
    evidence.sceneRange={start:Number(script.scene_start),end:Number(script.scene_end),count:Number(script.scene_count)};
    if(Number(script.scene_count)!==Number(script.scene_end)-Number(script.scene_start)+1)
      reasons.push('AIGC_SCRIPT_SCENE_RANGE_INVALID');
    const [locks]=await db.execute(
      "SELECT * FROM aigc_script_locks WHERE script_version_id=? AND status='LOCKED' LIMIT 1",[script.id]
    );
    const lock=locks[0]||null;
    evidence.scriptLockId=lock?.id||null;
    if(!lock)reasons.push('AIGC_SCRIPT_LOCK_REQUIRED');
    else{
      const qa=parseJson(lock.continuity_qa_json)||{};
      for(const key of ['character','relationship','timeline','fact','naturalUnit']){
        if(upper(qa[key])!=='PASS')reasons.push('AIGC_SCRIPT_CONTINUITY_QA_REQUIRED:'+key);
      }
    }
  }

  const [pendingChanges]=await db.execute(
    "SELECT id,change_key FROM aigc_script_change_requests WHERE project_id=? AND status='APPROVED' ORDER BY created_at,id",
    [projectId]
  );
  evidence.pendingApprovedChangeIds=pendingChanges.map(x=>x.id);
  if(pendingChanges.length)reasons.push('AIGC_APPROVED_SCRIPT_CHANGE_PENDING');

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m282_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcScriptState=async projectId=>{
  const project=await loadAigcProject(projectId);
  const db=getRuntimePool();
  const [knowledge,scripts,locks,changes,impacts,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_story_knowledge_entries WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_script_versions WHERE project_id=? ORDER BY version_no,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_script_locks WHERE project_id=? ORDER BY locked_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_script_change_requests WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_script_change_impacts WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m282_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{language:'zh-CN',moduleNames:['故事知识库','剧本版本','剧本锁定与变更'],gateName:'剧本锁定门禁'},
    storyKnowledge:knowledge.map(x=>({
      id:x.id,knowledgeKey:x.knowledge_key,category:x.category,knowledgeStatus:x.knowledge_status,
      title:x.title,content:parseJson(x.content_json),scope:parseJson(x.scope_json),
      sourceRef:parseJson(x.source_ref_json),gateCritical:Boolean(x.gate_critical),
      immutable:Boolean(x.immutable),supersedesId:x.supersedes_id||null
    })),
    scriptVersions:scripts.map(x=>({
      id:x.id,versionKey:x.version_key,versionNo:Number(x.version_no),title:x.title,
      scriptFormat:x.script_format,sourceLocator:parseJson(x.source_locator_json),
      sceneStart:Number(x.scene_start),sceneEnd:Number(x.scene_end),sceneCount:Number(x.scene_count),
      naturalUnits:parseJson(x.natural_unit_json),structure:parseJson(x.structure_json),
      contentSha256:x.content_sha256,parentScriptVersionId:x.parent_script_version_id||null,
      changeRequestId:x.change_request_id||null,status:x.status,isCurrent:Boolean(x.is_current)
    })),
    locks:locks.map(x=>({
      id:x.id,scriptVersionId:x.script_version_id,lockKey:x.lock_key,
      storyKnowledgeIds:parseJson(x.story_knowledge_ids_json),continuityQa:parseJson(x.continuity_qa_json),
      lockSnapshotSha256:x.lock_snapshot_sha256,approval:parseJson(x.approval_json),status:x.status,lockedAt:x.locked_at
    })),
    changeRequests:changes.map(x=>({
      id:x.id,changeKey:x.change_key,projectChangeId:x.project_change_id,
      fromScriptVersionId:x.from_script_version_id,proposedVersionKey:x.proposed_version_key,
      reason:x.reason,approval:parseJson(x.approval_json),status:x.status,
      appliedScriptVersionId:x.applied_script_version_id||null
    })),
    impacts:impacts.map(x=>({
      id:x.id,scriptChangeRequestId:x.script_change_request_id,impactType:x.impact_type,
      affectedObjects:parseJson(x.affected_objects_json),disposition:x.disposition,
      rationale:x.rationale,revalidation:parseJson(x.revalidation_json),status:x.status
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
