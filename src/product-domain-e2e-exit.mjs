import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateProductReviewGate } from './product-review.mjs';

const GATE='G-PD-FINAL';
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
const placeholderText=v=>/(example\.invalid|synthetic|fixture|placeholder)/i.test(JSON.stringify(v||''));

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_type,name FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Product Development FINAL requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const assertProjectRow=async(db,table,id,projectId,code)=>{
  const [rows]=await db.execute(\`SELECT * FROM \${table} WHERE id=?\`,[id]);
  if(!rows.length||rows[0].project_id!==projectId)throw errorOf(
    'Certified object is missing or outside project',code,409,{table,id}
  );
  return rows[0];
};
const traceExists=async(db,projectId,sourceType,sourceId,targetType,targetId)=>{
  const [rows]=await db.execute(
    \`SELECT id FROM product_trace_links
      WHERE project_id=? AND source_type=? AND source_id=? AND target_type=? AND target_id=? LIMIT 1\`,
    [projectId,sourceType,sourceId,targetType,targetId]
  );
  return rows.length===1;
};

export const resolveProductFinalScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createProductDevelopmentE2eCertification=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,[
    'certificationKey','projectIdentity','sourceRepository','buildEvidence','stagingDeployment',
    'codeEvidence','testEvidence','traceAnchors'
  ],'INVALID_PRODUCT_E2E_CERTIFICATION');

  if(input.projectIdentity.realProject!==true||upper(input.projectIdentity.domainKey)!=='DEPARTMENT_REGISTRATION')
    throw errorOf('M27 Exit requires a real Department Registration project','REAL_PRODUCT_PROJECT_REQUIRED',409);
  if(placeholderText(input.projectIdentity))throw errorOf('Real project identity contains placeholder evidence','REAL_PROJECT_PLACEHOLDER_FORBIDDEN',409);

  const src=input.sourceRepository;
  requireFields(src,['provider','repositoryFullName','branchName','exactCommitSha','pullRequest'],'INVALID_REAL_SOURCE_EVIDENCE');
  if(upper(src.provider)!=='GITHUB'||!SHA40.test(src.exactCommitSha))
    throw errorOf('Real source must be exact GitHub commit','REAL_SOURCE_GITHUB_COMMIT_REQUIRED',409);
  if(placeholderText(src))throw errorOf('Source evidence cannot be synthetic','REAL_SOURCE_PLACEHOLDER_FORBIDDEN',409);
  const pr=src.pullRequest;
  if(!pr||pr.merged!==true||upper(pr.state)!=='MERGED'||!pr.number||!pr.url||
     !SHA40.test(String(pr.mergedCommitSha||''))||
     pr.mergedCommitSha.toLowerCase()!==src.exactCommitSha.toLowerCase())
    throw errorOf('Certified source requires a real merged PR matching exact commit','REAL_MERGED_PR_REQUIRED',409);
  const expectedPrPath='github.com/'+src.repositoryFullName+'/pull/'+pr.number;
  if(!String(pr.url).includes(expectedPrPath))
    throw errorOf('PR URL must match certified repository and PR number','REAL_PR_URL_MISMATCH',409);

  const build=input.buildEvidence;
  requireFields(build,['provider','runId','runUrl','status','exactCommitSha','artifactSha256'],'INVALID_REAL_BUILD_EVIDENCE');
  if(upper(build.provider)!=='GITHUB_ACTIONS'||upper(build.status)!=='SUCCESS'||
     String(build.exactCommitSha).toLowerCase()!==src.exactCommitSha.toLowerCase()||
     !SHA64.test(String(build.artifactSha256)))
    throw errorOf('Real build evidence must be successful GitHub Actions build for exact commit','REAL_BUILD_EVIDENCE_INVALID',409);
  if(!String(build.runUrl).includes('github.com/'+src.repositoryFullName+'/actions/runs/'+build.runId)||placeholderText(build))
    throw errorOf('Build evidence URL is not a real repository Actions run','REAL_BUILD_URL_INVALID',409);

  const staging=input.stagingDeployment;
  requireFields(staging,['provider','environment','deploymentId','status','exactCommitSha','health','readiness'],'INVALID_REAL_STAGING_EVIDENCE');
  if(upper(staging.provider)!=='RAILWAY'||upper(staging.environment)!=='STAGING'||upper(staging.status)!=='SUCCESS'||
     String(staging.exactCommitSha).toLowerCase()!==src.exactCommitSha.toLowerCase()||
     !['PASS','HEALTHY'].includes(upper(staging.health.status))||
     upper(staging.readiness.status)!=='PASS'||Number(staging.readiness.httpStatus)!==200||
     placeholderText(staging))
    throw errorOf('Real Staging deployment evidence is invalid','REAL_STAGING_EVIDENCE_INVALID',409);

  if(!Array.isArray(input.codeEvidence)||!input.codeEvidence.length||
     !input.codeEvidence.some(x=>x.path==='src/server.mjs'&&SHA64.test(String(x.sha256||''))))
    throw errorOf('Real project code evidence must include src/server.mjs SHA-256','REAL_CODE_EVIDENCE_REQUIRED',409);
  if(!Array.isArray(input.testEvidence)||!input.testEvidence.length||
     !input.testEvidence.some(x=>x.path==='test/backend.test.mjs'&&upper(x.status)==='PASS'&&SHA64.test(String(x.sha256||''))))
    throw errorOf('Real project test evidence must include passing test/backend.test.mjs SHA-256','REAL_TEST_EVIDENCE_REQUIRED',409);
  if(placeholderText(input.codeEvidence)||placeholderText(input.testEvidence))
    throw errorOf('Real code/test evidence cannot be synthetic','REAL_FILE_EVIDENCE_PLACEHOLDER_FORBIDDEN',409);

  const reviewGate=await evaluateProductReviewGate(projectId,{persist:false},actorId);
  if(reviewGate.status!=='PASS')throw errorOf('G-PD-REVIEW must PASS before final certification','PRODUCT_REVIEW_GATE_REQUIRED',409,{
    reasonCodes:reviewGate.reasonCodes
  });

  const a=input.traceAnchors;
  requireFields(a,[
    'requirementVersionId','engineeringChangesetId','buildRecordId','previewDeploymentId',
    'acceptanceRunId','qaExecutionId','releaseCandidateId','releaseRolloutId',
    'primaryMetricObservationId','outcomeReviewId','productReviewId','nextVersionId'
  ],'INVALID_PRODUCT_E2E_TRACE_ANCHORS');

  const db=getRuntimePool();
  const requirement=await assertProjectRow(db,'product_requirement_versions',a.requirementVersionId,projectId,'FINAL_REQUIREMENT_INVALID');
  const changeset=await assertProjectRow(db,'product_engineering_changesets',a.engineeringChangesetId,projectId,'FINAL_CODE_INVALID');
  const buildRow=await assertProjectRow(db,'product_build_records',a.buildRecordId,projectId,'FINAL_BUILD_INVALID');
  const preview=await assertProjectRow(db,'product_preview_deployments',a.previewDeploymentId,projectId,'FINAL_PREVIEW_INVALID');
  const acceptance=await assertProjectRow(db,'product_acceptance_runs',a.acceptanceRunId,projectId,'FINAL_ACCEPTANCE_INVALID');
  const qa=await assertProjectRow(db,'product_qa_executions',a.qaExecutionId,projectId,'FINAL_QA_INVALID');
  const rc=await assertProjectRow(db,'product_release_candidates',a.releaseCandidateId,projectId,'FINAL_RELEASE_CANDIDATE_INVALID');
  const rollout=await assertProjectRow(db,'product_release_rollouts',a.releaseRolloutId,projectId,'FINAL_RELEASE_INVALID');
  const metric=await assertProjectRow(db,'product_outcome_observations',a.primaryMetricObservationId,projectId,'FINAL_METRIC_INVALID');
  const outcome=await assertProjectRow(db,'product_outcome_reviews',a.outcomeReviewId,projectId,'FINAL_OUTCOME_INVALID');
  const review=await assertProjectRow(db,'product_delivery_reviews',a.productReviewId,projectId,'FINAL_REVIEW_INVALID');
  const version=await assertProjectRow(db,'project_versions',a.nextVersionId,projectId,'FINAL_NEXT_VERSION_INVALID');

  if(changeset.repository_full_name!==src.repositoryFullName||changeset.branch_name!==src.branchName||
     changeset.commit_sha.toLowerCase()!==src.exactCommitSha.toLowerCase())
    throw errorOf('Engineering changeset does not match certified real source','FINAL_ENGINEERING_SOURCE_MISMATCH',409);
  const changesetPr=parseJson(changeset.pull_request_json)||{};
  if(changesetPr.number!==pr.number||changesetPr.merged!==true||
     String(changesetPr.mergedCommitSha||'').toLowerCase()!==src.exactCommitSha.toLowerCase())
    throw errorOf('Engineering changeset PR does not match certified real PR','FINAL_ENGINEERING_PR_MISMATCH',409);

  if(buildRow.changeset_id!==changeset.id||buildRow.commit_sha!==changeset.commit_sha||
     String(buildRow.artifact_sha256||'').toLowerCase()!==String(build.artifactSha256).toLowerCase())
    throw errorOf('Build is not exact certified Changeset/Artifact','FINAL_BUILD_TRACE_MISMATCH',409);
  if(preview.build_record_id!==buildRow.id||preview.commit_sha!==buildRow.commit_sha||
     preview.deployment_id!==staging.deploymentId||upper(preview.environment)!=='STAGING')
    throw errorOf('Preview is not exact certified Staging deployment','FINAL_PREVIEW_TRACE_MISMATCH',409);
  if(acceptance.preview_deployment_id!==preview.id||qa.preview_deployment_id!==preview.id)
    throw errorOf('Acceptance/QA must test exact certified preview','FINAL_TEST_PREVIEW_MISMATCH',409);
  if(rc.build_record_id!==buildRow.id||rc.preview_deployment_id!==preview.id||
     rc.acceptance_run_id!==acceptance.id||rc.qa_execution_id!==qa.id||
     rc.exact_commit_sha!==src.exactCommitSha.toLowerCase()||rc.status!=='FROZEN')
    throw errorOf('Release Candidate is not frozen from exact tested version','FINAL_RELEASE_CANDIDATE_TRACE_MISMATCH',409);
  if(rollout.release_candidate_id!==rc.id||rollout.exact_commit_sha!==rc.exact_commit_sha||
     !['RELEASED','FULLY_ROLLED_OUT'].includes(rollout.release_state))
    throw errorOf('Release rollout is not derived from certified Release Candidate','FINAL_RELEASE_TRACE_MISMATCH',409);
  if(metric.release_rollout_id!==rollout.id||metric.data_quality_status!=='PASS')
    throw errorOf('Primary Metric is not trustworthy evidence for certified release','FINAL_METRIC_TRACE_MISMATCH',409);
  if(outcome.release_rollout_id!==rollout.id||outcome.primary_metric_observation_id!==metric.id||outcome.status!=='FROZEN')
    throw errorOf('Outcome Review does not bind certified release and metric','FINAL_OUTCOME_TRACE_MISMATCH',409);
  if(review.release_rollout_id!==rollout.id||review.outcome_review_id!==outcome.id||review.status!=='FROZEN')
    throw errorOf('Product Review does not bind certified Outcome','FINAL_REVIEW_TRACE_MISMATCH',409);
  if(version.version_type!=='RELEASE_DISTRIBUTION'||version.status!=='DRAFT')
    throw errorOf('Review must produce next Release Version DRAFT','FINAL_NEXT_VERSION_INVALID',409);

  const reqIds=parseJson(changeset.requirement_version_ids_json)||[];
  if(!reqIds.includes(requirement.id))throw errorOf('Requirement is not implemented by certified changeset','FINAL_REQUIREMENT_CODE_MISMATCH',409);

  const traceChecks={
    requirementToCode:await traceExists(db,projectId,'REQUIREMENT_VERSION',requirement.id,'ENGINEERING_CHANGESET',changeset.id),
    codeToBuild:await traceExists(db,projectId,'ENGINEERING_CHANGESET',changeset.id,'BUILD_RECORD',buildRow.id),
    buildToPreview:await traceExists(db,projectId,'BUILD_RECORD',buildRow.id,'PREVIEW_DEPLOYMENT',preview.id),
    qaToRelease:await traceExists(db,projectId,'QA_EXECUTION',qa.id,'RELEASE_CANDIDATE',rc.id),
    releaseToMetric:await traceExists(db,projectId,'RELEASE_ROLLOUT',rollout.id,'OUTCOME_OBSERVATION',metric.id),
    outcomeToReview:await traceExists(db,projectId,'OUTCOME_REVIEW',outcome.id,'PRODUCT_REVIEW',review.id),
    reviewToNextVersion:await traceExists(db,projectId,'PRODUCT_REVIEW',review.id,'PROJECT_VERSION',version.id)
  };
  const missingTrace=Object.entries(traceChecks).filter(([,v])=>!v).map(([k])=>k);
  if(missingTrace.length)throw errorOf('Requirement→Code→Test→Release→Metric trace is incomplete','FINAL_TRACEABILITY_INCOMPLETE',409,{missingTrace});

  const gateSnapshot={
    reviewGate:'PASS',
    requirementCodeTestReleaseMetric:'PASS',
    realRepoBranchCommitPr:'PASS',
    realBuild:'PASS',
    realStagingPreview:'PASS',
    realBackendTest:'PASS',
    nextVersionLoop:'PASS'
  };
  const traceSnapshot={
    requirementVersionId:requirement.id,
    engineeringChangesetId:changeset.id,
    buildRecordId:buildRow.id,
    previewDeploymentId:preview.id,
    acceptanceRunId:acceptance.id,
    qaExecutionId:qa.id,
    releaseCandidateId:rc.id,
    releaseRolloutId:rollout.id,
    primaryMetricObservationId:metric.id,
    outcomeReviewId:outcome.id,
    productReviewId:review.id,
    nextVersionId:version.id,
    traceChecks
  };

  const id=randomUUID();
  await db.execute(
    \`INSERT INTO product_development_e2e_certifications
      (id,project_id,certification_key,project_identity_json,source_repository_json,build_evidence_json,
       staging_deployment_json,code_evidence_json,test_evidence_json,trace_anchors_json,trace_snapshot_json,
       gate_snapshot_json,status,certified_by_identity_id,certified_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'FROZEN',?,?)\`,
    [id,projectId,input.certificationKey,asJson({...input.projectIdentity,projectName:project.name}),
     asJson(input.sourceRepository),asJson(input.buildEvidence),asJson(input.stagingDeployment),
     asJson(input.codeEvidence),asJson(input.testEvidence),asJson(input.traceAnchors),
     asJson(traceSnapshot),asJson(gateSnapshot),actorId,input.certifiedAt?new Date(input.certifiedAt):new Date()]
  );
  return {id,projectId,certificationKey:input.certificationKey,status:'FROZEN',gateKey:GATE,
    sourceCommitSha:src.exactCommitSha.toLowerCase(),traceSnapshot,gateSnapshot};
};

export const evaluateProductDevelopmentFinalGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const review=await evaluateProductReviewGate(projectId,{persist:false},actorId);
  if(review.status!=='PASS')reasons.push('G_PD_REVIEW_NOT_PASS');

  const [rows]=await db.execute(
    "SELECT * FROM product_development_e2e_certifications WHERE project_id=? AND status='FROZEN' ORDER BY certified_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const cert=rows[0]||null;
  evidence.certificationId=cert?.id||null;
  if(!cert)reasons.push('REAL_PRODUCT_E2E_CERTIFICATION_REQUIRED');
  else{
    const projectIdentity=parseJson(cert.project_identity_json)||{};
    const source=parseJson(cert.source_repository_json)||{};
    const build=parseJson(cert.build_evidence_json)||{};
    const staging=parseJson(cert.staging_deployment_json)||{};
    const trace=parseJson(cert.trace_snapshot_json)||{};
    const gates=parseJson(cert.gate_snapshot_json)||{};
    evidence.projectIdentity=projectIdentity;
    evidence.sourceRepository=source;
    evidence.buildEvidence=build;
    evidence.stagingDeployment=staging;
    evidence.traceSnapshot=trace;
    evidence.gateSnapshot=gates;
    if(projectIdentity.realProject!==true||upper(projectIdentity.domainKey)!=='DEPARTMENT_REGISTRATION')
      reasons.push('REAL_PRODUCT_PROJECT_REQUIRED');
    if(!SHA40.test(String(source.exactCommitSha||''))||upper(source.pullRequest?.state)!=='MERGED'||source.pullRequest?.merged!==true)
      reasons.push('REAL_SOURCE_NOT_FROZEN');
    if(upper(build.status)!=='SUCCESS')reasons.push('REAL_BUILD_NOT_SUCCESS');
    if(upper(staging.status)!=='SUCCESS'||upper(staging.environment)!=='STAGING')
      reasons.push('REAL_STAGING_NOT_SUCCESS');
    if(Object.values(trace.traceChecks||{}).some(v=>v!==true))
      reasons.push('FINAL_TRACEABILITY_INCOMPLETE');
    if(Object.values(gates).some(v=>v!=='PASS'))
      reasons.push('FINAL_GATE_SNAPSHOT_INCOMPLETE');
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    \`INSERT INTO product_m2711_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)\`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getProductDevelopmentFinalState=async projectId=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const [certs,gates]=await Promise.all([
    db.execute('SELECT * FROM product_development_e2e_certifications WHERE project_id=? ORDER BY certified_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m2711_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    certifications:certs.map(x=>({
      id:x.id,certificationKey:x.certification_key,status:x.status,
      projectIdentity:parseJson(x.project_identity_json),sourceRepository:parseJson(x.source_repository_json),
      buildEvidence:parseJson(x.build_evidence_json),stagingDeployment:parseJson(x.staging_deployment_json),
      codeEvidence:parseJson(x.code_evidence_json),testEvidence:parseJson(x.test_evidence_json),
      traceSnapshot:parseJson(x.trace_snapshot_json),gateSnapshot:parseJson(x.gate_snapshot_json),
      certifiedAt:x.certified_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
