import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const FEASIBILITY_SECTIONS=[
  'ARCHITECTURE','FRAMEWORK_RUNTIME','DATA','API_INTEGRATION','AUTH_PERMISSION',
  'SECURITY_PRIVACY_COMPLIANCE','PERFORMANCE_SCALABILITY','RELIABILITY_AVAILABILITY',
  'DEPLOYMENT_MIGRATION','THIRD_PARTY_DEPENDENCY','COST_QUOTA',
  'OBSERVABILITY_SUPPORTABILITY','ROLLBACK'
];
const TECHNICAL_SECTIONS=['TECHNICAL_DESIGN','API','DATA','INTEGRATION','INSTRUMENTATION'];
const M272_GATES=new Set(['G-PD-FEASIBILITY','G-PD-PLAN','G-PD-DESIGN','G-PD-CONTRACT']);
const CONTRACT_STATUSES=new Set(['DRAFT','APPROVED','CURRENT','DEPRECATED']);
const REVIEW_STATUSES=new Set(['DRAFT','PASS','BLOCKED','SKIPPED']);
const SECTION_STATUSES=new Set(['PASS','N_A','BLOCKED']);
const ACTIVE_VERSION_STATUSES=new Set(['DRAFT','CANDIDATE','LOCKED']);
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
const assertEnum=(value,set,code,label)=>{
  const x=upper(value);
  if(!set.has(x))throw errorOf(`Unsupported ${label}`,code,400,{value});
  return x;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key,current_baseline_id FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'M27.2 requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const assertProjectRow=async(db,table,id,projectId,code='PRODUCT_OBJECT_NOT_FOUND')=>{
  const [rows]=await db.execute(`SELECT project_id FROM ${table} WHERE id=?`,[id]);
  if(!rows.length)throw errorOf('Object not found',code,404,{id});
  if(rows[0].project_id!==projectId)throw errorOf('Object scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
  return rows[0];
};
const currentProductBaseline=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' ORDER BY locked_at DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Product Baseline is required','PRODUCT_BASELINE_REQUIRED',409);
  return rows[0];
};
const ensureBaselineCurrent=async(projectId,baselineId,db)=>{
  const baseline=await currentProductBaseline(projectId,db);
  if(baseline.id!==baselineId)throw errorOf(
    'M27.2 object must target the current Product Baseline','PRODUCT_BASELINE_STALE',409,
    {currentProductBaselineId:baseline.id,requestedProductBaselineId:baselineId}
  );
  return baseline;
};
const assertDecision=async(db,id,projectId)=>{
  if(!id)throw errorOf('Project Decision is required','PROJECT_DECISION_REQUIRED',409);
  await assertProjectRow(db,'project_decisions',id,projectId,'PROJECT_DECISION_NOT_FOUND');
};
const sectionStatusMap=(input,requiredSections,code)=>{
  if(!input||typeof input!=='object')throw errorOf('sectionStatus is required',code);
  const result={};
  const missing=[];
  for(const section of requiredSections){
    const raw=input[section];
    if(!raw||typeof raw!=='object'){missing.push(section);continue;}
    const status=assertEnum(raw.status,SECTION_STATUSES,code,`${section} status`);
    if(status==='N_A'&&!nonEmpty(raw.rationale))throw errorOf(
      `${section} N_A requires rationale`,code,409,{section}
    );
    result[section]={status,rationale:raw.rationale||null,evidence:raw.evidence||null};
  }
  if(missing.length)throw errorOf('Required contract sections are missing',code,409,{missing});
  return result;
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,upper(linkType||'TRACES_TO'),asJson(evidence||null),actorId||null]
  );
};
const baselineRequirementVersionIds=baseline=>{
  const items=parseJson(baseline.requirement_versions_json)||[];
  return new Set(items.map(x=>x.versionId).filter(Boolean));
};
const validateRequirementVersions=async(db,projectId,baseline,ids)=>{
  if(!Array.isArray(ids)||!ids.length)throw errorOf(
    'requirementVersionIds are required','REQUIREMENT_VERSION_LINKS_REQUIRED',409
  );
  const allowed=baselineRequirementVersionIds(baseline);
  for(const id of ids){
    const [rows]=await db.execute('SELECT project_id FROM product_requirement_versions WHERE id=?',[id]);
    if(!rows.length)throw errorOf('Requirement version not found','PRODUCT_REQUIREMENT_VERSION_NOT_FOUND',404,{id});
    if(rows[0].project_id!==projectId)throw errorOf('Requirement version scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
    if(!allowed.has(id))throw errorOf(
      'Contract must trace to requirement versions locked in current Product Baseline',
      'REQUIREMENT_VERSION_NOT_IN_CURRENT_BASELINE',409,{id,productBaselineId:baseline.id}
    );
  }
};

export const resolveDesignContractScope=async id=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT d.id,d.project_id,p.workspace_id FROM product_design_contracts d
      JOIN projects p ON p.id=d.project_id WHERE d.id=?`,[id]
  );
  if(!rows.length)throw errorOf('Design contract not found','PRODUCT_DESIGN_CONTRACT_NOT_FOUND',404);
  return {designContractId:id,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveTechnicalContractScope=async id=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT t.id,t.project_id,p.workspace_id FROM product_technical_contracts t
      JOIN projects p ON p.id=t.project_id WHERE t.id=?`,[id]
  );
  if(!rows.length)throw errorOf('Technical contract not found','PRODUCT_TECHNICAL_CONTRACT_NOT_FOUND',404);
  return {technicalContractId:id,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createProductFeasibilityReview=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'productBaselineId','reviewKey','sectionStatus','architecture','frameworkRuntime','data',
    'apiIntegration','authPermission','securityPrivacyCompliance','performanceScalability',
    'reliabilityAvailability','deploymentMigration','thirdPartyDependency','costQuota',
    'observabilitySupportability','rollback','riskSummary','evidence'
  ],'INVALID_PRODUCT_FEASIBILITY_REVIEW');
  const db=getRuntimePool();
  await ensureBaselineCurrent(projectId,input.productBaselineId,db);
  const overallStatus=assertEnum(input.overallStatus||'DRAFT',REVIEW_STATUSES,'INVALID_FEASIBILITY_STATUS','feasibility status');
  const sections=sectionStatusMap(input.sectionStatus,FEASIBILITY_SECTIONS,'INVALID_FEASIBILITY_SECTION_STATUS');
  if(overallStatus==='PASS'){
    const blocked=Object.entries(sections).filter(([,x])=>x.status==='BLOCKED').map(([k])=>k);
    if(blocked.length)throw errorOf('PASS feasibility cannot contain BLOCKED sections','FEASIBILITY_SECTIONS_BLOCKED',409,{blocked});
  }
  if(overallStatus==='SKIPPED'){
    if(!input.skippedReason)throw errorOf('SKIPPED feasibility requires skippedReason','FEASIBILITY_SKIP_REASON_REQUIRED',409);
    await assertDecision(db,input.approvalDecisionId,projectId);
  }
  if(input.approvalDecisionId)await assertDecision(db,input.approvalDecisionId,projectId);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_feasibility_reviews
      (id,project_id,product_baseline_id,review_key,overall_status,section_status_json,architecture_json,
       framework_runtime_json,data_json,api_integration_json,auth_permission_json,
       security_privacy_compliance_json,performance_scalability_json,reliability_availability_json,
       deployment_migration_json,third_party_dependency_json,cost_quota_json,
       observability_supportability_json,rollback_json,risk_summary_json,architecture_decision_required,
       skipped_reason,approval_decision_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.productBaselineId,input.reviewKey,overallStatus,asJson(sections),asJson(input.architecture),
     asJson(input.frameworkRuntime),asJson(input.data),asJson(input.apiIntegration),asJson(input.authPermission),
     asJson(input.securityPrivacyCompliance),asJson(input.performanceScalability),asJson(input.reliabilityAvailability),
     asJson(input.deploymentMigration),asJson(input.thirdPartyDependency),asJson(input.costQuota),
     asJson(input.observabilitySupportability),asJson(input.rollback),asJson(input.riskSummary),
     input.architectureDecisionRequired===true?1:0,input.skippedReason||null,input.approvalDecisionId||null,
     asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId,sourceType:'PRODUCT_BASELINE',sourceId:input.productBaselineId,
    targetType:'FEASIBILITY_REVIEW',targetId:id,linkType:'INPUT_TO',actorId});
  return {id,projectId,productBaselineId:input.productBaselineId,reviewKey:input.reviewKey,overallStatus,
    architectureDecisionRequired:input.architectureDecisionRequired===true};
};

export const createArchitectureDecision=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'feasibilityReviewId','productBaselineId','adrKey','title','context','options',
    'decision','consequences','projectDecisionId','evidence'
  ],'INVALID_PRODUCT_ADR');
  const db=getRuntimePool();
  const baseline=await ensureBaselineCurrent(projectId,input.productBaselineId,db);
  await assertProjectRow(db,'product_feasibility_reviews',input.feasibilityReviewId,projectId,'PRODUCT_FEASIBILITY_REVIEW_NOT_FOUND');
  await assertDecision(db,input.projectDecisionId,projectId);
  const [reviews]=await db.execute('SELECT product_baseline_id FROM product_feasibility_reviews WHERE id=?',[input.feasibilityReviewId]);
  if(reviews[0].product_baseline_id!==baseline.id)throw errorOf('ADR feasibility review baseline mismatch','ADR_BASELINE_MISMATCH',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_architecture_decisions
      (id,project_id,feasibility_review_id,product_baseline_id,adr_key,title,context_json,options_json,
       decision_json,consequences_json,status,project_decision_id,effective_version,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.feasibilityReviewId,input.productBaselineId,input.adrKey,input.title,asJson(input.context),
     asJson(input.options),asJson(input.decision),asJson(input.consequences),upper(input.status||'ACCEPTED'),
     input.projectDecisionId,input.effectiveVersion||null,asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId,sourceType:'FEASIBILITY_REVIEW',sourceId:input.feasibilityReviewId,
    targetType:'ARCHITECTURE_DECISION',targetId:id,linkType:'DECIDED_BY',actorId});
  await insertTrace(db,{projectId,sourceType:'ARCHITECTURE_DECISION',sourceId:id,
    targetType:'PROJECT_DECISION',targetId:input.projectDecisionId,linkType:'RECORDED_AS',actorId});
  return {id,projectId,adrKey:input.adrKey,status:upper(input.status||'ACCEPTED'),projectDecisionId:input.projectDecisionId};
};

const validateIds=async(db,projectId,table,ids,code)=>{
  if(!Array.isArray(ids)||!ids.length)throw errorOf('Required references are missing',code,409);
  for(const id of ids)await assertProjectRow(db,table,id,projectId,code);
};
export const createProductDeliveryPlan=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'productBaselineId','feasibilityReviewId','planKey','targetReleaseVersionId',
    'milestoneIds','iterationIds','workItemIds','capacitySnapshotIds','criticalPath',
    'releaseSequence','definitionOfDone','acceptancePlan','riskBlockerPlan','evidence'
  ],'INVALID_PRODUCT_DELIVERY_PLAN');
  if(!Array.isArray(input.dependencyIds))throw errorOf('dependencyIds must be an array','INVALID_PRODUCT_DELIVERY_PLAN');
  const db=getRuntimePool();
  await ensureBaselineCurrent(projectId,input.productBaselineId,db);
  await assertProjectRow(db,'product_feasibility_reviews',input.feasibilityReviewId,projectId,'PRODUCT_FEASIBILITY_REVIEW_NOT_FOUND');
  await validateIds(db,projectId,'project_milestones',input.milestoneIds,'MILESTONE_PLAN_REFERENCES_REQUIRED');
  await validateIds(db,projectId,'project_iterations',input.iterationIds,'ITERATION_PLAN_REFERENCES_REQUIRED');
  await validateIds(db,projectId,'project_work_items',input.workItemIds,'WORK_ITEM_PLAN_REFERENCES_REQUIRED');
  for(const id of input.dependencyIds)await assertProjectRow(db,'project_dependencies',id,projectId,'PROJECT_DEPENDENCY_NOT_FOUND');
  for(const id of input.capacitySnapshotIds)await assertProjectRow(db,'governance_capacity_snapshots',id,projectId,'CAPACITY_SNAPSHOT_NOT_FOUND');
  const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[input.targetReleaseVersionId]);
  if(!versions.length)throw errorOf('Target release version not found','PROJECT_VERSION_NOT_FOUND',404);
  const version=versions[0];
  if(version.project_id!==projectId||version.version_type!=='RELEASE_DISTRIBUTION'||!ACTIVE_VERSION_STATUSES.has(version.status))
    throw errorOf('Target release version must be an active RELEASE_DISTRIBUTION version','INVALID_TARGET_RELEASE_VERSION',409);
  const [reviews]=await db.execute('SELECT overall_status,product_baseline_id FROM product_feasibility_reviews WHERE id=?',[input.feasibilityReviewId]);
  if(!['PASS','SKIPPED'].includes(reviews[0].overall_status)||reviews[0].product_baseline_id!==input.productBaselineId)
    throw errorOf('Delivery plan requires a passing feasibility review on the current baseline','FEASIBILITY_NOT_READY',409);
  const id=randomUUID();
  const [previous]=await db.execute(
    "SELECT id FROM product_delivery_plans WHERE project_id=? AND status='CURRENT'",[projectId]
  );
  await db.execute(
    `INSERT INTO product_delivery_plans
      (id,project_id,product_baseline_id,feasibility_review_id,plan_key,target_release_version_id,
       milestone_ids_json,iteration_ids_json,work_item_ids_json,dependency_ids_json,capacity_snapshot_ids_json,
       critical_path_json,release_sequence_json,definition_of_done_json,acceptance_plan_json,risk_blocker_plan_json,
       status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CURRENT',?,?)`,
    [id,projectId,input.productBaselineId,input.feasibilityReviewId,input.planKey,input.targetReleaseVersionId,
     asJson(input.milestoneIds),asJson(input.iterationIds),asJson(input.workItemIds),asJson(input.dependencyIds),
     asJson(input.capacitySnapshotIds),asJson(input.criticalPath),asJson(input.releaseSequence),
     asJson(input.definitionOfDone),asJson(input.acceptancePlan),asJson(input.riskBlockerPlan),asJson(input.evidence),actorId]
  );
  for(const row of previous)await db.execute(
    "UPDATE product_delivery_plans SET status='HISTORICAL',replaced_by_id=? WHERE id=?",[id,row.id]
  );
  await insertTrace(db,{projectId,sourceType:'PRODUCT_BASELINE',sourceId:input.productBaselineId,
    targetType:'DELIVERY_PLAN',targetId:id,linkType:'PLANNED_AS',actorId});
  return {id,projectId,planKey:input.planKey,status:'CURRENT',targetReleaseVersionId:input.targetReleaseVersionId};
};

const validateDesignPayload=input=>{
  requireFields(input,[
    'productBaselineId','sourceLocator','sourceVerification','informationArchitecture','userFlows',
    'screensPages','components','tokensStyle','interaction','stateMatrix','responsiveAdaptive',
    'accessibility','contentCopy','platformBehavior','prototypeLocator','designAcceptanceMatrix',
    'requirementVersionIds','evidence'
  ],'INVALID_PRODUCT_DESIGN_CONTRACT_VERSION');
  if(input.sourceVerification?.readable!==true||!input.sourceVerification?.verifiedAt||!input.sourceVerification?.evidenceRef)
    throw errorOf('Design source must be verifiably readable','DESIGN_SOURCE_NOT_VERIFIED',409);
};
const insertDesignVersion=async(db,{contractId,projectId,versionNo,input,changeId,actorId})=>{
  validateDesignPayload(input);
  const baseline=await ensureBaselineCurrent(projectId,input.productBaselineId,db);
  await validateRequirementVersions(db,projectId,baseline,input.requirementVersionIds);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_design_contract_versions
      (id,design_contract_id,project_id,product_baseline_id,version_no,source_locator_json,source_verification_json,
       design_system_locator_json,information_architecture_json,user_flows_json,screens_pages_json,components_json,
       tokens_style_json,interaction_json,state_matrix_json,responsive_adaptive_json,accessibility_json,content_copy_json,
       platform_behavior_json,prototype_locator_json,design_acceptance_matrix_json,change_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,contractId,projectId,input.productBaselineId,versionNo,asJson(input.sourceLocator),asJson(input.sourceVerification),
     asJson(input.designSystemLocator||null),asJson(input.informationArchitecture),asJson(input.userFlows),
     asJson(input.screensPages),asJson(input.components),asJson(input.tokensStyle),asJson(input.interaction),
     asJson(input.stateMatrix),asJson(input.responsiveAdaptive),asJson(input.accessibility),asJson(input.contentCopy),
     asJson(input.platformBehavior),asJson(input.prototypeLocator),asJson(input.designAcceptanceMatrix),
     changeId||null,asJson(input.evidence),actorId]
  );
  for(const requirementVersionId of input.requirementVersionIds)await insertTrace(db,{
    projectId,sourceType:'REQUIREMENT_VERSION',sourceId:requirementVersionId,
    targetType:'DESIGN_CONTRACT_VERSION',targetId:id,linkType:'DESIGNED_BY',actorId
  });
  return id;
};
export const createDesignContract=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.contractKey||!input.title)throw errorOf('contractKey and title are required','INVALID_PRODUCT_DESIGN_CONTRACT');
  validateDesignPayload(input);
  const status=assertEnum(input.status||'APPROVED',CONTRACT_STATUSES,'INVALID_DESIGN_CONTRACT_STATUS','design contract status');
  const db=getRuntimePool(),conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_design_contracts(id,project_id,contract_key,title,status,current_version_no,owner_identity_id)
       VALUES (?,?,?,?,?,1,?)`,
      [id,projectId,input.contractKey,input.title,status,input.ownerIdentityId||actorId||null]
    );
    const versionId=await insertDesignVersion(conn,{contractId:id,projectId,versionNo:1,input,changeId:null,actorId});
    await conn.commit();
    return {id,projectId,contractKey:input.contractKey,title:input.title,status,currentVersionNo:1,currentVersionId:versionId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};
export const reviseDesignContract=async(contractId,input={},actorId=null)=>{
  if(!input.changeId)throw errorOf('Design revision requires changeId','DESIGN_CONTRACT_CHANGE_REQUIRED',409);
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_design_contracts WHERE id=? FOR UPDATE',[contractId]);
    if(!rows.length)throw errorOf('Design contract not found','PRODUCT_DESIGN_CONTRACT_NOT_FOUND',404);
    const row=rows[0];
    await assertProjectRow(conn,'project_changes',input.changeId,row.project_id,'PROJECT_CHANGE_NOT_FOUND');
    const versionNo=Number(row.current_version_no)+1;
    const versionId=await insertDesignVersion(conn,{contractId,projectId:row.project_id,versionNo,input,changeId:input.changeId,actorId});
    const status=input.status?assertEnum(input.status,CONTRACT_STATUSES,'INVALID_DESIGN_CONTRACT_STATUS','design contract status'):row.status;
    await conn.execute('UPDATE product_design_contracts SET current_version_no=?,status=? WHERE id=?',[versionNo,status,contractId]);
    await conn.commit();
    return {id:contractId,projectId:row.project_id,contractKey:row.contract_key,status,currentVersionNo:versionNo,currentVersionId:versionId,changeId:input.changeId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const validateTechnicalPayload=input=>{
  requireFields(input,[
    'productBaselineId','technicalDesign','apiContract','dataContract','integrationContract',
    'instrumentationContract','sectionStatus','requirementVersionIds','evidence'
  ],'INVALID_PRODUCT_TECHNICAL_CONTRACT_VERSION');
  const sections=sectionStatusMap(input.sectionStatus,TECHNICAL_SECTIONS,'INVALID_TECHNICAL_SECTION_STATUS');
  if(sections.TECHNICAL_DESIGN.status!=='PASS')throw errorOf('Technical Design must PASS','TECHNICAL_DESIGN_PASS_REQUIRED',409);
  if(sections.INSTRUMENTATION.status!=='PASS')throw errorOf('Instrumentation Contract must PASS','INSTRUMENTATION_PASS_REQUIRED',409);
  if(Object.values(sections).some(x=>x.status==='BLOCKED'))throw errorOf('Technical Contract contains BLOCKED section','TECHNICAL_CONTRACT_SECTION_BLOCKED',409);
  return sections;
};
const insertTechnicalVersion=async(db,{contractId,projectId,versionNo,input,changeId,actorId})=>{
  const sections=validateTechnicalPayload(input);
  const baseline=await ensureBaselineCurrent(projectId,input.productBaselineId,db);
  await validateRequirementVersions(db,projectId,baseline,input.requirementVersionIds);
  if(input.designContractVersionId){
    const [design]=await db.execute('SELECT project_id,product_baseline_id FROM product_design_contract_versions WHERE id=?',[input.designContractVersionId]);
    if(!design.length)throw errorOf('Design contract version not found','PRODUCT_DESIGN_CONTRACT_VERSION_NOT_FOUND',404);
    if(design[0].project_id!==projectId||design[0].product_baseline_id!==baseline.id)
      throw errorOf('Technical and design contract baseline mismatch','CONTRACT_BASELINE_MISMATCH',409);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_technical_contract_versions
      (id,technical_contract_id,project_id,product_baseline_id,design_contract_version_id,version_no,
       technical_design_json,api_contract_json,data_contract_json,integration_contract_json,
       instrumentation_contract_json,section_status_json,change_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,contractId,projectId,input.productBaselineId,input.designContractVersionId||null,versionNo,
     asJson(input.technicalDesign),asJson(input.apiContract),asJson(input.dataContract),asJson(input.integrationContract),
     asJson(input.instrumentationContract),asJson(sections),changeId||null,asJson(input.evidence),actorId]
  );
  for(const requirementVersionId of input.requirementVersionIds)await insertTrace(db,{
    projectId,sourceType:'REQUIREMENT_VERSION',sourceId:requirementVersionId,
    targetType:'TECHNICAL_CONTRACT_VERSION',targetId:id,linkType:'IMPLEMENTED_BY_CONTRACT',actorId
  });
  if(input.designContractVersionId)await insertTrace(db,{
    projectId,sourceType:'DESIGN_CONTRACT_VERSION',sourceId:input.designContractVersionId,
    targetType:'TECHNICAL_CONTRACT_VERSION',targetId:id,linkType:'REALIZED_BY',actorId
  });
  return id;
};
export const createTechnicalContract=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.contractKey||!input.title)throw errorOf('contractKey and title are required','INVALID_PRODUCT_TECHNICAL_CONTRACT');
  validateTechnicalPayload(input);
  const status=assertEnum(input.status||'APPROVED',CONTRACT_STATUSES,'INVALID_TECHNICAL_CONTRACT_STATUS','technical contract status');
  const db=getRuntimePool(),conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_technical_contracts(id,project_id,contract_key,title,status,current_version_no,owner_identity_id)
       VALUES (?,?,?,?,?,1,?)`,
      [id,projectId,input.contractKey,input.title,status,input.ownerIdentityId||actorId||null]
    );
    const versionId=await insertTechnicalVersion(conn,{contractId:id,projectId,versionNo:1,input,changeId:null,actorId});
    await conn.commit();
    return {id,projectId,contractKey:input.contractKey,title:input.title,status,currentVersionNo:1,currentVersionId:versionId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};
export const reviseTechnicalContract=async(contractId,input={},actorId=null)=>{
  if(!input.changeId)throw errorOf('Technical revision requires changeId','TECHNICAL_CONTRACT_CHANGE_REQUIRED',409);
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_technical_contracts WHERE id=? FOR UPDATE',[contractId]);
    if(!rows.length)throw errorOf('Technical contract not found','PRODUCT_TECHNICAL_CONTRACT_NOT_FOUND',404);
    const row=rows[0];
    await assertProjectRow(conn,'project_changes',input.changeId,row.project_id,'PROJECT_CHANGE_NOT_FOUND');
    const versionNo=Number(row.current_version_no)+1;
    const versionId=await insertTechnicalVersion(conn,{contractId,projectId:row.project_id,versionNo,input,changeId:input.changeId,actorId});
    const status=input.status?assertEnum(input.status,CONTRACT_STATUSES,'INVALID_TECHNICAL_CONTRACT_STATUS','technical contract status'):row.status;
    await conn.execute('UPDATE product_technical_contracts SET current_version_no=?,status=? WHERE id=?',[versionNo,status,contractId]);
    await conn.commit();
    return {id:contractId,projectId:row.project_id,contractKey:row.contract_key,status,currentVersionNo:versionNo,currentVersionId:versionId,changeId:input.changeId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const latestFeasibility=async(db,projectId)=>{
  const [rows]=await db.execute(
    'SELECT * FROM product_feasibility_reviews WHERE project_id=? ORDER BY created_at DESC LIMIT 1',[projectId]
  );return rows[0]||null;
};
const currentDeliveryPlan=async(db,projectId)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_delivery_plans WHERE project_id=? AND status='CURRENT' ORDER BY created_at DESC LIMIT 1",[projectId]
  );return rows[0]||null;
};
const currentDesign=async(db,projectId)=>{
  const [rows]=await db.execute(
    `SELECT d.*,v.id version_id,v.product_baseline_id,v.source_verification_json,v.created_at version_created_at
       FROM product_design_contracts d JOIN product_design_contract_versions v
         ON v.design_contract_id=d.id AND v.version_no=d.current_version_no
      WHERE d.project_id=? AND d.status IN ('APPROVED','CURRENT') ORDER BY d.updated_at DESC LIMIT 1`,[projectId]
  );return rows[0]||null;
};
const currentTechnical=async(db,projectId)=>{
  const [rows]=await db.execute(
    `SELECT t.*,v.id version_id,v.product_baseline_id,v.design_contract_version_id,v.section_status_json,v.created_at version_created_at
       FROM product_technical_contracts t JOIN product_technical_contract_versions v
         ON v.technical_contract_id=t.id AND v.version_no=t.current_version_no
      WHERE t.project_id=? AND t.status IN ('APPROVED','CURRENT') ORDER BY t.updated_at DESC LIMIT 1`,[projectId]
  );return rows[0]||null;
};
const traceCount=async(db,projectId,targetType,targetId)=>{
  const [[row]]=await db.execute(
    'SELECT COUNT(*) count FROM product_trace_links WHERE project_id=? AND target_type=? AND target_id=? AND source_type=?',
    [projectId,targetType,targetId,'REQUIREMENT_VERSION']
  );return Number(row.count||0);
};

const readiness=async(projectId,gateKey)=>{
  const gate=assertEnum(gateKey,M272_GATES,'INVALID_PRODUCT_GATE','product gate');
  const db=getRuntimePool();
  await loadProductProject(projectId,db);
  const baseline=await currentProductBaseline(projectId,db);
  const reasons=[],evidence={productBaselineId:baseline.id};
  if(gate==='G-PD-FEASIBILITY'){
    const review=await latestFeasibility(db,projectId);
    evidence.feasibilityReviewId=review?.id||null;
    if(!review)reasons.push('FEASIBILITY_REVIEW_REQUIRED');
    else if(review.product_baseline_id!==baseline.id)reasons.push('FEASIBILITY_BASELINE_STALE');
    else if(review.overall_status==='BLOCKED'||review.overall_status==='DRAFT')reasons.push('FEASIBILITY_NOT_PASS');
    else if(review.overall_status==='SKIPPED'&&(!review.skipped_reason||!review.approval_decision_id))reasons.push('FEASIBILITY_SKIP_APPROVAL_REQUIRED');
    else if(Boolean(review.architecture_decision_required)){
      const [[adr]]=await db.execute(
        "SELECT COUNT(*) count FROM product_architecture_decisions WHERE feasibility_review_id=? AND status='ACCEPTED'",[review.id]
      );
      if(!Number(adr.count))reasons.push('ADR_REQUIRED');
    }
    if(!reasons.length&&review?.overall_status==='SKIPPED')return {projectId,gateKey:gate,status:'SKIPPED',reasonCodes:[],evidenceSnapshot:evidence};
  }
  if(gate==='G-PD-PLAN'){
    const feasibility=await readiness(projectId,'G-PD-FEASIBILITY');
    if(!['PASS','SKIPPED'].includes(feasibility.status))reasons.push('FEASIBILITY_NOT_READY');
    const plan=await currentDeliveryPlan(db,projectId);
    evidence.deliveryPlanId=plan?.id||null;
    if(!plan)reasons.push('DELIVERY_PLAN_REQUIRED');
    else if(plan.product_baseline_id!==baseline.id)reasons.push('DELIVERY_PLAN_BASELINE_STALE');
  }
  if(gate==='G-PD-DESIGN'){
    const plan=await readiness(projectId,'G-PD-PLAN');
    if(plan.status!=='PASS')reasons.push('DELIVERY_PLAN_NOT_READY');
    const design=await currentDesign(db,projectId);
    evidence.designContractId=design?.id||null;evidence.designContractVersionId=design?.version_id||null;
    if(!design)reasons.push('DESIGN_CONTRACT_REQUIRED');
    else{
      if(design.product_baseline_id!==baseline.id)reasons.push('DESIGN_CONTRACT_BASELINE_STALE');
      const verification=parseJson(design.source_verification_json);
      if(verification?.readable!==true||!verification?.verifiedAt||!verification?.evidenceRef)reasons.push('DESIGN_SOURCE_NOT_VERIFIED');
      if(await traceCount(db,projectId,'DESIGN_CONTRACT_VERSION',design.version_id)<1)reasons.push('REQUIREMENT_DESIGN_TRACE_REQUIRED');
    }
  }
  if(gate==='G-PD-CONTRACT'){
    const designGate=await readiness(projectId,'G-PD-DESIGN');
    if(designGate.status!=='PASS')reasons.push('DESIGN_NOT_READY');
    const design=await currentDesign(db,projectId);
    const tech=await currentTechnical(db,projectId);
    evidence.technicalContractId=tech?.id||null;evidence.technicalContractVersionId=tech?.version_id||null;
    if(!tech)reasons.push('TECHNICAL_CONTRACT_REQUIRED');
    else{
      if(tech.product_baseline_id!==baseline.id)reasons.push('TECHNICAL_CONTRACT_BASELINE_STALE');
      if(design&&tech.design_contract_version_id!==design.version_id)reasons.push('TECHNICAL_DESIGN_VERSION_MISMATCH');
      const sections=parseJson(tech.section_status_json)||{};
      if(sections.TECHNICAL_DESIGN?.status!=='PASS')reasons.push('TECHNICAL_DESIGN_PASS_REQUIRED');
      if(sections.INSTRUMENTATION?.status!=='PASS')reasons.push('INSTRUMENTATION_PASS_REQUIRED');
      if(Object.values(sections).some(x=>x?.status==='BLOCKED'))reasons.push('TECHNICAL_CONTRACT_SECTION_BLOCKED');
      if(await traceCount(db,projectId,'TECHNICAL_CONTRACT_VERSION',tech.version_id)<1)reasons.push('REQUIREMENT_TECHNICAL_TRACE_REQUIRED');
    }
  }
  return {projectId,gateKey:gate,status:reasons.length?'HOLD':'PASS',reasonCodes:reasons,evidenceSnapshot:evidence};
};

export const evaluateProductDeliveryGate=async(projectId,gateKey,input={},actorId=null)=>{
  const result=await readiness(projectId,gateKey);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  if(input.persist!==false){
    const db=getRuntimePool();
    await db.execute(
      `INSERT INTO product_m272_gate_evaluations
        (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,result.gateKey,result.status,asJson(result.reasonCodes),asJson(result.evidenceSnapshot),asOf,actorId]
    );
  }
  return {...result,asOf};
};

export const getProductDeliveryState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [feasibility,adrs,plans,designs,designVersions,technical,technicalVersions,gates]=await Promise.all([
    db.execute('SELECT * FROM product_feasibility_reviews WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_architecture_decisions WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_delivery_plans WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_design_contracts WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_design_contract_versions WHERE project_id=? ORDER BY design_contract_id,version_no',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_technical_contracts WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_technical_contract_versions WHERE project_id=? ORDER BY technical_contract_id,version_no',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m272_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    feasibilityReviews:feasibility.map(r=>({id:r.id,reviewKey:r.review_key,productBaselineId:r.product_baseline_id,overallStatus:r.overall_status,architectureDecisionRequired:Boolean(r.architecture_decision_required)})),
    architectureDecisions:adrs.map(r=>({id:r.id,adrKey:r.adr_key,title:r.title,status:r.status,projectDecisionId:r.project_decision_id})),
    deliveryPlans:plans.map(r=>({id:r.id,planKey:r.plan_key,status:r.status,productBaselineId:r.product_baseline_id,targetReleaseVersionId:r.target_release_version_id,replacedById:r.replaced_by_id||null})),
    designContracts:designs.map(r=>({id:r.id,contractKey:r.contract_key,title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no)})),
    designVersions:designVersions.map(r=>({id:r.id,designContractId:r.design_contract_id,productBaselineId:r.product_baseline_id,versionNo:Number(r.version_no),changeId:r.change_id||null,sourceLocator:parseJson(r.source_locator_json),sourceVerification:parseJson(r.source_verification_json)})),
    technicalContracts:technical.map(r=>({id:r.id,contractKey:r.contract_key,title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no)})),
    technicalVersions:technicalVersions.map(r=>({id:r.id,technicalContractId:r.technical_contract_id,productBaselineId:r.product_baseline_id,designContractVersionId:r.design_contract_version_id||null,versionNo:Number(r.version_no),changeId:r.change_id||null,sectionStatus:parseJson(r.section_status_json)})),
    gateEvaluations:gates.map(r=>({id:r.id,gateKey:r.gate_key,status:r.status,reasonCodes:parseJson(r.reason_codes_json),asOf:r.as_of}))
  };
};

export const getDesignContract=async id=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM product_design_contracts WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Design contract not found','PRODUCT_DESIGN_CONTRACT_NOT_FOUND',404);
  const [versions]=await db.execute('SELECT * FROM product_design_contract_versions WHERE design_contract_id=? ORDER BY version_no',[id]);
  const r=rows[0];
  return {id:r.id,projectId:r.project_id,contractKey:r.contract_key,title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no),
    versions:versions.map(v=>({id:v.id,versionNo:Number(v.version_no),productBaselineId:v.product_baseline_id,changeId:v.change_id||null,sourceLocator:parseJson(v.source_locator_json),sourceVerification:parseJson(v.source_verification_json),designAcceptanceMatrix:parseJson(v.design_acceptance_matrix_json)}))};
};
export const getTechnicalContract=async id=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM product_technical_contracts WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Technical contract not found','PRODUCT_TECHNICAL_CONTRACT_NOT_FOUND',404);
  const [versions]=await db.execute('SELECT * FROM product_technical_contract_versions WHERE technical_contract_id=? ORDER BY version_no',[id]);
  const r=rows[0];
  return {id:r.id,projectId:r.project_id,contractKey:r.contract_key,title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no),
    versions:versions.map(v=>({id:v.id,versionNo:Number(v.version_no),productBaselineId:v.product_baseline_id,designContractVersionId:v.design_contract_version_id||null,changeId:v.change_id||null,sectionStatus:parseJson(v.section_status_json),technicalDesign:parseJson(v.technical_design_json),apiContract:parseJson(v.api_contract_json),dataContract:parseJson(v.data_contract_json),integrationContract:parseJson(v.integration_contract_json),instrumentationContract:parseJson(v.instrumentation_contract_json)}))};
};
