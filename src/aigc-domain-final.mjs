import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-DOMAIN-FINAL';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
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
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const latestGate=async(db,table,projectId,gateKey)=>{
  const row=await one(db,
    `SELECT id,status,as_of FROM ${table}
      WHERE project_id=? AND gate_key=?
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [projectId,gateKey]
  );
  return row?{id:row.id,status:row.status,asOf:row.as_of}:null;
};

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Domain Final Gate requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};

const currentReviewArchive=async(projectId,db)=>{
  const review=await one(db,
    "SELECT * FROM aigc_review_cycles WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  const archive=review?await one(db,
    "SELECT * FROM aigc_archive_packages WHERE project_id=? AND review_cycle_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId,review.id]
  ):null;
  return {review,archive};
};

export const resolveAigcDomainFinalProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createAigcRealProjectE2EAttestation=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'reviewCycleId','archivePackageId','attestationMode','decision','attestedByRef',
    'attestedAt','scope','provenance','evidence'
  ],'INVALID_AIGC_REAL_PROJECT_E2E_ATTESTATION');

  const mode=String(input.attestationMode).trim().toUpperCase();
  const decision=String(input.decision).trim().toUpperCase();
  const synthetic=input.isSynthetic===true;
  if(!['APPROVED','REJECTED'].includes(decision))throw errorOf(
    'Attestation decision must be APPROVED or REJECTED',
    'AIGC_REAL_PROJECT_ATTESTATION_DECISION_INVALID',409
  );
  if(decision==='APPROVED'&&(mode!=='HUMAN'||synthetic))throw errorOf(
    'Real project E2E APPROVED attestation requires HUMAN and non-synthetic evidence',
    'AIGC_REAL_PROJECT_HUMAN_ATTESTATION_REQUIRED',409,
    {attestationMode:mode,isSynthetic:synthetic}
  );
  if(mode==='CI'||mode==='AUTO'||mode==='AUTOMATION')throw errorOf(
    'CI/automation cannot attest a real AIGC project E2E PASS',
    'AIGC_REAL_PROJECT_HUMAN_ATTESTATION_REQUIRED',409
  );
  const attestedAt=new Date(input.attestedAt);
  if(Number.isNaN(attestedAt.getTime()))throw errorOf('Invalid attestedAt','INVALID_DATE');

  const db=getRuntimePool(),{review,archive}=await currentReviewArchive(projectId,db);
  if(!review||review.id!==input.reviewCycleId||!archive||archive.id!==input.archivePackageId)
    throw errorOf(
      'Real E2E attestation must bind current frozen Review and Archive',
      'AIGC_REAL_PROJECT_CURRENT_REVIEW_ARCHIVE_REQUIRED',409,
      {currentReviewCycleId:review?.id||null,currentArchivePackageId:archive?.id||null}
    );
  const performance=await latestGate(db,'aigc_m2815_gate_evaluations',projectId,'G-AIGC-PERFORMANCE');
  const reviewGate=await latestGate(db,'aigc_m2816_gate_evaluations',projectId,'G-AIGC-REVIEW');
  if(performance?.status!=='PASS'||reviewGate?.status!=='PASS')throw errorOf(
    'Real E2E attestation requires PASS Performance and Review gates',
    'AIGC_REAL_PROJECT_REVIEW_PASS_REQUIRED',409
  );

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_real_project_e2e_attestations
      (id,project_id,review_cycle_id,archive_package_id,attestation_mode,decision,attested_by_ref,
       attested_at,is_synthetic,scope_json,provenance_json,evidence_json,status,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?)`,
    [
      id,projectId,review.id,archive.id,mode,decision,input.attestedByRef,attestedAt,synthetic?1:0,
      asJson(input.scope),asJson(input.provenance),asJson(input.evidence),actorId
    ]
  );
  return {id,projectId,reviewCycleId:review.id,archivePackageId:archive.id,
    attestationMode:mode,decision,isSynthetic:synthetic,attestedAt};
};

const criterion=(number,name,pass,evidence)=>({
  number:String(number).padStart(2,'0'),name,status:pass?'PASS':'HOLD',pass:Boolean(pass),evidence
});

export const evaluateAigcDomainFinalGate=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool(),asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');

  const [
    script,sceneCount,shotCount,assetCount,generationCount,timeline,distributionPackage,
    milestoneCount,productionPlanCount,marketCount,creativeReferenceCount,modelBenchmarkCount,
    changeRequestCount,changeImpactCount,callSheetCount,preflightCount,referenceBindingCount,
    selectEventCount,restoreEventCount,lockEventCount,lineageJobs,totalJobs,
    trackCount,clipCount,reviewThreadCount,renderCount,localizationCount,
    releasePlan,publishedCount,verifiedCount,reviewKnowledgeDomains
  ]=await Promise.all([
    one(db,`SELECT s.id,l.id lock_id FROM aigc_script_versions s
      JOIN aigc_script_locks l ON l.script_version_id=s.id
      WHERE s.project_id=? AND s.status='LOCKED' ORDER BY s.version_no DESC LIMIT 1`,[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_scenes WHERE project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_shots WHERE project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_assets WHERE owner_project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_generation_jobs WHERE project_id=?',[projectId]),
    one(db,"SELECT id FROM aigc_timeline_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]),
    one(db,"SELECT id FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]),
    count(db,'SELECT COUNT(*) count FROM project_milestones WHERE project_id=?',[projectId]),
    count(db,"SELECT COUNT(*) count FROM aigc_production_plans WHERE project_id=? AND status='FROZEN'",[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_market_benchmarks WHERE project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_creative_references WHERE project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_model_tool_benchmarks WHERE project_id=?',[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_script_change_requests WHERE project_id=?',[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_script_change_impacts i
      JOIN aigc_script_change_requests r ON r.id=i.script_change_request_id WHERE r.project_id=?`,[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_asset_call_sheets WHERE project_id=?',[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_asset_call_sheets
      WHERE project_id=? AND JSON_UNQUOTE(JSON_EXTRACT(preflight_json,'$.status'))='PASS'`,[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_call_sheet_reference_bindings WHERE project_id=?',[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_candidate_selection_events WHERE project_id=? AND event_type='SELECT'`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_candidate_selection_events WHERE project_id=? AND event_type='RESTORE'`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_candidate_selection_events WHERE project_id=? AND event_type='LOCK'`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_generation_jobs
      WHERE project_id=? AND model_tool IS NOT NULL AND model_tool_version IS NOT NULL
        AND prompt_version IS NOT NULL AND reference_bindings_json IS NOT NULL
        AND parameters_json IS NOT NULL AND cost_json IS NOT NULL AND provenance_json IS NOT NULL`,[projectId]),
    count(db,'SELECT COUNT(*) count FROM aigc_generation_jobs WHERE project_id=?',[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_timeline_tracks t
      JOIN aigc_timeline_versions v ON v.id=t.timeline_version_id
      WHERE v.project_id=?`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_timeline_clips c
      JOIN aigc_timeline_versions v ON v.id=c.timeline_version_id
      WHERE v.project_id=?`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_timeline_review_threads r
      JOIN aigc_timeline_versions v ON v.id=r.timeline_version_id
      WHERE v.project_id=?`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_render_exports e
      JOIN aigc_timeline_versions v ON v.id=e.timeline_version_id
      WHERE v.project_id=?`,[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_content_derivation_versions
      WHERE project_id=? AND localization_level<>'NONE' AND status='READY'`,[projectId]),
    one(db,"SELECT id FROM aigc_release_plans WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]),
    count(db,"SELECT COUNT(*) count FROM aigc_publication_records WHERE project_id=? AND status='PUBLISHED'",[projectId]),
    count(db,`SELECT COUNT(*) count FROM aigc_post_publish_verifications v
      JOIN aigc_publication_records r ON r.id=v.publication_record_id
      WHERE r.project_id=? AND v.status='PASS'`,[projectId]),
    count(db,`SELECT COUNT(DISTINCT k.domain_key) count FROM aigc_knowledge_records k
      JOIN aigc_review_cycles r ON r.id=k.review_cycle_id
      WHERE k.project_id=? AND k.status='APPROVED' AND r.status='FROZEN' AND r.is_current=TRUE`,[projectId])
  ]);

  const [assetGate,imageGate,productionGate,editGate,masterGate,complianceGate,
    distributionGate,publishGate,performanceGate,reviewGate]=await Promise.all([
    latestGate(db,'aigc_m288_gate_evaluations',projectId,'G-AIGC-ASSET'),
    latestGate(db,'aigc_m289_gate_evaluations',projectId,'G-AIGC-IMAGE'),
    latestGate(db,'aigc_m2810_gate_evaluations',projectId,'G-AIGC-PRODUCTION'),
    latestGate(db,'aigc_m2811_gate_evaluations',projectId,'G-AIGC-EDIT'),
    latestGate(db,'aigc_master_gate_evaluations',projectId,'G-AIGC-MASTER'),
    latestGate(db,'aigc_master_gate_evaluations',projectId,'G-AIGC-COMPLIANCE'),
    latestGate(db,'aigc_m2813_gate_evaluations',projectId,'G-AIGC-DISTRIBUTION-PACKAGE'),
    latestGate(db,'aigc_m2814_gate_evaluations',projectId,'G-AIGC-PUBLISH'),
    latestGate(db,'aigc_m2815_gate_evaluations',projectId,'G-AIGC-PERFORMANCE'),
    latestGate(db,'aigc_m2816_gate_evaluations',projectId,'G-AIGC-REVIEW')
  ]);

  const milestoneIntelligenceColumns=await count(db,
    `SELECT COUNT(*) count FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='project_milestones'
        AND column_name IN ('management_status','health','forecast_end','update_cadence_days')`
  );
  const lockedCandidateCount=await count(db,
    "SELECT COUNT(*) count FROM aigc_generation_candidates WHERE project_id=? AND selection_status='LOCKED' AND is_current=TRUE",
    [projectId]
  );
  const provenanceCount=await count(db,
    "SELECT COUNT(*) count FROM aigc_trace_links WHERE project_id=?",[projectId]
  );
  const {review,archive}=await currentReviewArchive(projectId,db);
  const realAttestation=await one(db,
    `SELECT * FROM aigc_real_project_e2e_attestations
      WHERE project_id=? AND decision='APPROVED' AND attestation_mode='HUMAN'
        AND is_synthetic=FALSE AND status='ACTIVE'
      ORDER BY attested_at DESC LIMIT 1`,[projectId]
  );

  const criteria=[
    criterion(1,'Project / Version / Scene / Shot / Asset / Generation / Timeline / Distribution 层级可运行',
      Boolean(script&&sceneCount>0&&shotCount>0&&assetCount>0&&generationCount>0&&timeline&&distributionPackage),
      {scriptVersionId:script?.id||null,sceneCount,shotCount,assetCount,generationCount,
       timelineVersionId:timeline?.id||null,distributionPackageId:distributionPackage?.id||null}),
    criterion(2,'AIGC Milestone Roll-up / Forecast / Health / Budget / Update 可运行',
      milestoneCount>0&&productionPlanCount>0&&milestoneIntelligenceColumns===4,
      {milestoneCount,productionPlanCount,milestoneIntelligenceColumns}),
    criterion(3,'Market / Competitor / Creative Reference / Model Tool Benchmark 正式对象化',
      marketCount>0&&creativeReferenceCount>0&&modelBenchmarkCount>0,
      {marketBenchmarkCount:marketCount,creativeReferenceCount,modelToolBenchmarkCount:modelBenchmarkCount}),
    criterion(4,'Story / Script 具有 Lock / Change / Impact',
      Boolean(script&&changeRequestCount>0&&changeImpactCount>0),
      {scriptLockId:script?.lock_id||null,changeRequestCount,changeImpactCount}),
    criterion(5,'Shot / Asset Coverage 自动识别 READY / BLOCKED',
      assetGate?.status==='PASS'&&shotCount>0&&callSheetCount>0,
      {gate:assetGate,shotCount,callSheetCount}),
    criterion(6,'Call Sheet / Preflight / Reference Role / Immutable Runtime 执行',
      callSheetCount>0&&preflightCount===callSheetCount&&referenceBindingCount>0&&lockedCandidateCount>0,
      {callSheetCount,preflightPassCount:preflightCount,referenceBindingCount,lockedCandidateCount}),
    criterion(7,'Generation Job / Candidate / Selection / History / Restore / Lock 可追溯',
      generationCount>0&&selectEventCount>0&&restoreEventCount>0&&lockEventCount>0,
      {generationCount,selectEventCount,restoreEventCount,lockEventCount}),
    criterion(8,'Model / Tool / Prompt / Reference / Parameter / Cost / QA 全量血缘',
      totalJobs>0&&lineageJobs===totalJobs&&provenanceCount>0,
      {totalGenerationJobs:totalJobs,lineageCompleteJobs:lineageJobs,traceLinkCount:provenanceCount}),
    criterion(9,'Image / Video / Audio / Edit / Master QA Matrix 完整',
      [imageGate,productionGate,editGate,masterGate].every(x=>x?.status==='PASS'),
      {imageGate,productionGate,editGate,masterGate}),
    criterion(10,'Timeline / Track / Clip / timecode feedback 可管理',
      Boolean(timeline&&trackCount>0&&clipCount>0&&reviewThreadCount>0&&renderCount>0),
      {timelineVersionId:timeline?.id||null,trackCount,clipCount,reviewThreadCount,renderCount}),
    criterion(11,'Rights / License / AI Disclosure / Content Provenance 可 Gate',
      complianceGate?.status==='PASS'&&publishGate?.status==='PASS'&&provenanceCount>0,
      {complianceGate,publishGate,traceLinkCount:provenanceCount}),
    criterion(12,'Localization / Distribution Version / Publication / Post-publish Verification 可运行',
      distributionGate?.status==='PASS'&&Boolean(distributionPackage&&releasePlan)&&
        localizationCount>0&&publishedCount>0&&verifiedCount>0,
      {distributionGate,distributionPackageId:distributionPackage?.id||null,
       releasePlanId:releasePlan?.id||null,localizationReadyCount:localizationCount,
       publishedCount,verifiedCount}),
    criterion(13,'Production + Performance 指标可解释并回到 Review / Knowledge',
      performanceGate?.status==='PASS'&&reviewGate?.status==='PASS'&&
        Boolean(review&&archive)&&reviewKnowledgeDomains===6,
      {performanceGate,reviewGate,reviewCycleId:review?.id||null,archivePackageId:archive?.id||null,
       knowledgeDomainCount:reviewKnowledgeDomains}),
    criterion(14,'至少一个真实 AIGC 项目从 Discovery 到 Performance Review E2E PASS',
      Boolean(realAttestation),
      {attestationId:realAttestation?.id||null,attestationMode:realAttestation?.attestation_mode||null,
       attestedByRef:realAttestation?.attested_by_ref||null,isSynthetic:realAttestation?Boolean(realAttestation.is_synthetic):null})
  ];

  const reasons=criteria.filter(x=>!x.pass).map(x=>
    x.number==='14'?'AIGC_REAL_PROJECT_E2E_REQUIRED':`AIGC_DOMAIN_FINAL_CRITERION_${x.number}_NOT_PASS`
  );
  const status=reasons.length?'HOLD':'PASS';
  const evidence={
    project:{id:project.id,projectKey:project.project_key,name:project.name},
    criteriaPassed:criteria.filter(x=>x.pass).length,
    criteriaTotal:14,
    realProjectE2EAttested:Boolean(realAttestation),
    syntheticEvidenceCannotSatisfyCriterion14:true
  };
  const result={projectId,gateKey:GATE,status,criteria,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_domain_final_gate_evaluations
      (id,project_id,gate_key,status,criteria_json,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,status,asJson(criteria),asJson(reasons),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcDomainFinalState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [attestations,evaluations]=await Promise.all([
    db.execute(
      `SELECT id,review_cycle_id,archive_package_id,attestation_mode,decision,attested_by_ref,
              attested_at,is_synthetic,status,scope_json,provenance_json
         FROM aigc_real_project_e2e_attestations WHERE project_id=? ORDER BY attested_at,id`,
      [projectId]).then(x=>x[0]),
    db.execute(
      `SELECT * FROM aigc_domain_final_gate_evaluations
        WHERE project_id=? ORDER BY as_of,created_at,id`,[projectId]).then(x=>x[0])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['AIGC 领域最终验收','真实项目 E2E 实证'],
      gateName:'AIGC 领域最终门禁',
      realProjectPolicy:'第 14 条只接受 HUMAN + 非合成真实项目 E2E 实证；CI / 自动化不能使最终门禁 PASS'
    },
    attestations:attestations.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,archivePackageId:x.archive_package_id,
      attestationMode:x.attestation_mode,decision:x.decision,attestedByRef:x.attested_by_ref,
      attestedAt:x.attested_at,isSynthetic:Boolean(x.is_synthetic),status:x.status,
      scope:parseJson(x.scope_json),provenance:parseJson(x.provenance_json)
    })),
    evaluations:evaluations.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,criteria:parseJson(x.criteria_json),
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),
      asOf:x.as_of
    }))
  };
};
