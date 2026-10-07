import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcFormatGate } from './aigc-format-strategy.mjs';

const GATE='G-AIGC-ASSET';
const LIBRARY_SCOPES=new Set(['PROJECT','WORKSPACE']);
const ASSET_TYPES=new Set([
  'IDENTITY','LOOK','COSTUME','SCENE','LOCATION','PROP','UI','GRAPHIC','ACTION','POSE',
  'EXPRESSION','PERFORMANCE','VOICE','MUSIC','OST','SFX','AMBIENCE','STYLE','COMPOSITION_REFERENCE'
]);
const ASSET_STATES=new Set([
  'DRAFT','READY','GENERATING','CANDIDATE','SELECTED','PASS','CURRENT','LOCKED','FROZEN',
  'BLOCKED','REJECTED','DEPRECATED'
]);
const REFERENCE_ROLES=new Set([
  'IDENTITY','LOOK','SCENE','STYLE','COMPOSITION','MOTION','FIRST_FRAME','LAST_FRAME','AUDIO','PERFORMANCE'
]);
const BINDING_TYPES=new Set(['CURRENT_ASSET','CALL_SHEET']);
const FINAL_ASSET_STATES=new Set(['PASS','CURRENT','LOCKED','FROZEN']);
const SHA64=/^[0-9a-f]{64}$/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{if(v==null)return false;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return Object.keys(v).length>0;return String(v).trim().length>0;};
const requireFields=(input,fields,code)=>{const missing=fields.filter(k=>!nonEmpty(input[k]));if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});};
const requireObject=(obj,fields,code,details={})=>{
  if(!obj||typeof obj!=='object')throw errorOf('Structured object required',code,409,details);
  const missing=fields.filter(k=>obj[k]===undefined||obj[k]===null||obj[k]==='');
  if(missing.length)throw errorOf('Structured fields missing',code,409,{...details,missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf('AIGC Asset requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409);
  return rows[0];
};
const currentBreakdown=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",[projectId]
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

export const resolveAigcAssetProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createAigcAssetLibrary=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,['libraryKey','displayName','libraryScope','permissionPolicy','rightsPolicy','usageScope','versionPolicy','evidence'],'INVALID_AIGC_ASSET_LIBRARY');
  const scope=upper(input.libraryScope);
  if(!LIBRARY_SCOPES.has(scope))throw errorOf('Unsupported asset library scope','AIGC_ASSET_LIBRARY_SCOPE_INVALID',409,{scope});
  if(scope==='WORKSPACE'&&input.permissionPolicy.crossProjectReuse!==true)
    throw errorOf('Workspace library must explicitly allow governed cross-project reuse','AIGC_WORKSPACE_REUSE_POLICY_REQUIRED',409);
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_asset_libraries
      (id,workspace_id,owner_project_id,library_key,display_name,library_scope,permission_policy_json,
       rights_policy_json,usage_scope_json,version_policy_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?, ?,?,?,?,'ACTIVE',?,?)`,
    [id,project.workspace_id,projectId,input.libraryKey,input.displayName,scope,asJson(input.permissionPolicy),
     asJson(input.rightsPolicy),asJson(input.usageScope),asJson(input.versionPolicy),asJson(input.evidence),actorId]
  );
  return {id,projectId,workspaceId:project.workspace_id,libraryKey:input.libraryKey,displayName:input.displayName,libraryScope:scope,status:'ACTIVE'};
};

const loadLibrary=async(db,libraryId)=>{
  const [rows]=await db.execute('SELECT * FROM aigc_asset_libraries WHERE id=?',[libraryId]);
  if(!rows.length)throw errorOf('Asset library not found','AIGC_ASSET_LIBRARY_NOT_FOUND',404);
  return rows[0];
};
const loadAsset=async(db,assetId)=>{
  const [rows]=await db.execute('SELECT * FROM aigc_assets WHERE id=?',[assetId]);
  if(!rows.length)throw errorOf('Asset not found','AIGC_ASSET_NOT_FOUND',404);
  return rows[0];
};
const loadAssetVersion=async(db,versionId)=>{
  const [rows]=await db.execute(
    `SELECT v.*,a.library_id,a.asset_type,a.asset_key,l.library_scope,l.permission_policy_json,l.rights_policy_json,l.usage_scope_json
       FROM aigc_asset_versions v
       JOIN aigc_assets a ON a.id=v.asset_id
       JOIN aigc_asset_libraries l ON l.id=a.library_id
      WHERE v.id=?`,[versionId]
  );
  if(!rows.length)throw errorOf('Asset version not found','AIGC_ASSET_VERSION_NOT_FOUND',404);
  return rows[0];
};
const assertVersionAccessible=async(db,project,version)=>{
  if(version.workspace_id!==project.workspace_id)throw errorOf('Asset version is outside workspace','AIGC_ASSET_WORKSPACE_MISMATCH',409);
  if(version.owner_project_id===project.id)return;
  if(version.library_scope!=='WORKSPACE')throw errorOf('Cross-project asset requires workspace library','AIGC_CROSS_PROJECT_LIBRARY_REQUIRED',409);
  const permission=parseJson(version.permission_policy_json)||{},rights=parseJson(version.rights_policy_json)||{},usage=parseJson(version.usage_scope_json)||{};
  if(permission.crossProjectReuse!==true)throw errorOf('Workspace asset reuse permission denied','AIGC_ASSET_REUSE_PERMISSION_DENIED',409);
  if(rights.reuseAllowed===false)throw errorOf('Workspace asset rights forbid reuse','AIGC_ASSET_REUSE_RIGHTS_DENIED',409);
  if(Array.isArray(usage.allowedProjectIds)&&usage.allowedProjectIds.length&&!usage.allowedProjectIds.includes(project.id))
    throw errorOf('Workspace asset usage scope excludes project','AIGC_ASSET_USAGE_SCOPE_DENIED',409);
};

export const createAigcAsset=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,['libraryId','assetKey','assetType','displayName','purpose','sourceOfTruth','upstreamSource','onlyVariable','rights','usageScope','evidence'],'INVALID_AIGC_ASSET');
  const type=upper(input.assetType),state=upper(input.status||'DRAFT');
  if(!ASSET_TYPES.has(type))throw errorOf('Unsupported asset type','AIGC_ASSET_TYPE_INVALID',409,{type});
  if(!ASSET_STATES.has(state))throw errorOf('Unsupported asset state','AIGC_ASSET_STATE_INVALID',409,{state});
  const db=getRuntimePool(),library=await loadLibrary(db,input.libraryId);
  if(library.workspace_id!==project.workspace_id)throw errorOf('Asset library workspace mismatch','AIGC_ASSET_LIBRARY_WORKSPACE_MISMATCH',409);
  if(library.library_scope==='PROJECT'&&library.owner_project_id!==projectId)
    throw errorOf('Project library belongs to another project','AIGC_PROJECT_LIBRARY_OWNER_MISMATCH',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_assets
      (id,workspace_id,owner_project_id,library_id,asset_key,asset_type,display_name,purpose_json,source_of_truth_json,
       upstream_source_json,immutable,only_variable_json,rights_json,usage_scope_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,project.workspace_id,projectId,library.id,input.assetKey,type,input.displayName,asJson(input.purpose),
     asJson(input.sourceOfTruth),asJson(input.upstreamSource),input.immutable===true?1:0,asJson(input.onlyVariable),
     asJson(input.rights),asJson(input.usageScope),state,asJson(input.evidence),actorId]
  );
  return {id,projectId,libraryId:library.id,assetKey:input.assetKey,assetType:type,displayName:input.displayName,status:state,immutable:input.immutable===true};
};

export const createAigcAssetVersion=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,['assetId','versionKey','versionNo','contentLocator','outputSpec','requiredViews','fingerprintSha256','state','qaResult','evidence'],'INVALID_AIGC_ASSET_VERSION');
  const state=upper(input.state),versionNo=Number(input.versionNo);
  if(!ASSET_STATES.has(state))throw errorOf('Unsupported asset version state','AIGC_ASSET_STATE_INVALID',409,{state});
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf('Asset versionNo must be positive integer','AIGC_ASSET_VERSION_NO_INVALID',409);
  if(!SHA64.test(String(input.fingerprintSha256)))throw errorOf('Asset fingerprint must be SHA-256','AIGC_ASSET_FINGERPRINT_INVALID',409);
  if(FINAL_ASSET_STATES.has(state)&&upper(input.qaResult.status)!=='PASS')
    throw errorOf('Final asset version requires QA PASS','AIGC_ASSET_QA_PASS_REQUIRED',409,{state});
  const db=getRuntimePool(),asset=await loadAsset(db,input.assetId),library=await loadLibrary(db,asset.library_id);
  if(asset.workspace_id!==project.workspace_id)throw errorOf('Asset workspace mismatch','AIGC_ASSET_WORKSPACE_MISMATCH',409);
  if(asset.owner_project_id!==projectId&&library.library_scope!=='WORKSPACE')
    throw errorOf('Asset cannot be versioned from another project library','AIGC_ASSET_VERSION_OWNER_INVALID',409);
  if(input.parentAssetVersionId){
    const parent=await loadAssetVersion(db,input.parentAssetVersionId);
    if(parent.asset_id!==asset.id)throw errorOf('Parent version belongs to another asset','AIGC_ASSET_PARENT_VERSION_INVALID',409);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_asset_versions
      (id,workspace_id,owner_project_id,asset_id,version_key,version_no,content_locator_json,output_spec_json,
       required_views_json,fingerprint_sha256,state,qa_result_json,parent_asset_version_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,project.workspace_id,asset.owner_project_id,asset.id,input.versionKey,versionNo,asJson(input.contentLocator),
     asJson(input.outputSpec),asJson(input.requiredViews),String(input.fingerprintSha256).toLowerCase(),state,
     asJson(input.qaResult),input.parentAssetVersionId||null,asJson(input.evidence),actorId]
  );
  if(FINAL_ASSET_STATES.has(state))await db.execute('UPDATE aigc_assets SET status=? WHERE id=?',[state,asset.id]);
  await insertTrace(db,{projectId,sourceType:'ASSET',sourceId:asset.id,targetType:'ASSET_VERSION',targetId:id,linkType:'VERSIONED_AS',actorId,evidence:{state,versionNo}});
  return {id,projectId,assetId:asset.id,versionKey:input.versionKey,versionNo,state};
};

export const createAigcAssetCallSheet=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,[
    'assetRequirementId','callSheetKey','assetType','purpose','sourceOfTruth','upstreamSource','onlyVariable',
    'outputSpec','requiredViews','referenceRoles','forbidden','qaGate','failAction','targetPath',
    'budgetGuardrail','preflight','references','evidence'
  ],'INVALID_AIGC_ASSET_CALL_SHEET');
  const assetType=upper(input.assetType);
  if(!ASSET_TYPES.has(assetType))throw errorOf('Unsupported Call Sheet asset type','AIGC_ASSET_TYPE_INVALID',409,{assetType});
  if(!Array.isArray(input.referenceRoles)||!input.referenceRoles.length)
    throw errorOf('Call Sheet requires structured Reference Role','AIGC_REFERENCE_ROLE_REQUIRED',409);
  const roles=[...new Set(input.referenceRoles.map(upper))];
  const invalidRoles=roles.filter(x=>!REFERENCE_ROLES.has(x));
  if(invalidRoles.length)throw errorOf('Unsupported Reference Role','AIGC_REFERENCE_ROLE_INVALID',409,{roles:invalidRoles});
  requireObject(input.preflight,['status','provider','modelToolVersion','supportedReferenceRoles'],'AIGC_ASSET_PREFLIGHT_INCOMPLETE');
  if(!Array.isArray(input.preflight.supportedReferenceRoles))
    throw errorOf('Preflight supportedReferenceRoles must be array','AIGC_ASSET_PREFLIGHT_INCOMPLETE',409);
  if(!Array.isArray(input.references))throw errorOf('Call Sheet references must be array','AIGC_REFERENCE_BINDINGS_INVALID',409);
  const supported=new Set(input.preflight.supportedReferenceRoles.map(upper));
  const unsupported=roles.filter(x=>!supported.has(x));
  let status=upper(input.preflight.status)==='PASS'&&unsupported.length===0?'READY':'BLOCKED';

  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const formatGate=await evaluateAigcFormatGate(projectId,{persist:false},actorId);
  if(formatGate.status!=='PASS')throw errorOf('G-AIGC-FORMAT must PASS before Asset Call Sheet','G_AIGC_FORMAT_REQUIRED',409,{reasonCodes:formatGate.reasonCodes});
  const [reqRows]=await db.execute(
    'SELECT * FROM aigc_shot_asset_requirements WHERE id=? AND project_id=? AND breakdown_plan_id=?',
    [input.assetRequirementId,projectId,breakdown.id]
  );
  if(!reqRows.length)throw errorOf('Asset requirement is not in current Breakdown','AIGC_ASSET_REQUIREMENT_STALE',409);
  const requirement=reqRows[0];
  if(assetType!==upper(requirement.requirement_type)&&!(assetType==='STYLE'&&upper(requirement.requirement_type)==='PERFORMANCE'))
    throw errorOf('Call Sheet asset type does not match requirement','AIGC_CALL_SHEET_TYPE_MISMATCH',409,
      {requirementType:requirement.requirement_type,assetType});

  let asset=null;
  if(input.assetId){
    asset=await loadAsset(db,input.assetId);
    if(asset.workspace_id!==project.workspace_id)throw errorOf('Call Sheet asset workspace mismatch','AIGC_ASSET_WORKSPACE_MISMATCH',409);
  }

  const normalizedRefs=[];
  for(const ref of input.references){
    requireFields(ref,['assetVersionId','referenceRole','compatibility','evidence'],'INVALID_AIGC_REFERENCE_BINDING');
    const role=upper(ref.referenceRole);
    if(!REFERENCE_ROLES.has(role))throw errorOf('Unsupported Reference Role','AIGC_REFERENCE_ROLE_INVALID',409,{role});
    const version=await loadAssetVersion(db,ref.assetVersionId);
    await assertVersionAccessible(db,project,version);
    if(!FINAL_ASSET_STATES.has(version.state)){
      if(ref.required!==false)status='BLOCKED';
    }
    if(!roles.includes(role))throw errorOf('Reference binding role not declared by Call Sheet','AIGC_REFERENCE_ROLE_NOT_DECLARED',409,{role});
    normalizedRefs.push({...ref,referenceRole:role,version});
  }
  const providedRoles=new Set(normalizedRefs.map(x=>x.referenceRole));
  const missingRequiredRoles=roles.filter(role=>!providedRoles.has(role));
  if(missingRequiredRoles.length)status='BLOCKED';

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_asset_call_sheets
      (id,project_id,breakdown_plan_id,asset_requirement_id,asset_id,call_sheet_key,asset_type,purpose_json,
       source_of_truth_json,upstream_source_json,immutable,only_variable_json,output_spec_json,required_views_json,
       reference_roles_json,forbidden_json,qa_gate_json,fail_action_json,target_path,budget_guardrail_json,
       preflight_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,breakdown.id,requirement.id,asset?.id||null,input.callSheetKey,assetType,asJson(input.purpose),
     asJson(input.sourceOfTruth),asJson(input.upstreamSource),input.immutable===true?1:0,asJson(input.onlyVariable),
     asJson(input.outputSpec),asJson(input.requiredViews),asJson(roles),asJson(input.forbidden),asJson(input.qaGate),
     asJson(input.failAction),input.targetPath,asJson(input.budgetGuardrail),asJson({...input.preflight,unsupportedRoles:unsupported,missingRequiredRoles}),
     status,asJson(input.evidence),actorId]
  );
  for(const ref of normalizedRefs){
    await db.execute(
      `INSERT INTO aigc_call_sheet_reference_bindings
        (id,project_id,call_sheet_id,reference_asset_version_id,reference_role,required,compatibility_json,status,evidence_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,id,ref.assetVersionId,ref.referenceRole,ref.required===false?0:1,
       asJson(ref.compatibility),FINAL_ASSET_STATES.has(ref.version.state)?'READY':'BLOCKED',asJson(ref.evidence)]
    );
    await insertTrace(db,{projectId,sourceType:'ASSET_VERSION',sourceId:ref.assetVersionId,
      targetType:'ASSET_CALL_SHEET',targetId:id,linkType:'REFERENCES_AS',actorId,evidence:{role:ref.referenceRole}});
  }
  await insertTrace(db,{projectId,sourceType:'ASSET_REQUIREMENT',sourceId:requirement.id,
    targetType:'ASSET_CALL_SHEET',targetId:id,linkType:'PLANS_PRODUCTION_WITH',actorId,evidence:{status,assetType}});
  return {id,projectId,breakdownPlanId:breakdown.id,assetRequirementId:requirement.id,callSheetKey:input.callSheetKey,assetType,status,unsupportedRoles,missingRequiredRoles};
};

export const bindAigcAssetRequirement=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,['assetRequirementId','resolutionType','rightsApproval','usageScope','versionBinding','evidence'],'INVALID_AIGC_ASSET_REQUIREMENT_BINDING');
  const resolutionType=upper(input.resolutionType);
  if(!BINDING_TYPES.has(resolutionType))throw errorOf('Unsupported asset requirement resolution type','AIGC_ASSET_BINDING_TYPE_INVALID',409,{resolutionType});
  if(upper(input.rightsApproval.status)!=='APPROVED')throw errorOf('Asset binding requires Rights approval','AIGC_ASSET_BINDING_RIGHTS_REQUIRED',409);
  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  const [reqRows]=await db.execute(
    'SELECT * FROM aigc_shot_asset_requirements WHERE id=? AND project_id=? AND breakdown_plan_id=?',
    [input.assetRequirementId,projectId,breakdown.id]
  );
  if(!reqRows.length)throw errorOf('Asset requirement is not in current Breakdown','AIGC_ASSET_REQUIREMENT_STALE',409);
  const req=reqRows[0];
  let assetVersionId=null,callSheetId=null,bindingStatus='BLOCKED',targetType,targetId;
  if(resolutionType==='CURRENT_ASSET'){
    if(!input.assetVersionId)throw errorOf('CURRENT_ASSET binding requires assetVersionId','AIGC_ASSET_VERSION_REQUIRED',409);
    const version=await loadAssetVersion(db,input.assetVersionId);
    await assertVersionAccessible(db,project,version);
    if(!FINAL_ASSET_STATES.has(version.state))throw errorOf('Bound asset version is not final/current','AIGC_ASSET_VERSION_NOT_READY',409,{state:version.state});
    if(input.versionBinding.exact!==true)throw errorOf('Asset binding must pin exact version','AIGC_ASSET_VERSION_PIN_REQUIRED',409);
    assetVersionId=version.id;bindingStatus='READY';targetType='ASSET_VERSION';targetId=version.id;
  }else{
    if(!input.callSheetId)throw errorOf('CALL_SHEET binding requires callSheetId','AIGC_CALL_SHEET_REQUIRED',409);
    const [rows]=await db.execute(
      'SELECT * FROM aigc_asset_call_sheets WHERE id=? AND project_id=? AND asset_requirement_id=?',
      [input.callSheetId,projectId,req.id]
    );
    const sheet=rows[0];
    if(!sheet)throw errorOf('Call Sheet does not match requirement','AIGC_CALL_SHEET_BINDING_INVALID',409);
    if(sheet.status!=='READY')throw errorOf('Call Sheet Preflight is not ready','AIGC_CALL_SHEET_NOT_READY',409,{status:sheet.status});
    callSheetId=sheet.id;bindingStatus='PLANNED';targetType='ASSET_CALL_SHEET';targetId=sheet.id;
  }
  await db.execute(
    'UPDATE aigc_asset_requirement_bindings SET is_current=FALSE WHERE asset_requirement_id=? AND is_current=TRUE',[req.id]
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_asset_requirement_bindings
      (id,project_id,breakdown_plan_id,asset_requirement_id,resolution_type,asset_version_id,call_sheet_id,
       binding_status,is_current,rights_approval_json,usage_scope_json,version_binding_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,TRUE,?,?,?,?,?)`,
    [id,projectId,breakdown.id,req.id,resolutionType,assetVersionId,callSheetId,bindingStatus,
     asJson(input.rightsApproval),asJson(input.usageScope),asJson(input.versionBinding),asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId,sourceType:'ASSET_REQUIREMENT',sourceId:req.id,targetType,targetId?targetType:'UNKNOWN',
    targetId:targetId||id,linkType:'RESOLVED_BY',actorId,evidence:{resolutionType,bindingStatus}});
  return {id,projectId,assetRequirementId:req.id,resolutionType,assetVersionId,callSheetId,bindingStatus,isCurrent:true};
};

export const evaluateAigcAssetGate=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};
  const formatGate=await evaluateAigcFormatGate(projectId,{asOf,persist:false},actorId);
  if(formatGate.status!=='PASS')reasons.push('G_AIGC_FORMAT_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.breakdownPlanId=breakdown?.id||null;
  if(!breakdown)reasons.push('AIGC_BREAKDOWN_PLAN_REQUIRED');
  else{
    const [requirements,bindings]=await Promise.all([
      listRows(db,"SELECT * FROM aigc_shot_asset_requirements WHERE breakdown_plan_id=? AND criticality='REQUIRED'",[breakdown.id]),
      listRows(db,'SELECT * FROM aigc_asset_requirement_bindings WHERE breakdown_plan_id=? AND is_current=TRUE',[breakdown.id])
    ]);
    const bindingByReq=new Map(bindings.map(x=>[x.asset_requirement_id,x]));
    let ready=0,planned=0,blocked=0,unbound=0;
    for(const req of requirements){
      const b=bindingByReq.get(req.id);
      if(!b){unbound++;continue;}
      if(b.resolution_type==='CURRENT_ASSET'){
        const version=await loadAssetVersion(db,b.asset_version_id);
        try{await assertVersionAccessible(db,project,version);}catch{blocked++;continue;}
        if(FINAL_ASSET_STATES.has(version.state)&&b.binding_status==='READY')ready++;else blocked++;
      }else if(b.resolution_type==='CALL_SHEET'){
        const [sheets]=await db.execute('SELECT * FROM aigc_asset_call_sheets WHERE id=?',[b.call_sheet_id]);
        const sheet=sheets[0];
        if(sheet&&sheet.status==='READY'&&b.binding_status==='PLANNED'){
          const refs=await listRows(db,'SELECT * FROM aigc_call_sheet_reference_bindings WHERE call_sheet_id=?',[sheet.id]);
          const requiredBad=refs.some(x=>Boolean(x.required)&&x.status!=='READY');
          const preflight=parseJson(sheet.preflight_json)||{};
          if(!requiredBad&&upper(preflight.status)==='PASS')planned++;else blocked++;
        }else blocked++;
      }else blocked++;
    }
    if(unbound)reasons.push('AIGC_REQUIRED_ASSET_REQUIREMENT_UNBOUND');
    if(blocked)reasons.push('AIGC_ASSET_PRODUCTION_PATH_BLOCKED');
    evidence.requiredRequirementCount=requirements.length;
    evidence.currentBindingCount=bindings.length;
    evidence.readyAssetRequirementCount=ready;
    evidence.plannedCallSheetRequirementCount=planned;
    evidence.blockedRequirementCount=blocked;
    evidence.unboundRequirementCount=unbound;
    evidence.productionPathReady=unbound===0&&blocked===0;
  }
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m288_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcAssetState=async projectId=>{
  const project=await loadProject(projectId),db=getRuntimePool();
  const [libraries,assets,versions,callSheets,refs,bindings,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_asset_libraries WHERE workspace_id=? ORDER BY created_at,id',[project.workspace_id]),
    listRows(db,'SELECT * FROM aigc_assets WHERE workspace_id=? ORDER BY created_at,id',[project.workspace_id]),
    listRows(db,'SELECT * FROM aigc_asset_versions WHERE workspace_id=? ORDER BY created_at,id',[project.workspace_id]),
    listRows(db,'SELECT * FROM aigc_asset_call_sheets WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_call_sheet_reference_bindings WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_asset_requirement_bindings WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m288_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['资产库','正式资产与版本','资产调用单','参考继承','资产需求绑定'],
      gateName:'资产系统门禁',
      libraryScopeLabels:{PROJECT:'项目资产库',WORKSPACE:'工作区可复用资产库'},
      bindingStatusLabels:{READY:'正式资产已就绪',PLANNED:'调用单已就绪',BLOCKED:'生产路径阻塞'}
    },
    libraries:libraries.map(x=>({id:x.id,workspaceId:x.workspace_id,ownerProjectId:x.owner_project_id,libraryKey:x.library_key,displayName:x.display_name,libraryScope:x.library_scope,permissionPolicy:parseJson(x.permission_policy_json),rightsPolicy:parseJson(x.rights_policy_json),usageScope:parseJson(x.usage_scope_json),versionPolicy:parseJson(x.version_policy_json),status:x.status})),
    assets:assets.map(x=>({id:x.id,libraryId:x.library_id,ownerProjectId:x.owner_project_id,assetKey:x.asset_key,assetType:x.asset_type,displayName:x.display_name,purpose:parseJson(x.purpose_json),sourceOfTruth:parseJson(x.source_of_truth_json),immutable:Boolean(x.immutable),onlyVariable:parseJson(x.only_variable_json),rights:parseJson(x.rights_json),usageScope:parseJson(x.usage_scope_json),status:x.status})),
    versions:versions.map(x=>({id:x.id,assetId:x.asset_id,versionKey:x.version_key,versionNo:Number(x.version_no),contentLocator:parseJson(x.content_locator_json),outputSpec:parseJson(x.output_spec_json),requiredViews:parseJson(x.required_views_json),fingerprintSha256:x.fingerprint_sha256,state:x.state,qaResult:parseJson(x.qa_result_json),parentAssetVersionId:x.parent_asset_version_id||null})),
    callSheets:callSheets.map(x=>({id:x.id,assetRequirementId:x.asset_requirement_id,assetId:x.asset_id||null,callSheetKey:x.call_sheet_key,assetType:x.asset_type,purpose:parseJson(x.purpose_json),sourceOfTruth:parseJson(x.source_of_truth_json),onlyVariable:parseJson(x.only_variable_json),outputSpec:parseJson(x.output_spec_json),requiredViews:parseJson(x.required_views_json),referenceRoles:parseJson(x.reference_roles_json),forbidden:parseJson(x.forbidden_json),qaGate:parseJson(x.qa_gate_json),failAction:parseJson(x.fail_action_json),targetPath:x.target_path,budgetGuardrail:parseJson(x.budget_guardrail_json),preflight:parseJson(x.preflight_json),status:x.status})),
    referenceBindings:refs.map(x=>({id:x.id,callSheetId:x.call_sheet_id,referenceAssetVersionId:x.reference_asset_version_id,referenceRole:x.reference_role,required:Boolean(x.required),compatibility:parseJson(x.compatibility_json),status:x.status})),
    requirementBindings:bindings.map(x=>({id:x.id,assetRequirementId:x.asset_requirement_id,resolutionType:x.resolution_type,assetVersionId:x.asset_version_id||null,callSheetId:x.call_sheet_id||null,bindingStatus:x.binding_status,isCurrent:Boolean(x.is_current),rightsApproval:parseJson(x.rights_approval_json),usageScope:parseJson(x.usage_scope_json),versionBinding:parseJson(x.version_binding_json)})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
