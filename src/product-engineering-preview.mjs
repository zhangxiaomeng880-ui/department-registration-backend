import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateProductDeliveryGate } from './product-development-delivery.mjs';
import { evaluateAiContractGate } from './product-ai-contract.mjs';

const GATE_KEY='G-PD-ENGINEERING';
const SHA40=/^[0-9a-f]{40}$/i;
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
const assertProjectRow=async(db,table,id,projectId,code)=>{
  const [rows]=await db.execute(`SELECT * FROM ${table} WHERE id=?`,[id]);
  if(!rows.length)throw errorOf('Object not found',code,404,{id});
  if(rows[0].project_id!==projectId)throw errorOf('Object scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
  return rows[0];
};
const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Engineering domain requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentBaseline=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' ORDER BY locked_at DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Product Baseline is required','PRODUCT_BASELINE_REQUIRED',409);
  return rows[0];
};
const currentPlan=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_delivery_plans WHERE project_id=? AND status='CURRENT' ORDER BY created_at DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Delivery Plan is required','PRODUCT_DELIVERY_PLAN_REQUIRED',409);
  return rows[0];
};
const currentDesignVersion=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT d.id contract_id,d.status,v.*
       FROM product_design_contracts d
       JOIN product_design_contract_versions v
         ON v.design_contract_id=d.id AND v.version_no=d.current_version_no
      WHERE d.project_id=? AND d.status IN ('APPROVED','CURRENT')
      ORDER BY d.updated_at DESC LIMIT 1`,[projectId]
  );
  if(!rows.length)throw errorOf('Current Design Contract is required','DESIGN_CONTRACT_REQUIRED',409);
  return rows[0];
};
const currentTechnicalVersion=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT t.id contract_id,t.status,v.*
       FROM product_technical_contracts t
       JOIN product_technical_contract_versions v
         ON v.technical_contract_id=t.id AND v.version_no=t.current_version_no
      WHERE t.project_id=? AND t.status IN ('APPROVED','CURRENT')
      ORDER BY t.updated_at DESC LIMIT 1`,[projectId]
  );
  if(!rows.length)throw errorOf('Current Technical Contract is required','TECHNICAL_CONTRACT_REQUIRED',409);
  return rows[0];
};
const currentAiVersion=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT c.id contract_id,c.status,v.*
       FROM product_ai_contracts c
       JOIN product_ai_contract_versions v
         ON v.ai_contract_id=c.id AND v.version_no=c.current_version_no
      WHERE c.project_id=? AND c.status IN ('APPROVED','CURRENT')
      ORDER BY c.updated_at DESC LIMIT 1`,[projectId]
  );
  return rows[0]||null;
};
const currentRequirementVersionSet=baseline=>{
  const items=parseJson(baseline.requirement_versions_json)||[];
  return new Set(items.map(x=>x.versionId).filter(Boolean));
};
const assertRequirementVersions=async(db,projectId,baseline,ids)=>{
  if(!Array.isArray(ids)||!ids.length)throw errorOf(
    'At least one Requirement Version is required','ENGINEERING_REQUIREMENT_TRACE_REQUIRED',409
  );
  const allowed=currentRequirementVersionSet(baseline);
  for(const id of ids){
    const [rows]=await db.execute('SELECT project_id FROM product_requirement_versions WHERE id=?',[id]);
    if(!rows.length)throw errorOf('Requirement Version not found','PRODUCT_REQUIREMENT_VERSION_NOT_FOUND',404,{id});
    if(rows[0].project_id!==projectId)throw errorOf('Requirement Version scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
    if(!allowed.has(id))throw errorOf(
      'Engineering may only implement Requirement Versions from the current Product Baseline',
      'REQUIREMENT_VERSION_NOT_IN_CURRENT_BASELINE',409,{id}
    );
  }
};
const assertNaOrStatus=({value,label,passStatuses=['PASS','NONE','NO_CHANGE']})=>{
  if(!value||typeof value!=='object')throw errorOf(`${label} is required`,'INVALID_ENGINEERING_EVIDENCE',409,{label});
  const status=upper(value.status);
  if(status==='N_A'){
    if(!nonEmpty(value.rationale))throw errorOf(`${label} N_A requires rationale`,'ENGINEERING_NA_REASON_REQUIRED',409,{label});
    return;
  }
  if(!passStatuses.includes(status))throw errorOf(`${label} must pass or be explicitly N_A`,'ENGINEERING_EVIDENCE_NOT_PASS',409,{label,status});
};
const verifySource=(input)=>{
  if(!SHA40.test(String(input.commitSha||'')))throw errorOf('commitSha must be an exact 40-char Git SHA','INVALID_ENGINEERING_COMMIT_SHA');
  if(input.baseCommitSha&&!SHA40.test(String(input.baseCommitSha)))throw errorOf('baseCommitSha must be a 40-char Git SHA','INVALID_ENGINEERING_BASE_SHA');
  if(!input.sourceVerification||input.sourceVerification.verified!==true||
     !input.sourceVerification.verifiedAt||!input.sourceVerification.evidenceRef){
    throw errorOf('Source verification must prove repo/branch/commit facts','ENGINEERING_SOURCE_NOT_VERIFIED',409);
  }
  const pr=input.pullRequest;
  if(!pr||pr.merged!==true||upper(pr.state)!=='MERGED'||!pr.number||!pr.url||!pr.mergedCommitSha){
    throw errorOf('A merged Pull Request is required','ENGINEERING_PR_MERGED_REQUIRED',409);
  }
  if(!SHA40.test(String(pr.mergedCommitSha))||String(pr.mergedCommitSha).toLowerCase()!==String(input.commitSha).toLowerCase()){
    throw errorOf('PR mergedCommitSha must equal exact engineering commitSha','ENGINEERING_PR_COMMIT_MISMATCH',409);
  }
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

export const listProductModules=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    "SELECT * FROM product_module_registry WHERE status='ACTIVE' ORDER BY sort_order,module_key"
  );
  return rows.map(r=>({
    moduleKey:r.module_key,displayName:r.display_name,stageKey:r.stage_key,
    sortOrder:Number(r.sort_order),status:r.status,description:r.description||null
  }));
};

export const resolveEngineeringProjectScope=async projectId=>{
  const p=await loadProductProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createEngineeringChangeset=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  requireFields(input,[
    'productBaselineId','deliveryPlanId','workItemId','designContractVersionId',
    'technicalContractVersionId','changesetKey','repositoryFullName','branchName','commitSha',
    'pullRequest','sourceVerification','requirementVersionIds','dependencyChange','migration',
    'staticCheck','automatedTest','knownIssues','evidence'
  ],'INVALID_ENGINEERING_CHANGESET');
  verifySource(input);
  assertNaOrStatus({value:input.dependencyChange,label:'dependencyChange'});
  assertNaOrStatus({value:input.migration,label:'migration'});
  assertNaOrStatus({value:input.staticCheck,label:'staticCheck',passStatuses:['PASS']});
  assertNaOrStatus({value:input.automatedTest,label:'automatedTest',passStatuses:['PASS']});
  if(!Array.isArray(input.knownIssues))throw errorOf('knownIssues must be an array','INVALID_ENGINEERING_KNOWN_ISSUES');
  const db=getRuntimePool();
  const baseline=await currentBaseline(projectId,db);
  if(baseline.id!==input.productBaselineId)throw errorOf('Engineering changeset baseline is stale','PRODUCT_BASELINE_STALE',409);
  const plan=await currentPlan(projectId,db);
  if(plan.id!==input.deliveryPlanId)throw errorOf('Engineering changeset delivery plan is stale','DELIVERY_PLAN_STALE',409);
  const work=await assertProjectRow(db,'project_work_items',input.workItemId,projectId,'PROJECT_WORK_ITEM_NOT_FOUND');
  if(work.stage_key!=='PD_09_ENGINEERING')throw errorOf(
    'Engineering changeset must bind a PD_09_ENGINEERING work item','ENGINEERING_WORK_ITEM_STAGE_REQUIRED',409,
    {stageKey:work.stage_key}
  );
  const planWorkItems=new Set(parseJson(plan.work_item_ids_json)||[]);
  if(!planWorkItems.has(input.workItemId))throw errorOf(
    'Engineering work item must be part of current Delivery Plan','ENGINEERING_WORK_ITEM_NOT_IN_PLAN',409
  );
  const design=await assertProjectRow(db,'product_design_contract_versions',input.designContractVersionId,projectId,'PRODUCT_DESIGN_CONTRACT_VERSION_NOT_FOUND');
  const technical=await assertProjectRow(db,'product_technical_contract_versions',input.technicalContractVersionId,projectId,'PRODUCT_TECHNICAL_CONTRACT_VERSION_NOT_FOUND');
  if(design.product_baseline_id!==baseline.id||technical.product_baseline_id!==baseline.id)
    throw errorOf('Design/Technical Contract baseline mismatch','ENGINEERING_CONTRACT_BASELINE_MISMATCH',409);
  const currentDesign=await currentDesignVersion(projectId,db),currentTechnical=await currentTechnicalVersion(projectId,db);
  if(currentDesign.id!==input.designContractVersionId||currentTechnical.id!==input.technicalContractVersionId)
    throw errorOf('Engineering must bind current Design and Technical Contract versions','ENGINEERING_CONTRACT_VERSION_STALE',409);
  let ai=null;
  if(project.project_subtype_key==='AI_APPLICATION'){
    if(!input.aiContractVersionId)throw errorOf('AI Application engineering requires AI Contract Version','AI_CONTRACT_VERSION_REQUIRED',409);
    ai=await currentAiVersion(projectId,db);
    if(!ai||ai.id!==input.aiContractVersionId||ai.product_baseline_id!==baseline.id)
      throw errorOf('Engineering must bind current AI Contract Version','AI_CONTRACT_VERSION_STALE',409);
  }else if(input.aiContractVersionId){
    await assertProjectRow(db,'product_ai_contract_versions',input.aiContractVersionId,projectId,'PRODUCT_AI_CONTRACT_VERSION_NOT_FOUND');
  }
  await assertRequirementVersions(db,projectId,baseline,input.requirementVersionIds);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_engineering_changesets
      (id,project_id,product_baseline_id,delivery_plan_id,work_item_id,design_contract_version_id,
       technical_contract_version_id,ai_contract_version_id,changeset_key,source_provider,repository_full_name,
       branch_name,base_commit_sha,commit_sha,pull_request_json,source_verification_json,
       requirement_version_ids_json,dependency_change_json,migration_json,static_check_json,
       automated_test_json,known_issue_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CURRENT',?,?)`,
    [id,projectId,input.productBaselineId,input.deliveryPlanId,input.workItemId,input.designContractVersionId,
     input.technicalContractVersionId,input.aiContractVersionId||null,input.changesetKey,upper(input.sourceProvider||'GITHUB'),
     input.repositoryFullName,input.branchName,input.baseCommitSha||null,input.commitSha.toLowerCase(),
     asJson(input.pullRequest),asJson(input.sourceVerification),asJson(input.requirementVersionIds),
     asJson(input.dependencyChange),asJson(input.migration),asJson(input.staticCheck),asJson(input.automatedTest),
     asJson(input.knownIssues),asJson(input.evidence),actorId]
  );
  for(const requirementVersionId of input.requirementVersionIds)await insertTrace(db,{
    projectId,sourceType:'REQUIREMENT_VERSION',sourceId:requirementVersionId,
    targetType:'ENGINEERING_CHANGESET',targetId:id,linkType:'IMPLEMENTED_BY',actorId
  });
  await insertTrace(db,{projectId,sourceType:'DESIGN_CONTRACT_VERSION',sourceId:input.designContractVersionId,
    targetType:'ENGINEERING_CHANGESET',targetId:id,linkType:'IMPLEMENTED_BY',actorId});
  await insertTrace(db,{projectId,sourceType:'TECHNICAL_CONTRACT_VERSION',sourceId:input.technicalContractVersionId,
    targetType:'ENGINEERING_CHANGESET',targetId:id,linkType:'IMPLEMENTED_BY',actorId});
  if(input.aiContractVersionId)await insertTrace(db,{projectId,sourceType:'AI_CONTRACT_VERSION',sourceId:input.aiContractVersionId,
    targetType:'ENGINEERING_CHANGESET',targetId:id,linkType:'IMPLEMENTED_BY',actorId});
  return {
    id,projectId,changesetKey:input.changesetKey,workItemId:input.workItemId,
    repositoryFullName:input.repositoryFullName,branchName:input.branchName,
    commitSha:input.commitSha.toLowerCase(),status:'CURRENT'
  };
};

export const createBuildRecord=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'changesetId','targetReleaseVersionId','buildKey','buildId','commitSha','artifactLocator',
    'buildStatus','buildSystem','configVersion','migrationVersion','testSummary','evidence'
  ],'INVALID_PRODUCT_BUILD_RECORD');
  if(!SHA40.test(String(input.commitSha||'')))throw errorOf('Build commitSha must be exact 40-char Git SHA','INVALID_BUILD_COMMIT_SHA');
  if(input.artifactSha256&&!SHA64.test(String(input.artifactSha256)))throw errorOf('artifactSha256 must be SHA-256','INVALID_ARTIFACT_SHA256');
  if(upper(input.buildStatus)!=='SUCCESS')throw errorOf('Only successful build may become engineering evidence','BUILD_SUCCESS_REQUIRED',409);
  if(upper(input.testSummary?.status)!=='PASS')throw errorOf('Build testSummary must PASS','BUILD_TEST_SUMMARY_PASS_REQUIRED',409);
  const db=getRuntimePool();
  const changeset=await assertProjectRow(db,'product_engineering_changesets',input.changesetId,projectId,'ENGINEERING_CHANGESET_NOT_FOUND');
  if(changeset.status!=='CURRENT')throw errorOf('Build requires current engineering changeset','ENGINEERING_CHANGESET_STALE',409);
  if(changeset.commit_sha.toLowerCase()!==input.commitSha.toLowerCase())throw errorOf('Build commit must equal changeset commit','BUILD_CHANGESET_COMMIT_MISMATCH',409);
  const plan=await currentPlan(projectId,db);
  if(plan.target_release_version_id!==input.targetReleaseVersionId)throw errorOf(
    'Build target release must match current Delivery Plan','BUILD_RELEASE_VERSION_MISMATCH',409
  );
  const version=await assertProjectRow(db,'project_versions',input.targetReleaseVersionId,projectId,'PROJECT_VERSION_NOT_FOUND');
  if(version.version_type!=='RELEASE_DISTRIBUTION')throw errorOf('Build target must be RELEASE_DISTRIBUTION version','INVALID_TARGET_RELEASE_VERSION',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_build_records
      (id,project_id,changeset_id,target_release_version_id,build_key,build_id,commit_sha,
       artifact_locator_json,artifact_sha256,build_status,build_system,config_version_json,
       migration_version_json,ai_runtime_snapshot_json,test_summary_json,evidence_json,started_at,finished_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.changesetId,input.targetReleaseVersionId,input.buildKey,input.buildId,
     input.commitSha.toLowerCase(),asJson(input.artifactLocator),input.artifactSha256||null,
     'SUCCESS',input.buildSystem,asJson(input.configVersion),asJson(input.migrationVersion),
     asJson(input.aiRuntimeSnapshot||null),asJson(input.testSummary),asJson(input.evidence),
     input.startedAt?new Date(input.startedAt):null,input.finishedAt?new Date(input.finishedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'ENGINEERING_CHANGESET',sourceId:input.changesetId,
    targetType:'BUILD_RECORD',targetId:id,linkType:'BUILT_AS',actorId});
  return {id,projectId,changesetId:input.changesetId,buildKey:input.buildKey,buildId:input.buildId,
    commitSha:input.commitSha.toLowerCase(),buildStatus:'SUCCESS',targetReleaseVersionId:input.targetReleaseVersionId};
};

export const createPreviewDeployment=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,[
    'buildRecordId','targetReleaseVersionId','previewKey','environment','deploymentId',
    'deploymentStatus','commitSha','previewLocator','configSnapshot','health','readiness','evidence'
  ],'INVALID_PRODUCT_PREVIEW_DEPLOYMENT');
  if(!SHA40.test(String(input.commitSha||'')))throw errorOf('Preview commitSha must be exact 40-char Git SHA','INVALID_PREVIEW_COMMIT_SHA');
  if(upper(input.deploymentStatus)!=='SUCCESS')throw errorOf('Preview deployment must be SUCCESS','PREVIEW_DEPLOYMENT_SUCCESS_REQUIRED',409);
  if(!['PASS','HEALTHY'].includes(upper(input.health.status)))throw errorOf('Preview health must PASS/HEALTHY','PREVIEW_HEALTH_REQUIRED',409);
  if(Number(input.readiness.httpStatus)!==200||upper(input.readiness.status)!=='PASS')throw errorOf(
    'Preview readiness must PASS with HTTP 200','PREVIEW_READINESS_REQUIRED',409
  );
  const db=getRuntimePool();
  const build=await assertProjectRow(db,'product_build_records',input.buildRecordId,projectId,'PRODUCT_BUILD_RECORD_NOT_FOUND');
  if(build.build_status!=='SUCCESS')throw errorOf('Preview requires successful build','PREVIEW_BUILD_NOT_SUCCESS',409);
  if(build.commit_sha.toLowerCase()!==input.commitSha.toLowerCase())throw errorOf('Preview commit must equal build commit','PREVIEW_BUILD_COMMIT_MISMATCH',409);
  if(build.target_release_version_id!==input.targetReleaseVersionId)throw errorOf('Preview release version must equal build version','PREVIEW_RELEASE_VERSION_MISMATCH',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_preview_deployments
      (id,project_id,build_record_id,target_release_version_id,preview_key,environment,deployment_id,
       deployment_status,commit_sha,preview_locator_json,config_snapshot_json,health_json,readiness_json,
       evidence_json,deployed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.buildRecordId,input.targetReleaseVersionId,input.previewKey,input.environment,
     input.deploymentId,'SUCCESS',input.commitSha.toLowerCase(),asJson(input.previewLocator),
     asJson(input.configSnapshot),asJson(input.health),asJson(input.readiness),asJson(input.evidence),
     input.deployedAt?new Date(input.deployedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'BUILD_RECORD',sourceId:input.buildRecordId,
    targetType:'PREVIEW_DEPLOYMENT',targetId:id,linkType:'DEPLOYED_AS',actorId});
  return {id,projectId,buildRecordId:input.buildRecordId,previewKey:input.previewKey,
    environment:input.environment,deploymentId:input.deploymentId,deploymentStatus:'SUCCESS',
    commitSha:input.commitSha.toLowerCase()};
};

export const createSmokeEvidence=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,['previewDeploymentId','smokeKey','status','checks','evidence'],'INVALID_PRODUCT_SMOKE_EVIDENCE');
  if(upper(input.status)!=='PASS')throw errorOf('Only PASS smoke evidence may satisfy engineering gate','SMOKE_PASS_REQUIRED',409);
  if(!Array.isArray(input.checks)||!input.checks.length||input.checks.some(x=>upper(x.status)!=='PASS'))
    throw errorOf('All smoke checks must PASS','SMOKE_CHECKS_PASS_REQUIRED',409);
  const db=getRuntimePool();
  const preview=await assertProjectRow(db,'product_preview_deployments',input.previewDeploymentId,projectId,'PREVIEW_DEPLOYMENT_NOT_FOUND');
  if(preview.deployment_status!=='SUCCESS')throw errorOf('Smoke requires successful preview','SMOKE_PREVIEW_NOT_SUCCESS',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_smoke_evidence
      (id,project_id,preview_deployment_id,smoke_key,status,checks_json,evidence_json,verified_by,tested_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.previewDeploymentId,input.smokeKey,'PASS',asJson(input.checks),asJson(input.evidence),
     input.verifiedBy||'RUNTIME',input.testedAt?new Date(input.testedAt):new Date()]
  );
  await insertTrace(db,{projectId,sourceType:'PREVIEW_DEPLOYMENT',sourceId:input.previewDeploymentId,
    targetType:'SMOKE_EVIDENCE',targetId:id,linkType:'VERIFIED_BY',actorId});
  return {id,projectId,previewDeploymentId:input.previewDeploymentId,smokeKey:input.smokeKey,status:'PASS'};
};

const openMaterialIssues=issues=>(issues||[]).filter(x=>
  !['RESOLVED','CLOSED','ACCEPTED'].includes(upper(x.status))&&['HIGH','CRITICAL'].includes(upper(x.severity))
);
export const evaluateEngineeringGate=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};
  const contractGate=await evaluateProductDeliveryGate(projectId,'G-PD-CONTRACT',{persist:false},actorId);
  if(contractGate.status!=='PASS')reasons.push('TECHNICAL_CONTRACT_NOT_READY');
  if(project.project_subtype_key==='AI_APPLICATION'){
    const aiGate=await evaluateAiContractGate(projectId,{persist:false},actorId);
    if(aiGate.status!=='PASS')reasons.push('AI_CONTRACT_NOT_READY');
  }
  const baseline=await currentBaseline(projectId,db);
  const plan=await currentPlan(projectId,db);
  evidence.productBaselineId=baseline.id;evidence.deliveryPlanId=plan.id;
  const workIds=parseJson(plan.work_item_ids_json)||[];
  let engineeringWork=[];
  if(workIds.length){
    const placeholders=workIds.map(()=>'?').join(',');
    const [rows]=await db.execute(
      `SELECT * FROM project_work_items WHERE project_id=? AND id IN (${placeholders}) AND stage_key='PD_09_ENGINEERING'`,
      [projectId,...workIds]
    );
    engineeringWork=rows;
  }
  evidence.engineeringWorkItems=engineeringWork.map(w=>({id:w.id,itemKey:w.item_key,status:w.status}));
  if(!engineeringWork.length)reasons.push('ENGINEERING_WORK_ITEM_REQUIRED');
  const exactPreviews=[];
  for(const work of engineeringWork){
    if(work.status!=='COMPLETED')reasons.push(`ENGINEERING_WORK_ITEM_NOT_COMPLETED:${work.item_key}`);
    const [changesets]=await db.execute(
      `SELECT * FROM product_engineering_changesets
        WHERE project_id=? AND work_item_id=? AND status='CURRENT'
        ORDER BY created_at DESC LIMIT 1`,[projectId,work.id]
    );
    if(!changesets.length){reasons.push(`ENGINEERING_CHANGESET_REQUIRED:${work.item_key}`);continue;}
    const cs=changesets[0];
    if(cs.product_baseline_id!==baseline.id||cs.delivery_plan_id!==plan.id)
      reasons.push(`ENGINEERING_CHANGESET_STALE:${work.item_key}`);
    const verification=parseJson(cs.source_verification_json)||{};
    if(verification.verified!==true||!verification.verifiedAt||!verification.evidenceRef)
      reasons.push(`ENGINEERING_SOURCE_NOT_VERIFIED:${work.item_key}`);
    const pr=parseJson(cs.pull_request_json)||{};
    if(pr.merged!==true||upper(pr.state)!=='MERGED'||String(pr.mergedCommitSha||'').toLowerCase()!==cs.commit_sha.toLowerCase())
      reasons.push(`ENGINEERING_PR_NOT_MERGED:${work.item_key}`);
    if(!SHA40.test(cs.commit_sha))reasons.push(`ENGINEERING_COMMIT_SHA_INVALID:${work.item_key}`);
    if(upper(parseJson(cs.static_check_json)?.status)!=='PASS')reasons.push(`STATIC_CHECK_NOT_PASS:${work.item_key}`);
    if(upper(parseJson(cs.automated_test_json)?.status)!=='PASS')reasons.push(`AUTOMATED_TEST_NOT_PASS:${work.item_key}`);
    if(openMaterialIssues(parseJson(cs.known_issue_json)).length)reasons.push(`MATERIAL_KNOWN_ISSUE_OPEN:${work.item_key}`);

    const [builds]=await db.execute(
      `SELECT * FROM product_build_records WHERE project_id=? AND changeset_id=? AND build_status='SUCCESS'
        ORDER BY finished_at DESC,created_at DESC LIMIT 1`,[projectId,cs.id]
    );
    if(!builds.length){reasons.push(`SUCCESS_BUILD_REQUIRED:${work.item_key}`);continue;}
    const build=builds[0];
    if(build.commit_sha!==cs.commit_sha)reasons.push(`BUILD_COMMIT_MISMATCH:${work.item_key}`);
    if(build.target_release_version_id!==plan.target_release_version_id)reasons.push(`BUILD_RELEASE_VERSION_MISMATCH:${work.item_key}`);

    const [previews]=await db.execute(
      `SELECT * FROM product_preview_deployments
        WHERE project_id=? AND build_record_id=? AND deployment_status='SUCCESS'
        ORDER BY deployed_at DESC,created_at DESC LIMIT 1`,[projectId,build.id]
    );
    if(!previews.length){reasons.push(`SUCCESS_PREVIEW_REQUIRED:${work.item_key}`);continue;}
    const preview=previews[0];
    if(preview.commit_sha!==build.commit_sha)reasons.push(`PREVIEW_COMMIT_MISMATCH:${work.item_key}`);
    if(preview.target_release_version_id!==plan.target_release_version_id)reasons.push(`PREVIEW_RELEASE_VERSION_MISMATCH:${work.item_key}`);
    const health=parseJson(preview.health_json)||{},ready=parseJson(preview.readiness_json)||{};
    if(!['PASS','HEALTHY'].includes(upper(health.status)))reasons.push(`PREVIEW_HEALTH_NOT_PASS:${work.item_key}`);
    if(Number(ready.httpStatus)!==200||upper(ready.status)!=='PASS')reasons.push(`PREVIEW_READINESS_NOT_PASS:${work.item_key}`);

    const [smokes]=await db.execute(
      `SELECT * FROM product_smoke_evidence
        WHERE project_id=? AND preview_deployment_id=? AND status='PASS'
        ORDER BY tested_at DESC,created_at DESC LIMIT 1`,[projectId,preview.id]
    );
    if(!smokes.length){reasons.push(`SMOKE_EVIDENCE_REQUIRED:${work.item_key}`);continue;}
    exactPreviews.push({
      workItemId:work.id,changesetId:cs.id,repositoryFullName:cs.repository_full_name,
      branchName:cs.branch_name,commitSha:cs.commit_sha,buildRecordId:build.id,buildId:build.build_id,
      previewDeploymentId:preview.id,deploymentId:preview.deployment_id,environment:preview.environment,
      smokeEvidenceId:smokes[0].id
    });
  }
  evidence.exactPreviews=exactPreviews;
  const result={projectId,gateKey:GATE_KEY,status:reasons.length?'HOLD':'PASS',
    reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false){
    await db.execute(
      `INSERT INTO product_m274_gate_evaluations
        (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,GATE_KEY,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
    );
  }
  return result;
};

export const getEngineeringState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [changesets,builds,previews,smokes,gates]=await Promise.all([
    db.execute('SELECT * FROM product_engineering_changesets WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_build_records WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_preview_deployments WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_smoke_evidence WHERE project_id=? ORDER BY tested_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m274_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    changesets:changesets.map(x=>({
      id:x.id,changesetKey:x.changeset_key,workItemId:x.work_item_id,
      repositoryFullName:x.repository_full_name,branchName:x.branch_name,commitSha:x.commit_sha,
      pullRequest:parseJson(x.pull_request_json),sourceVerification:parseJson(x.source_verification_json),
      requirementVersionIds:parseJson(x.requirement_version_ids_json),knownIssues:parseJson(x.known_issue_json),
      status:x.status
    })),
    builds:builds.map(x=>({
      id:x.id,changesetId:x.changeset_id,buildKey:x.build_key,buildId:x.build_id,
      commitSha:x.commit_sha,buildStatus:x.build_status,buildSystem:x.build_system,
      artifactLocator:parseJson(x.artifact_locator_json),targetReleaseVersionId:x.target_release_version_id
    })),
    previews:previews.map(x=>({
      id:x.id,buildRecordId:x.build_record_id,previewKey:x.preview_key,environment:x.environment,
      deploymentId:x.deployment_id,deploymentStatus:x.deployment_status,commitSha:x.commit_sha,
      previewLocator:parseJson(x.preview_locator_json),health:parseJson(x.health_json),
      readiness:parseJson(x.readiness_json),targetReleaseVersionId:x.target_release_version_id
    })),
    smokeEvidence:smokes.map(x=>({
      id:x.id,previewDeploymentId:x.preview_deployment_id,smokeKey:x.smoke_key,
      status:x.status,checks:parseJson(x.checks_json),testedAt:x.tested_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),asOf:x.as_of
    }))
  };
};
