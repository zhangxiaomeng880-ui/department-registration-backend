import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcEditGate } from './aigc-edit-timeline.mjs';

const MASTER_GATE='G-AIGC-MASTER';
const SUB_GATES=new Map([
  ['G-AIGC-CREATIVE-ACCEPTANCE',[
    'storyFact','characterRelationship','timelineSceneContinuity','dialoguePropContinuity',
    'creativeIntent','performanceIntent','editIntent'
  ]],
  ['G-AIGC-PRODUCTION-QA',[
    'identity','look','expression','action','anatomy','sceneProp','spatial',
    'cameraLightingColor','textUiArtifact','temporal','audio','edit'
  ]],
  ['G-AIGC-TECHNICAL-QA',[
    'resolution','fps','codec','aspect','duration','fileIntegrity','loudness','exportSpec'
  ]],
  ['G-AIGC-COMPLIANCE',[
    'sourceLicense','likeness','font','music','brand','regionalRights',
    'aiDisclosure','platformRequirements','contentCredentials'
  ]],
  ['G-AIGC-LOCALIZATION-QA',[
    'translation','culturalMeaning','subtitleLength','dub','sync','localPlatformSpec'
  ]]
]);
const CHECK_STATUSES=new Set(['PASS','N_A','FAIL','BLOCKED']);
const TERMINAL_MASTER_STATUSES=new Set(['LOCKED','HISTORICAL']);
const SHA64=/^[0-9a-f]{64}$/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{if(v==null)return false;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;};
const requireFields=(input,fields,code)=>{const missing=fields.filter(k=>!nonEmpty(input?.[k]));if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Mastering requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentTimeline=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_timeline_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
};
const currentMaster=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
};
const latestCandidate=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='CANDIDATE' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
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

export const resolveAigcMasterProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveAigcMasterScope=async masterVersionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT m.project_id,p.workspace_id
       FROM aigc_master_versions m JOIN projects p ON p.id=m.project_id
      WHERE m.id=?`,[masterVersionId]
  );
  if(!rows.length)throw errorOf('Master version not found','AIGC_MASTER_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcMasterVersion=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'masterKey','versionNo','title','timelineVersionId','sourceExportId','contentLocator',
    'sourceFingerprintSha256','masterSpec','localizationScope','evidence'
  ],'INVALID_AIGC_MASTER_VERSION');
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Master versionNo must be positive integer','AIGC_MASTER_VERSION_INVALID',409
  );
  if(!SHA64.test(String(input.sourceFingerprintSha256||'')))throw errorOf(
    'Master source fingerprint must be SHA-256','AIGC_MASTER_SHA_INVALID',409
  );
  if(!nonEmpty(input.masterSpec)||!nonEmpty(input.contentLocator))
    throw errorOf('Master content locator/spec required','AIGC_MASTER_SPEC_REQUIRED',409);

  const db=getRuntimePool();
  const editGate=await evaluateAigcEditGate(projectId,{persist:false},actorId);
  if(editGate.status!=='PASS')throw errorOf(
    'G-AIGC-EDIT must PASS before Mastering','G_AIGC_EDIT_REQUIRED',409,{reasonCodes:editGate.reasonCodes}
  );
  const timeline=await currentTimeline(projectId,db);
  if(!timeline||timeline.id!==input.timelineVersionId)throw errorOf(
    'Master must derive from current locked Timeline','AIGC_MASTER_CURRENT_TIMELINE_REQUIRED',409,
    {currentTimelineVersionId:timeline?.id||null,providedTimelineVersionId:input.timelineVersionId}
  );
  const [exports]=await db.execute(
    `SELECT * FROM aigc_render_exports
      WHERE id=? AND project_id=? AND timeline_version_id=? AND export_type='EDIT_MASTER' AND status='PASS'`,
    [input.sourceExportId,projectId,timeline.id]
  );
  const sourceExport=exports[0];
  if(!sourceExport)throw errorOf(
    'Master requires PASS EDIT_MASTER export from current Timeline','AIGC_MASTER_EDIT_EXPORT_REQUIRED',409
  );
  if(String(input.sourceFingerprintSha256).toLowerCase()!==sourceExport.source_fingerprint_sha256)
    throw errorOf('Master fingerprint must match source Edit Master export',
      'AIGC_MASTER_SOURCE_FINGERPRINT_MISMATCH',409);

  const existingCandidate=await latestCandidate(projectId,db);
  if(existingCandidate)throw errorOf(
    'Resolve or lock the existing Master candidate before creating another',
    'AIGC_MASTER_CANDIDATE_EXISTS',409,{masterVersionId:existingCandidate.id}
  );
  const current=await currentMaster(projectId,db);
  if(current){
    if(input.parentMasterVersionId!==current.id)throw errorOf(
      'Master revision must derive from current locked Master','AIGC_MASTER_PARENT_CURRENT_REQUIRED',409,
      {currentMasterVersionId:current.id}
    );
    if(upper(input.changeRef?.status)!=='APPROVED'||!nonEmpty(input.changeRef?.reference))
      throw errorOf('Master revision requires approved Change/Decision',
        'AIGC_MASTER_CHANGE_DECISION_REQUIRED',409);
  }else if(input.parentMasterVersionId){
    throw errorOf('Initial Master must not have parent','AIGC_INITIAL_MASTER_PARENT_FORBIDDEN',409);
  }

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_master_versions
      (id,project_id,timeline_version_id,source_export_id,parent_master_version_id,master_key,version_no,title,
       content_locator_json,source_fingerprint_sha256,master_spec_json,localization_enabled,localization_scope_json,
       change_ref_json,status,is_current,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,?,?)`,
    [
      id,projectId,timeline.id,sourceExport.id,input.parentMasterVersionId||null,input.masterKey,versionNo,input.title,
      asJson(input.contentLocator),String(input.sourceFingerprintSha256).toLowerCase(),asJson(input.masterSpec),
      input.localizationEnabled===true?1:0,asJson(input.localizationScope),
      input.changeRef?asJson(input.changeRef):null,asJson(input.evidence),actorId
    ]
  );
  await insertTrace(db,{projectId,sourceType:'RENDER_EXPORT',sourceId:sourceExport.id,
    targetType:'MASTER_VERSION',targetId:id,linkType:'MASTERED_AS',actorId,
    evidence:{masterKey:input.masterKey,versionNo,timelineVersionId:timeline.id}});
  return {id,projectId,timelineVersionId:timeline.id,sourceExportId:sourceExport.id,
    masterKey:input.masterKey,versionNo,status:'CANDIDATE',isCurrent:false,
    localizationEnabled:input.localizationEnabled===true};
};

const loadMaster=async(projectId,masterVersionId,db)=>{
  const [rows]=await db.execute(
    'SELECT * FROM aigc_master_versions WHERE id=? AND project_id=?',[masterVersionId,projectId]
  );
  if(!rows.length)throw errorOf('Master version not found','AIGC_MASTER_NOT_FOUND',404);
  return rows[0];
};
const validateConditions=conditions=>{
  if(conditions==null)return [];
  if(!Array.isArray(conditions))throw errorOf('conditions must be an array','AIGC_MASTER_CONDITIONS_INVALID',400);
  return conditions.map((condition,index)=>{
    requireFields(condition,['conditionKey','owner','resolutionBefore','evidence'],
      'AIGC_MASTER_CONDITION_INVALID');
    return {...condition,index};
  });
};
const deriveGateStatus=(checks,dimensions,conditions)=>{
  const missing=dimensions.filter(key=>!Object.prototype.hasOwnProperty.call(checks||{},key));
  if(missing.length)throw errorOf('Master QA checks are incomplete','AIGC_MASTER_QA_CHECKS_INCOMPLETE',409,{missing});
  const normalized={};
  for(const key of dimensions){
    const status=upper(checks[key]);
    if(!CHECK_STATUSES.has(status))throw errorOf(
      'Master QA check status invalid','AIGC_MASTER_QA_CHECK_STATUS_INVALID',409,{dimension:key,status}
    );
    normalized[key]=status;
  }
  const blocked=dimensions.filter(key=>normalized[key]==='BLOCKED');
  const failed=dimensions.filter(key=>normalized[key]==='FAIL');
  const reasons=[
    ...blocked.map(key=>'BLOCKED:'+key),
    ...failed.map(key=>'FAIL:'+key)
  ];
  const status=blocked.length?'BLOCKED':failed.length?'FAIL':conditions.length?'CONDITIONAL_PASS':'PASS';
  return {status,checks:normalized,reasons};
};

export const evaluateAigcMasterSubGate=async(projectId,gateKey,input={},actorId=null)=>{
  await loadProject(projectId);
  if(!SUB_GATES.has(gateKey))throw errorOf('Unsupported Master sub-gate',
    'AIGC_MASTER_SUB_GATE_INVALID',409,{gateKey});
  requireFields(input,['masterVersionId','checks','evidence'],'INVALID_AIGC_MASTER_SUB_GATE_INPUT');
  const db=getRuntimePool(),master=await loadMaster(projectId,input.masterVersionId,db);
  if(TERMINAL_MASTER_STATUSES.has(master.status)&&master.status!=='LOCKED')
    throw errorOf('Historical Master cannot be re-evaluated','AIGC_MASTER_HISTORICAL_IMMUTABLE',409);

  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  if(gateKey==='G-AIGC-LOCALIZATION-QA'&&!master.localization_enabled){
    const result={projectId,masterVersionId:master.id,gateKey,status:'N_A',
      checks:{},reasonCodes:['LOCALIZATION_NOT_ENABLED'],conditions:[],evidence:input.evidence,asOf};
    await db.execute(
      `INSERT INTO aigc_master_gate_evaluations
        (id,project_id,master_version_id,gate_key,status,checks_json,reason_codes_json,
         conditions_json,evidence_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,master.id,gateKey,'N_A',asJson({}),
       asJson(result.reasonCodes),asJson([]),asJson(input.evidence),asOf,actorId]
    );
    return result;
  }

  const conditions=validateConditions(input.conditions);
  const derived=deriveGateStatus(input.checks,SUB_GATES.get(gateKey),conditions);
  await db.execute(
    `INSERT INTO aigc_master_gate_evaluations
      (id,project_id,master_version_id,gate_key,status,checks_json,reason_codes_json,
       conditions_json,evidence_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,master.id,gateKey,derived.status,asJson(derived.checks),
     asJson(derived.reasons),asJson(conditions),asJson(input.evidence),asOf,actorId]
  );
  return {projectId,masterVersionId:master.id,gateKey,status:derived.status,
    checks:derived.checks,reasonCodes:derived.reasons,conditions,evidence:input.evidence,asOf};
};

const latestGateRows=async(masterVersionId,db)=>{
  const rows=await listRows(db,
    `SELECT e.*
       FROM aigc_master_gate_evaluations e
       JOIN (
         SELECT gate_key,MAX(as_of) max_as_of
           FROM aigc_master_gate_evaluations
          WHERE master_version_id=? AND gate_key<>?
          GROUP BY gate_key
       ) latest ON latest.gate_key=e.gate_key AND latest.max_as_of=e.as_of
      WHERE e.master_version_id=? AND e.gate_key<>?
      ORDER BY e.gate_key,e.created_at DESC`,
    [masterVersionId,MASTER_GATE,masterVersionId,MASTER_GATE]
  );
  const byGate=new Map();
  for(const row of rows)if(!byGate.has(row.gate_key))byGate.set(row.gate_key,row);
  return byGate;
};

export const evaluateAigcMasterGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const masterVersionId=input.masterVersionId||(await latestCandidate(projectId,db))?.id||(await currentMaster(projectId,db))?.id;
  if(!masterVersionId)throw errorOf('Master version is required','AIGC_MASTER_REQUIRED',409);
  const master=await loadMaster(projectId,masterVersionId,db);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');

  const reasons=[],evidence={masterVersionId:master.id};
  const editGate=await evaluateAigcEditGate(projectId,{asOf,persist:false},actorId);
  if(editGate.status!=='PASS')reasons.push('G_AIGC_EDIT_NOT_PASS');
  evidence.editGateStatus=editGate.status;

  const timeline=await currentTimeline(projectId,db);
  if(!timeline||timeline.id!==master.timeline_version_id)reasons.push('AIGC_MASTER_TIMELINE_STALE');
  const [exports]=await db.execute(
    "SELECT * FROM aigc_render_exports WHERE id=? AND timeline_version_id=? AND export_type='EDIT_MASTER' AND status='PASS'",
    [master.source_export_id,master.timeline_version_id]
  );
  if(!exports.length)reasons.push('AIGC_MASTER_SOURCE_EXPORT_STALE');

  const latest=await latestGateRows(master.id,db);
  const required=[
    'G-AIGC-CREATIVE-ACCEPTANCE','G-AIGC-PRODUCTION-QA',
    'G-AIGC-TECHNICAL-QA','G-AIGC-COMPLIANCE'
  ];
  if(master.localization_enabled)required.push('G-AIGC-LOCALIZATION-QA');
  const gateStatuses={},conditions=[];
  for(const gateKey of required){
    const row=latest.get(gateKey);
    if(!row){
      reasons.push('AIGC_MASTER_REQUIRED_GATE_MISSING:'+gateKey);
      gateStatuses[gateKey]='MISSING';
      continue;
    }
    gateStatuses[gateKey]=row.status;
    if(['FAIL','BLOCKED','N_A'].includes(row.status))
      reasons.push('AIGC_MASTER_REQUIRED_GATE_NOT_PASS:'+gateKey+':'+row.status);
    if(row.status==='CONDITIONAL_PASS')
      conditions.push(...(parseJson(row.conditions_json)||[]).map(x=>({...x,gateKey})));
  }
  evidence.requiredGateStatuses=gateStatuses;
  evidence.localizationRequired=Boolean(master.localization_enabled);
  evidence.conditionCount=conditions.length;

  const status=reasons.length?'BLOCKED':conditions.length?'CONDITIONAL_PASS':'PASS';
  await db.execute(
    `INSERT INTO aigc_master_gate_evaluations
      (id,project_id,master_version_id,gate_key,status,checks_json,reason_codes_json,
       conditions_json,evidence_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,master.id,MASTER_GATE,status,asJson(gateStatuses),asJson([...new Set(reasons)]),
     asJson(conditions),asJson(evidence),asOf,actorId]
  );
  return {projectId,masterVersionId:master.id,gateKey:MASTER_GATE,status,
    reasonCodes:[...new Set(reasons)],conditions,evidenceSnapshot:evidence,asOf};
};

export const lockAigcMasterVersion=async(masterVersionId,input={},actorId=null)=>{
  requireFields(input,['approval','evidence'],'INVALID_AIGC_MASTER_LOCK');
  if(upper(input.approval.status)!=='APPROVED'||!nonEmpty(input.approval.approver))
    throw errorOf('Master lock requires explicit approval','AIGC_MASTER_LOCK_APPROVAL_REQUIRED',409);
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_master_versions WHERE id=?',[masterVersionId]);
  const master=rows[0];
  if(!master)throw errorOf('Master version not found','AIGC_MASTER_NOT_FOUND',404);
  if(master.status==='LOCKED'&&master.is_current)return {
    id:master.id,projectId:master.project_id,status:'LOCKED',isCurrent:true,idempotent:true
  };
  if(master.status!=='CANDIDATE')throw errorOf('Only CANDIDATE Master can be locked',
    'AIGC_MASTER_LOCK_STATE_INVALID',409,{status:master.status});

  const [latest]=await db.execute(
    `SELECT * FROM aigc_master_gate_evaluations
      WHERE master_version_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [master.id,MASTER_GATE]
  );
  const gate=latest[0];
  if(!gate||!['PASS','CONDITIONAL_PASS'].includes(gate.status))throw errorOf(
    'G-AIGC-MASTER must PASS or CONDITIONAL_PASS before lock','G_AIGC_MASTER_REQUIRED',409,
    {gateStatus:gate?.status||null}
  );
  if(gate.status==='CONDITIONAL_PASS'&&input.approval.acceptConditions!==true)throw errorOf(
    'Conditional Master requires explicit condition acceptance',
    'AIGC_MASTER_CONDITIONS_ACCEPTANCE_REQUIRED',409
  );

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_master_versions SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND status='LOCKED' AND is_current=TRUE",
      [master.project_id]
    );
    await conn.execute(
      `UPDATE aigc_master_versions
          SET status='LOCKED',is_current=TRUE,lock_approval_json=?,locked_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [asJson(input.approval),master.id]
    );
    await insertTrace(conn,{projectId:master.project_id,sourceType:'MASTER_VERSION',sourceId:master.id,
      targetType:'MASTER_VERSION',targetId:master.id,linkType:'LOCKED_AS_CURRENT',actorId,
      evidence:{approval:input.approval,masterGateStatus:gate.status}});
    await conn.commit();
    return {id:master.id,projectId:master.project_id,status:'LOCKED',isCurrent:true,
      gateStatus:gate.status,idempotent:false};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const getAigcMasteringState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [masters,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_master_versions WHERE project_id=? ORDER BY version_no,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_master_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['母版版本','创作验收','生产与技术质量验收','权利、合规与本地化验收'],
      aggregateGateName:'母版综合门禁',
      gateNames:{
        'G-AIGC-CREATIVE-ACCEPTANCE':'创作验收门禁',
        'G-AIGC-PRODUCTION-QA':'生产质量门禁',
        'G-AIGC-TECHNICAL-QA':'技术质量门禁',
        'G-AIGC-COMPLIANCE':'权利与合规门禁',
        'G-AIGC-LOCALIZATION-QA':'本地化质量门禁',
        'G-AIGC-MASTER':'母版综合门禁'
      }
    },
    masters:masters.map(x=>({
      id:x.id,timelineVersionId:x.timeline_version_id,sourceExportId:x.source_export_id,
      parentMasterVersionId:x.parent_master_version_id||null,masterKey:x.master_key,
      versionNo:Number(x.version_no),title:x.title,contentLocator:parseJson(x.content_locator_json),
      sourceFingerprintSha256:x.source_fingerprint_sha256,masterSpec:parseJson(x.master_spec_json),
      localizationEnabled:Boolean(x.localization_enabled),localizationScope:parseJson(x.localization_scope_json),
      changeRef:parseJson(x.change_ref_json),status:x.status,isCurrent:Boolean(x.is_current),
      lockApproval:parseJson(x.lock_approval_json),lockedAt:x.locked_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,masterVersionId:x.master_version_id,gateKey:x.gate_key,status:x.status,
      checks:parseJson(x.checks_json),reasonCodes:parseJson(x.reason_codes_json),
      conditions:parseJson(x.conditions_json),evidence:parseJson(x.evidence_json),asOf:x.as_of
    }))
  };
};
