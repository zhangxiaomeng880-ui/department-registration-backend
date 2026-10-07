import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-DISTRIBUTION-PACKAGE';
const DERIVATION_TYPE_LIST=[
  'FULL_MASTER','TRAILER','HOOK','SCENE_CLIP','CHARACTER_POV','TOPIC',
  'OST_MV','STILL','GRAPHIC','BTS_MAKING_OF','AI_PROCESS'
];
const DERIVATION_TYPES=new Set(DERIVATION_TYPE_LIST);
const APPLICABILITY=new Set(['REQUIRED','OPTIONAL','N_A']);
const LOCALIZATION_LEVELS=new Set([
  'NONE','SUBTITLE','COPY_LOCALIZATION','DUB','RE_EDIT','RE_COMPOSE'
]);
const SPOILER_RISKS=new Set(['NONE','LOW','MEDIUM','HIGH']);
const QA_DIMENSIONS=[
  'sourceLineage','motherAssetBinding','spoilerRisk','targetFit','platformSpec',
  'formatSpec','localization','cta','rightsCompliance','technicalIntegrity'
];

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
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'Distribution Package requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentMaster=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
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
const validateQa=(qa,localizationLevel)=>{
  if(!qa||typeof qa!=='object')throw errorOf(
    'Distribution QA is required','AIGC_DISTRIBUTION_QA_REQUIRED',409
  );
  const missing=QA_DIMENSIONS.filter(k=>!['PASS','N_A','FAIL','BLOCKED'].includes(upper(qa[k])));
  if(missing.length)throw errorOf(
    'Distribution QA dimensions are incomplete','AIGC_DISTRIBUTION_QA_INCOMPLETE',409,{missing}
  );
  if(localizationLevel!=='NONE'&&upper(qa.localization)!=='PASS')throw errorOf(
    'Localized distribution version requires localization QA PASS',
    'AIGC_DISTRIBUTION_LOCALIZATION_QA_REQUIRED',409
  );
  if(localizationLevel==='NONE'&&!['PASS','N_A'].includes(upper(qa.localization)))throw errorOf(
    'Non-localized distribution version must mark localization PASS or N_A',
    'AIGC_DISTRIBUTION_LOCALIZATION_QA_INVALID',409
  );
};
const qaPass=qa=>QA_DIMENSIONS.every(k=>['PASS','N_A'].includes(upper(qa?.[k])));

export const resolveAigcDistributionProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createAigcDerivationScan=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['masterVersionId','items','evidence'],'INVALID_AIGC_DERIVATION_SCAN');
  if(!Array.isArray(input.items)||!input.items.length)throw errorOf(
    'Derivation scan items are required','AIGC_DERIVATION_SCAN_ITEMS_REQUIRED',409
  );
  const db=getRuntimePool(),master=await currentMaster(projectId,db);
  if(!master||master.id!==input.masterVersionId)throw errorOf(
    'Derivation scan must use current locked Master','AIGC_DERIVATION_CURRENT_MASTER_REQUIRED',409
  );
  const [existing]=await db.execute(
    'SELECT id FROM aigc_derivation_scan_items WHERE project_id=? AND master_version_id=? LIMIT 1',
    [projectId,master.id]
  );
  if(existing.length)throw errorOf(
    'Derivation scan already exists for current Master','AIGC_DERIVATION_SCAN_EXISTS',409
  );

  const byType=new Map();
  for(const item of input.items){
    requireFields(item,['scanKey','derivationType','applicability','rationale','targetHint','evidence'],
      'INVALID_AIGC_DERIVATION_SCAN_ITEM');
    const derivationType=upper(item.derivationType),applicability=upper(item.applicability);
    if(!DERIVATION_TYPES.has(derivationType))throw errorOf(
      'Unsupported derivation type','AIGC_DERIVATION_TYPE_INVALID',409,{derivationType}
    );
    if(!APPLICABILITY.has(applicability))throw errorOf(
      'Derivation applicability must be REQUIRED/OPTIONAL/N_A',
      'AIGC_DERIVATION_APPLICABILITY_INVALID',409,{applicability}
    );
    if(byType.has(derivationType))throw errorOf(
      'Derivation scan type duplicated','AIGC_DERIVATION_SCAN_DUPLICATE',409,{derivationType}
    );
    byType.set(derivationType,{...item,derivationType,applicability});
  }
  const missing=DERIVATION_TYPE_LIST.filter(type=>!byType.has(type));
  if(missing.length)throw errorOf(
    'Derivation scan must explicitly cover every derivation type',
    'AIGC_DERIVATION_SCAN_COVERAGE_INCOMPLETE',409,{missing}
  );

  const conn=await db.getConnection(),created=[];
  try{
    await conn.beginTransaction();
    for(const type of DERIVATION_TYPE_LIST){
      const item=byType.get(type),id=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_derivation_scan_items
          (id,project_id,master_version_id,scan_key,derivation_type,applicability,rationale,
           target_hint_json,evidence_json,created_by_identity_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,master.id,item.scanKey,type,item.applicability,item.rationale,
         asJson(item.targetHint),asJson(item.evidence),actorId]
      );
      await insertTrace(conn,{projectId,sourceType:'MASTER_VERSION',sourceId:master.id,
        targetType:'DERIVATION_SCAN_ITEM',targetId:id,linkType:'SCANS_AS',actorId,
        evidence:{derivationType:type,applicability:item.applicability}});
      created.push({id,scanKey:item.scanKey,derivationType:type,applicability:item.applicability});
    }
    await conn.commit();
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
  return {
    projectId,masterVersionId:master.id,scanCount:created.length,
    requiredCount:created.filter(x=>x.applicability==='REQUIRED').length,
    optionalCount:created.filter(x=>x.applicability==='OPTIONAL').length,
    notApplicableCount:created.filter(x=>x.applicability==='N_A').length,
    items:created,evidence:input.evidence,status:'FROZEN'
  };
};
export const resolveAigcDistributionPackageScope=async packageId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT d.project_id,p.workspace_id
       FROM aigc_distribution_packages d JOIN projects p ON p.id=d.project_id
      WHERE d.id=?`,[packageId]
  );
  if(!rows.length)throw errorOf('Distribution package not found','AIGC_DISTRIBUTION_PACKAGE_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcDistributionVersion=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'distributionKey','versionNo','derivationType','masterVersionId','scanItemId','motherAsset',
    'spoilerRisk','target','platform','format','localizationLevel','localization',
    'cta','qa','rights','contentLocator','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_VERSION');

  const derivationType=upper(input.derivationType);
  const localizationLevel=upper(input.localizationLevel);
  const spoilerRisk=upper(input.spoilerRisk);
  if(!DERIVATION_TYPES.has(derivationType))throw errorOf(
    'Unsupported derivation type','AIGC_DERIVATION_TYPE_INVALID',409,{derivationType}
  );
  if(!LOCALIZATION_LEVELS.has(localizationLevel))throw errorOf(
    'Unsupported localization level','AIGC_LOCALIZATION_LEVEL_INVALID',409,{localizationLevel}
  );
  if(!SPOILER_RISKS.has(spoilerRisk))throw errorOf(
    'Spoiler risk must be NONE/LOW/MEDIUM/HIGH','AIGC_SPOILER_RISK_INVALID',409,{spoilerRisk}
  );
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Distribution versionNo must be positive integer','AIGC_DISTRIBUTION_VERSION_INVALID',409
  );
  validateQa(input.qa,localizationLevel);

  const db=getRuntimePool();
  const master=await currentMaster(projectId,db);
  if(!master||master.id!==input.masterVersionId)throw errorOf(
    'Distribution version must derive from current locked Master',
    'AIGC_DISTRIBUTION_CURRENT_MASTER_REQUIRED',409,
    {currentMasterVersionId:master?.id||null,providedMasterVersionId:input.masterVersionId}
  );
  if(input.motherAsset?.masterVersionId!==master.id||
     input.motherAsset?.sourceExportId!==master.source_export_id)
    throw errorOf(
      'Mother Asset must bind exact current Master and source export',
      'AIGC_DISTRIBUTION_MOTHER_ASSET_INVALID',409
    );

  const [scanRows]=await db.execute(
    'SELECT * FROM aigc_derivation_scan_items WHERE id=? AND project_id=? AND master_version_id=?',
    [input.scanItemId,projectId,master.id]
  );
  const scan=scanRows[0];
  if(!scan||scan.derivation_type!==derivationType)throw errorOf(
    'Distribution version must bind matching derivation scan item',
    'AIGC_DERIVATION_SCAN_BINDING_INVALID',409,{scanItemId:input.scanItemId,derivationType}
  );
  if(scan.applicability==='N_A')throw errorOf(
    'N_A derivation scan item cannot produce a content derivative',
    'AIGC_DERIVATION_SCAN_NA_FORBIDDEN',409,{scanItemId:scan.id,derivationType}
  );

  if(localizationLevel==='NONE'){
    if(input.localization?.enabled===true)throw errorOf(
      'Localization NONE cannot be enabled','AIGC_LOCALIZATION_CONTRACT_INVALID',409
    );
  }else{
    if(input.localization?.enabled!==true||!nonEmpty(input.localization?.language))
      throw errorOf('Localized version requires enabled localization and language',
        'AIGC_LOCALIZATION_CONTRACT_INVALID',409);
  }

  let parent=null;
  if(input.parentDistributionVersionId){
    const [rows]=await db.execute(
      'SELECT * FROM aigc_content_derivation_versions WHERE id=? AND project_id=?',
      [input.parentDistributionVersionId,projectId]
    );
    parent=rows[0];
    if(!parent||parent.distribution_key!==input.distributionKey||versionNo<=Number(parent.version_no))
      throw errorOf('Distribution revision parent/version invalid',
        'AIGC_DISTRIBUTION_PARENT_INVALID',409);
    if(upper(input.changeRef?.status)!=='APPROVED'||!nonEmpty(input.changeRef?.reference))
      throw errorOf('Distribution revision requires approved Change/Decision',
        'AIGC_DISTRIBUTION_CHANGE_DECISION_REQUIRED',409);
  }

  const status=qaPass(input.qa)?'READY':'BLOCKED';
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_content_derivation_versions
      (id,project_id,master_version_id,scan_item_id,parent_distribution_version_id,distribution_key,version_no,
       derivation_type,mother_asset_json,spoiler_risk,target_json,platform_json,format_json,
       localization_level,localization_json,cta_json,qa_json,rights_json,content_locator_json,
       status,change_ref_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,master.id,scan.id,input.parentDistributionVersionId||null,input.distributionKey,versionNo,
      derivationType,asJson(input.motherAsset),spoilerRisk,asJson(input.target),asJson(input.platform),
      asJson(input.format),localizationLevel,asJson(input.localization),asJson(input.cta),asJson(input.qa),
      asJson(input.rights),asJson(input.contentLocator),status,input.changeRef?asJson(input.changeRef):null,
      asJson(input.evidence),actorId
    ]
  );
  await insertTrace(db,{projectId,sourceType:'MASTER_VERSION',sourceId:master.id,
    targetType:'DISTRIBUTION_VERSION',targetId:id,linkType:'DERIVES_AS',actorId,
    evidence:{distributionKey:input.distributionKey,versionNo,derivationType,localizationLevel}});
  return {id,projectId,masterVersionId:master.id,scanItemId:scan.id,distributionKey:input.distributionKey,
    versionNo,derivationType,localizationLevel,spoilerRisk,status};
};

export const createAigcDistributionPackage=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'packageKey','versionNo','title','masterVersionId','distributionVersionIds','packageIntent','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_PACKAGE');
  if(!Array.isArray(input.distributionVersionIds)||!input.distributionVersionIds.length)
    throw errorOf('Distribution package needs at least one version',
      'AIGC_DISTRIBUTION_PACKAGE_ITEMS_REQUIRED',409);
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Package versionNo must be positive integer','AIGC_DISTRIBUTION_PACKAGE_VERSION_INVALID',409
  );
  const db=getRuntimePool(),master=await currentMaster(projectId,db);
  if(!master||master.id!==input.masterVersionId)throw errorOf(
    'Distribution package must bind current locked Master',
    'AIGC_DISTRIBUTION_CURRENT_MASTER_REQUIRED',409
  );

  const ids=[...new Set(input.distributionVersionIds)];
  const [versions]=await db.query(
    `SELECT * FROM aigc_content_derivation_versions
      WHERE project_id=? AND id IN (${ids.map(()=>'?').join(',')})`,
    [projectId,...ids]
  );
  if(versions.length!==ids.length||versions.some(x=>x.master_version_id!==master.id))
    throw errorOf('Package items must belong to the same current Master',
      'AIGC_DISTRIBUTION_PACKAGE_ITEM_SCOPE_INVALID',409);

  const [candidates]=await db.execute(
    "SELECT id FROM aigc_distribution_packages WHERE project_id=? AND status='CANDIDATE' LIMIT 1",
    [projectId]
  );
  if(candidates.length)throw errorOf(
    'Resolve/freeze current package candidate before creating another',
    'AIGC_DISTRIBUTION_PACKAGE_CANDIDATE_EXISTS',409
  );
  const [currentRows]=await db.execute(
    "SELECT * FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  const current=currentRows[0]||null;
  if(current){
    if(input.parentPackageId!==current.id)throw errorOf(
      'Package revision must derive from current frozen package',
      'AIGC_DISTRIBUTION_PACKAGE_PARENT_REQUIRED',409,{currentPackageId:current.id}
    );
    if(upper(input.changeRef?.status)!=='APPROVED'||!nonEmpty(input.changeRef?.reference))
      throw errorOf('Package revision requires approved Change/Decision',
        'AIGC_DISTRIBUTION_PACKAGE_CHANGE_REQUIRED',409);
  }else if(input.parentPackageId){
    throw errorOf('Initial package cannot have parent',
      'AIGC_DISTRIBUTION_INITIAL_PARENT_FORBIDDEN',409);
  }

  const conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO aigc_distribution_packages
        (id,project_id,master_version_id,parent_package_id,package_key,version_no,title,
         package_intent_json,change_ref_json,status,is_current,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,?,?)`,
      [id,projectId,master.id,input.parentPackageId||null,input.packageKey,versionNo,input.title,
       asJson(input.packageIntent),input.changeRef?asJson(input.changeRef):null,asJson(input.evidence),actorId]
    );
    for(let i=0;i<ids.length;i++){
      await conn.execute(
        `INSERT INTO aigc_distribution_package_items
          (id,package_id,distribution_version_id,sequence_no,required,evidence_json)
         VALUES (?,?,?,?,?,?)`,
        [randomUUID(),id,ids[i],i+1,input.optionalDistributionVersionIds?.includes(ids[i])?0:1,
         asJson({source:'M28.13 package assembly',sequenceNo:i+1})]
      );
      await insertTrace(conn,{projectId,sourceType:'DISTRIBUTION_VERSION',sourceId:ids[i],
        targetType:'DISTRIBUTION_PACKAGE',targetId:id,linkType:'PACKAGED_IN',actorId,
        evidence:{sequenceNo:i+1,required:!input.optionalDistributionVersionIds?.includes(ids[i])}});
    }
    await conn.commit();
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
  return {id,projectId,masterVersionId:master.id,packageKey:input.packageKey,versionNo,
    itemCount:ids.length,status:'CANDIDATE',isCurrent:false};
};

export const evaluateAigcDistributionPackageGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[],evidence={};
  let packageId=input.packageId;
  if(!packageId){
    const [rows]=await db.execute(
      "SELECT id FROM aigc_distribution_packages WHERE project_id=? AND status='CANDIDATE' ORDER BY version_no DESC,created_at DESC LIMIT 1",
      [projectId]
    );
    packageId=rows[0]?.id||null;
  }
  if(!packageId)throw errorOf('Distribution package is required',
    'AIGC_DISTRIBUTION_PACKAGE_REQUIRED',409);
  const [packages]=await db.execute(
    'SELECT * FROM aigc_distribution_packages WHERE id=? AND project_id=?',[packageId,projectId]
  );
  const pkg=packages[0];
  if(!pkg)throw errorOf('Distribution package not found','AIGC_DISTRIBUTION_PACKAGE_NOT_FOUND',404);

  const master=await currentMaster(projectId,db);
  if(!master||pkg.master_version_id!==master.id)reasons.push('AIGC_DISTRIBUTION_MASTER_STALE');

  const items=await listRows(db,
    `SELECT i.id item_id,i.sequence_no,i.required,v.*
       FROM aigc_distribution_package_items i
       JOIN aigc_content_derivation_versions v ON v.id=i.distribution_version_id
      WHERE i.package_id=? ORDER BY i.sequence_no`,[pkg.id]
  );
  const scanItems=master?await listRows(db,
    'SELECT * FROM aigc_derivation_scan_items WHERE project_id=? AND master_version_id=? ORDER BY derivation_type',
    [projectId,master.id]
  ):[];
  const requiredScans=scanItems.filter(x=>x.applicability==='REQUIRED');
  const optionalScans=scanItems.filter(x=>x.applicability==='OPTIONAL');
  const notApplicableScans=scanItems.filter(x=>x.applicability==='N_A');
  const packageScanIds=new Set(items.map(x=>x.scan_item_id));
  const requiredScanMissing=requiredScans.filter(x=>!packageScanIds.has(x.id));
  if(requiredScanMissing.length)reasons.push('AIGC_DISTRIBUTION_REQUIRED_SCAN_MISSING');
  const naIncluded=items.filter(x=>notApplicableScans.some(s=>s.id===x.scan_item_id));
  if(naIncluded.length)reasons.push('AIGC_DISTRIBUTION_NA_DERIVATION_INCLUDED');
  if(!items.length)reasons.push('AIGC_DISTRIBUTION_PACKAGE_EMPTY');
  const required=items.filter(x=>Boolean(x.required));
  const blocked=required.filter(x=>x.status!=='READY');
  if(blocked.length)reasons.push('AIGC_DISTRIBUTION_REQUIRED_VERSION_NOT_READY');

  const lineageInvalid=required.filter(x=>{
    const mother=parseJson(x.mother_asset_json)||{};
    return !master||x.master_version_id!==master.id||
      mother.masterVersionId!==master.id||mother.sourceExportId!==master.source_export_id;
  });
  if(lineageInvalid.length)reasons.push('AIGC_DISTRIBUTION_MOTHER_LINEAGE_INVALID');

  const contractInvalid=required.filter(x=>
    !nonEmpty(parseJson(x.target_json))||!nonEmpty(parseJson(x.platform_json))||
    !nonEmpty(parseJson(x.format_json))||!nonEmpty(parseJson(x.cta_json))||
    !nonEmpty(parseJson(x.rights_json))||!nonEmpty(parseJson(x.content_locator_json))||
    !SPOILER_RISKS.has(x.spoiler_risk)||!DERIVATION_TYPES.has(x.derivation_type)||
    !LOCALIZATION_LEVELS.has(x.localization_level)
  );
  if(contractInvalid.length)reasons.push('AIGC_DISTRIBUTION_CONTRACT_INCOMPLETE');

  const qaInvalid=required.filter(x=>!qaPass(parseJson(x.qa_json)||{}));
  if(qaInvalid.length)reasons.push('AIGC_DISTRIBUTION_QA_NOT_PASS');

  const localizationInvalid=required.filter(x=>{
    const loc=parseJson(x.localization_json)||{},qa=parseJson(x.qa_json)||{};
    return x.localization_level==='NONE'
      ?loc.enabled===true
      :loc.enabled!==true||!nonEmpty(loc.language)||upper(qa.localization)!=='PASS';
  });
  if(localizationInvalid.length)reasons.push('AIGC_DISTRIBUTION_LOCALIZATION_INVALID');

  evidence.masterVersionId=master?.id||null;
  evidence.packageId=pkg.id;
  evidence.scanCount=scanItems.length;
  evidence.requiredScanCount=requiredScans.length;
  evidence.optionalScanCount=optionalScans.length;
  evidence.notApplicableScanCount=notApplicableScans.length;
  evidence.requiredScanMissingTypes=requiredScanMissing.map(x=>x.derivation_type);
  evidence.naIncludedVersionIds=naIncluded.map(x=>x.id);
  evidence.itemCount=items.length;
  evidence.requiredItemCount=required.length;
  evidence.readyRequiredCount=required.filter(x=>x.status==='READY').length;
  evidence.blockedVersionIds=blocked.map(x=>x.id);
  evidence.lineageInvalidVersionIds=lineageInvalid.map(x=>x.id);
  evidence.contractInvalidVersionIds=contractInvalid.map(x=>x.id);
  evidence.qaInvalidVersionIds=qaInvalid.map(x=>x.id);
  evidence.localizationInvalidVersionIds=localizationInvalid.map(x=>x.id);
  evidence.derivationTypes=[...new Set(items.map(x=>x.derivation_type))];
  evidence.localizationLevels=[...new Set(items.map(x=>x.localization_level))];
  evidence.readyForReleasePlanning=reasons.length===0;

  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const result={projectId,packageId:pkg.id,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m2813_gate_evaluations
      (id,project_id,package_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,pkg.id,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const freezeAigcDistributionPackage=async(packageId,input={},actorId=null)=>{
  requireFields(input,['evidence'],'INVALID_AIGC_DISTRIBUTION_PACKAGE_FREEZE');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_distribution_packages WHERE id=?',[packageId]);
  const pkg=rows[0];
  if(!pkg)throw errorOf('Distribution package not found','AIGC_DISTRIBUTION_PACKAGE_NOT_FOUND',404);
  if(pkg.status==='FROZEN'&&pkg.is_current)return {
    id:pkg.id,projectId:pkg.project_id,status:'FROZEN',isCurrent:true,idempotent:true
  };
  if(pkg.status!=='CANDIDATE')throw errorOf(
    'Only CANDIDATE package can be frozen','AIGC_DISTRIBUTION_PACKAGE_STATE_INVALID',409,{status:pkg.status}
  );
  const [gates]=await db.execute(
    `SELECT * FROM aigc_m2813_gate_evaluations
      WHERE package_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [pkg.id,GATE]
  );
  if(!gates.length||gates[0].status!=='PASS')throw errorOf(
    'G-AIGC-DISTRIBUTION-PACKAGE must PASS before freeze',
    'G_AIGC_DISTRIBUTION_PACKAGE_REQUIRED',409
  );
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_distribution_packages SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND status='FROZEN' AND is_current=TRUE",
      [pkg.project_id]
    );
    await conn.execute(
      `UPDATE aigc_distribution_packages
          SET status='FROZEN',is_current=TRUE,approval_json=?,frozen_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [asJson(input.approval||{mode:'GATE_AUTO_FREEZE'}),pkg.id]
    );
    await insertTrace(conn,{projectId:pkg.project_id,sourceType:'DISTRIBUTION_PACKAGE',sourceId:pkg.id,
      targetType:'DISTRIBUTION_PACKAGE',targetId:pkg.id,linkType:'FROZEN_AS_CURRENT',actorId,
      evidence:input.evidence});
    await conn.commit();
    return {id:pkg.id,projectId:pkg.project_id,status:'FROZEN',isCurrent:true,idempotent:false};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const getAigcDistributionPackageState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [scans,versions,packages,items,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_derivation_scan_items WHERE project_id=? ORDER BY master_version_id,derivation_type',[projectId]),
    listRows(db,'SELECT * FROM aigc_content_derivation_versions WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_distribution_packages WHERE project_id=? ORDER BY version_no,id',[projectId]),
    listRows(db,
      `SELECT i.*,p.project_id FROM aigc_distribution_package_items i
        JOIN aigc_distribution_packages p ON p.id=i.package_id
       WHERE p.project_id=? ORDER BY i.package_id,i.sequence_no`,[projectId]),
    listRows(db,'SELECT * FROM aigc_m2813_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['衍生扫描','内容衍生版本','本地化版本','发行素材包'],
      gateName:'发行素材包门禁',
      localizationLevels:{
        NONE:'不本地化',SUBTITLE:'字幕本地化',COPY_LOCALIZATION:'文案本地化',
        DUB:'配音本地化',RE_EDIT:'重新剪辑',RE_COMPOSE:'重新编曲 / 重构'
      }
    },
    scans:scans.map(x=>({
      id:x.id,masterVersionId:x.master_version_id,scanKey:x.scan_key,
      derivationType:x.derivation_type,applicability:x.applicability,rationale:x.rationale,
      targetHint:parseJson(x.target_hint_json)
    })),
    versions:versions.map(x=>({
      id:x.id,masterVersionId:x.master_version_id,scanItemId:x.scan_item_id,
      parentDistributionVersionId:x.parent_distribution_version_id||null,
      distributionKey:x.distribution_key,versionNo:Number(x.version_no),derivationType:x.derivation_type,
      motherAsset:parseJson(x.mother_asset_json),spoilerRisk:x.spoiler_risk,target:parseJson(x.target_json),
      platform:parseJson(x.platform_json),format:parseJson(x.format_json),
      localizationLevel:x.localization_level,localization:parseJson(x.localization_json),
      cta:parseJson(x.cta_json),qa:parseJson(x.qa_json),rights:parseJson(x.rights_json),
      contentLocator:parseJson(x.content_locator_json),status:x.status,changeRef:parseJson(x.change_ref_json)
    })),
    packages:packages.map(x=>({
      id:x.id,masterVersionId:x.master_version_id,parentPackageId:x.parent_package_id||null,
      packageKey:x.package_key,versionNo:Number(x.version_no),title:x.title,
      packageIntent:parseJson(x.package_intent_json),changeRef:parseJson(x.change_ref_json),
      status:x.status,isCurrent:Boolean(x.is_current),
      approval:parseJson(x.approval_json),frozenAt:x.frozen_at,
      items:items.filter(i=>i.package_id===x.id).map(i=>({
        distributionVersionId:i.distribution_version_id,sequenceNo:Number(i.sequence_no),required:Boolean(i.required)
      }))
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,packageId:x.package_id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
