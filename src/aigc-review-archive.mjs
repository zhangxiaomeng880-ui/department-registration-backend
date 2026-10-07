import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-REVIEW';
const KNOWLEDGE_DOMAINS=['STORY','VISUAL','AUDIO','PRODUCTION','DISTRIBUTION','PERFORMANCE'];
const KNOWLEDGE_TYPES=new Set(['KNOWLEDGE','PATTERN','ANTI_PATTERN']);
const IMPROVEMENT_TYPES=new Set([
  'ASSET','MODEL_TOOL','AGENT','SKILL','PROMPT','WORKFLOW','PRODUCTION','DISTRIBUTION'
]);
const PRIORITIES=new Set(['P0','P1','P2','P3']);
const PROPOSAL_TYPES=new Set([
  'CONTENT_VERSION','DISTRIBUTION_EXPERIMENT','PRODUCTION_EXPERIMENT',
  'CREATIVE_EXPERIMENT','STORY_RULE_CHANGE'
]);
const REVIEW_DIMENSIONS=[
  'plannedVsActual','assetCoverageReuse','generationFailureModes','modelToolQualityCostLatency',
  'firstPassRegenerationQa','timelineEditingRework','distributionPerformance','localizationRoi',
  'rightsCompliance','agentSkillPromptWorkflow'
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
    'AIGC Review requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const latestPerformanceGate=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT * FROM aigc_m2815_gate_evaluations
      WHERE project_id=? AND gate_key='G-AIGC-PERFORMANCE'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[projectId]
  );
  return rows[0]||null;
};
const currentObjects=async(projectId,db)=>{
  const [[master],[pkg],[release]]=await Promise.all([
    db.execute("SELECT * FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]).then(x=>x[0]),
    db.execute("SELECT * FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]).then(x=>x[0]),
    db.execute("SELECT * FROM aigc_release_plans WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",[projectId]).then(x=>x[0])
  ]);
  return {master:master||null,pkg:pkg||null,release:release||null};
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
const reviewScope=async(id)=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.project_id,p.workspace_id FROM aigc_review_cycles r
      JOIN projects p ON p.id=r.project_id WHERE r.id=?`,[id]
  );
  if(!rows.length)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const resolveAigcReviewProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveAigcReviewScope=reviewScope;
export const resolveAigcProposalScope=async proposalId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT n.project_id,p.workspace_id FROM aigc_next_version_proposals n
      JOIN projects p ON p.id=n.project_id WHERE n.id=?`,[proposalId]
  );
  if(!rows.length)throw errorOf('Next version proposal not found','AIGC_NEXT_VERSION_PROPOSAL_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcReviewCycle=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'reviewKey','versionNo','performanceGateEvaluationId','reviewWindow','plannedActual',
    'reviewDimensions','findings','improvementSummary','evidence'
  ],'INVALID_AIGC_REVIEW_CYCLE');
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)
    throw errorOf('Review versionNo must be positive integer','AIGC_REVIEW_VERSION_INVALID',409);
  const missingDimensions=REVIEW_DIMENSIONS.filter(k=>!nonEmpty(input.reviewDimensions?.[k]));
  if(missingDimensions.length)throw errorOf(
    'Review dimensions are incomplete','AIGC_REVIEW_DIMENSIONS_INCOMPLETE',409,{missingDimensions}
  );
  const db=getRuntimePool(),performanceGate=await latestPerformanceGate(projectId,db);
  if(!performanceGate||performanceGate.status!=='PASS'||performanceGate.id!==input.performanceGateEvaluationId)
    throw errorOf(
      'Review must bind latest PASS G-AIGC-PERFORMANCE evaluation',
      'G_AIGC_PERFORMANCE_CURRENT_PASS_REQUIRED',409,
      {latestPerformanceGateId:performanceGate?.id||null,status:performanceGate?.status||null}
    );
  const [candidates]=await db.execute(
    "SELECT id FROM aigc_review_cycles WHERE project_id=? AND status='CANDIDATE' LIMIT 1",[projectId]
  );
  if(candidates.length)throw errorOf(
    'Resolve/freeze current Review candidate before creating another','AIGC_REVIEW_CANDIDATE_EXISTS',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_review_cycles
      (id,project_id,performance_gate_evaluation_id,review_key,version_no,review_window_json,
       planned_actual_json,review_dimensions_json,findings_json,improvement_summary_json,
       status,is_current,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,?,?)`,
    [id,projectId,performanceGate.id,input.reviewKey,versionNo,asJson(input.reviewWindow),
     asJson(input.plannedActual),asJson(input.reviewDimensions),asJson(input.findings),
     asJson(input.improvementSummary),asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId,sourceType:'PERFORMANCE_GATE',sourceId:performanceGate.id,
    targetType:'REVIEW_CYCLE',targetId:id,linkType:'REVIEWS_AS',actorId,
    evidence:{reviewKey:input.reviewKey,versionNo}});
  return {id,projectId,performanceGateEvaluationId:performanceGate.id,
    reviewKey:input.reviewKey,versionNo,status:'CANDIDATE',isCurrent:false};
};

export const createAigcKnowledgeRecord=async(reviewCycleId,input={},actorId=null)=>{
  requireFields(input,[
    'knowledgeKey','domainKey','knowledgeType','statement','applicability','evidenceRefs',
    'confidence','evidence'
  ],'INVALID_AIGC_KNOWLEDGE_RECORD');
  const domain=upper(input.domainKey),type=upper(input.knowledgeType);
  if(!KNOWLEDGE_DOMAINS.includes(domain))throw errorOf(
    'Unsupported knowledge domain','AIGC_KNOWLEDGE_DOMAIN_INVALID',409,{domain}
  );
  if(!KNOWLEDGE_TYPES.has(type))throw errorOf(
    'Unsupported knowledge type','AIGC_KNOWLEDGE_TYPE_INVALID',409,{type}
  );
  if(!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length)throw errorOf(
    'Knowledge needs evidence refs','AIGC_KNOWLEDGE_EVIDENCE_REQUIRED',409
  );
  const db=getRuntimePool();
  const [reviews]=await db.execute('SELECT * FROM aigc_review_cycles WHERE id=?',[reviewCycleId]);
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  if(review.status!=='CANDIDATE')throw errorOf(
    'Knowledge can be added only to CANDIDATE review','AIGC_REVIEW_STATE_INVALID',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_knowledge_records
      (id,project_id,review_cycle_id,knowledge_key,domain_key,knowledge_type,statement_text,
       applicability_json,evidence_refs_json,confidence_json,status,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,'APPROVED',?)`,
    [id,review.project_id,review.id,input.knowledgeKey,domain,type,input.statement,
     asJson(input.applicability),asJson(input.evidenceRefs),asJson(input.confidence),actorId]
  );
  await insertTrace(db,{projectId:review.project_id,sourceType:'REVIEW_CYCLE',sourceId:review.id,
    targetType:'KNOWLEDGE_RECORD',targetId:id,linkType:'LEARNED_AS',actorId,evidence:input.evidence});
  return {id,reviewCycleId:review.id,projectId:review.project_id,
    knowledgeKey:input.knowledgeKey,domainKey:domain,knowledgeType:type,status:'APPROVED'};
};

export const createAigcImprovementItem=async(reviewCycleId,input={},actorId=null)=>{
  requireFields(input,[
    'itemKey','improvementType','title','problem','recommendation','priority',
    'acceptance','evidence'
  ],'INVALID_AIGC_IMPROVEMENT_ITEM');
  const type=upper(input.improvementType),priority=upper(input.priority);
  if(!IMPROVEMENT_TYPES.has(type))throw errorOf(
    'Unsupported improvement type','AIGC_IMPROVEMENT_TYPE_INVALID',409,{type}
  );
  if(!PRIORITIES.has(priority))throw errorOf(
    'Improvement priority must be P0/P1/P2/P3','AIGC_IMPROVEMENT_PRIORITY_INVALID',409,{priority}
  );
  const db=getRuntimePool();
  const [reviews]=await db.execute('SELECT * FROM aigc_review_cycles WHERE id=?',[reviewCycleId]);
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  if(review.status!=='CANDIDATE')throw errorOf(
    'Improvement can be added only to CANDIDATE review','AIGC_REVIEW_STATE_INVALID',409
  );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_improvement_backlog
      (id,project_id,review_cycle_id,item_key,improvement_type,title,problem_json,
       recommendation_json,priority,acceptance_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,'PLANNED',?,?)`,
    [id,review.project_id,review.id,input.itemKey,type,input.title,asJson(input.problem),
     asJson(input.recommendation),priority,asJson(input.acceptance),asJson(input.evidence),actorId]
  );
  return {id,reviewCycleId:review.id,projectId:review.project_id,itemKey:input.itemKey,
    improvementType:type,priority,status:'PLANNED'};
};

export const createAigcNextVersionProposal=async(reviewCycleId,input={},actorId=null)=>{
  requireFields(input,[
    'proposalKey','proposalType','sourceRefs','title','hypothesis','proposedChange',
    'guardrails','evidence'
  ],'INVALID_AIGC_NEXT_VERSION_PROPOSAL');
  const type=upper(input.proposalType);
  if(!PROPOSAL_TYPES.has(type))throw errorOf(
    'Unsupported proposal type','AIGC_NEXT_VERSION_PROPOSAL_TYPE_INVALID',409,{type}
  );
  const db=getRuntimePool();
  const [reviews]=await db.execute('SELECT * FROM aigc_review_cycles WHERE id=?',[reviewCycleId]);
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  if(review.status!=='CANDIDATE')throw errorOf(
    'Proposal can be added only to CANDIDATE review','AIGC_REVIEW_STATE_INVALID',409
  );
  if(type==='STORY_RULE_CHANGE'){
    if(!Array.isArray(input.sourceRefs?.feedbackSignalIds)||!input.sourceRefs.feedbackSignalIds.length)
      throw errorOf('Story Rule proposal requires feedbackSignalIds',
        'AIGC_STORY_RULE_FEEDBACK_REQUIRED',409);
    const ids=[...new Set(input.sourceRefs.feedbackSignalIds)];
    const [signals]=await db.query(
      `SELECT id FROM aigc_feedback_signals
        WHERE project_id=? AND story_rule_change_requested=TRUE
          AND id IN (${ids.map(()=>'?').join(',')})`,
      [review.project_id,...ids]
    );
    if(signals.length!==ids.length)throw errorOf(
      'Story Rule feedback refs are invalid','AIGC_STORY_RULE_FEEDBACK_SCOPE_INVALID',409
    );
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_next_version_proposals
      (id,project_id,review_cycle_id,proposal_key,proposal_type,source_refs_json,title,
       hypothesis_json,proposed_change_json,guardrails_json,status,human_decision_json,
       evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,'CANDIDATE',NULL,?,?)`,
    [id,review.project_id,review.id,input.proposalKey,type,asJson(input.sourceRefs),input.title,
     asJson(input.hypothesis),asJson(input.proposedChange),asJson(input.guardrails),
     asJson(input.evidence),actorId]
  );
  return {id,reviewCycleId:review.id,projectId:review.project_id,
    proposalKey:input.proposalKey,proposalType:type,status:'CANDIDATE',
    humanGateRequired:type==='STORY_RULE_CHANGE'};
};

export const decideAigcNextVersionProposal=async(proposalId,input={},actorId=null)=>{
  requireFields(input,['decision','evidence'],'INVALID_AIGC_NEXT_VERSION_DECISION');
  const decision=input.decision||{},mode=upper(decision.mode),result=upper(decision.decision);
  if(mode!=='HUMAN'||!['APPROVED','REJECTED'].includes(result)||
     !nonEmpty(decision.decidedByRef)||!nonEmpty(decision.decidedAt))
    throw errorOf(
      'Proposal decision requires explicit HUMAN APPROVED/REJECTED evidence',
      'AIGC_NEXT_VERSION_HUMAN_DECISION_REQUIRED',409
    );
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_next_version_proposals WHERE id=?',[proposalId]);
  const proposal=rows[0];
  if(!proposal)throw errorOf('Next version proposal not found','AIGC_NEXT_VERSION_PROPOSAL_NOT_FOUND',404);
  if(proposal.proposal_type!=='STORY_RULE_CHANGE')throw errorOf(
    'Human Story Rule decision endpoint is reserved for Story Rule proposals',
    'AIGC_STORY_RULE_HUMAN_GATE_NOT_REQUIRED',409
  );
  if(['APPROVED','REJECTED'].includes(proposal.status))
    return {id:proposal.id,status:proposal.status,idempotent:true};
  await db.execute(
    `UPDATE aigc_next_version_proposals
        SET status=?,human_decision_json=?,decided_at=?
      WHERE id=?`,
    [result,asJson({...decision,evidence:input.evidence}),new Date(decision.decidedAt),proposal.id]
  );
  await insertTrace(db,{projectId:proposal.project_id,sourceType:'NEXT_VERSION_PROPOSAL',sourceId:proposal.id,
    targetType:'REVIEW_CYCLE',targetId:proposal.review_cycle_id,linkType:'HUMAN_DECIDED_AS',actorId,
    evidence:{decision:result}});
  return {id:proposal.id,reviewCycleId:proposal.review_cycle_id,
    proposalType:proposal.proposal_type,status:result,idempotent:false};
};

export const createAigcArchivePackage=async(reviewCycleId,input={},actorId=null)=>{
  requireFields(input,[
    'archiveKey','versionNo','masterVersionId','distributionPackageId','finalAssets',
    'reconstructableSources','manifests','selectedAssetProvenance','qaEvalEvidence',
    'rightsEvidence','publicationPerformanceSnapshot','retentionPolicy','restoreVerification','evidence'
  ],'INVALID_AIGC_ARCHIVE_PACKAGE');
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Archive versionNo must be positive integer','AIGC_ARCHIVE_VERSION_INVALID',409
  );
  const requiredManifestKeys=['script','shot','timeline','caption','audioTracks'];
  const missingManifests=requiredManifestKeys.filter(k=>!nonEmpty(input.manifests?.[k]));
  if(missingManifests.length)throw errorOf(
    'Archive manifests incomplete','AIGC_ARCHIVE_MANIFEST_INCOMPLETE',409,{missingManifests}
  );
  if(upper(input.restoreVerification?.status)!=='PASS'||!nonEmpty(input.restoreVerification?.evidence))
    throw errorOf('Archive restore verification must PASS','AIGC_ARCHIVE_RESTORE_VERIFICATION_REQUIRED',409);
  const db=getRuntimePool();
  const [reviews]=await db.execute('SELECT * FROM aigc_review_cycles WHERE id=?',[reviewCycleId]);
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  if(review.status!=='CANDIDATE')throw errorOf(
    'Archive can be created only for CANDIDATE review','AIGC_REVIEW_STATE_INVALID',409
  );
  const current=await currentObjects(review.project_id,db);
  if(!current.master||current.master.id!==input.masterVersionId||
     !current.pkg||current.pkg.id!==input.distributionPackageId||
     (input.releasePlanId&&current.release?.id!==input.releasePlanId))
    throw errorOf(
      'Archive must bind current Master / Distribution Package / Release Plan',
      'AIGC_ARCHIVE_CURRENT_OBJECTS_REQUIRED',409,{
        currentMasterVersionId:current.master?.id||null,
        currentDistributionPackageId:current.pkg?.id||null,
        currentReleasePlanId:current.release?.id||null
      }
    );
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_archive_packages
      (id,project_id,review_cycle_id,master_version_id,distribution_package_id,release_plan_id,
       archive_key,version_no,final_assets_json,reconstructable_sources_json,manifests_json,
       selected_asset_provenance_json,qa_eval_evidence_json,rights_evidence_json,
       publication_performance_snapshot_json,retention_policy_json,restore_verification_json,
       status,is_current,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,?,?)`,
    [id,review.project_id,review.id,current.master.id,current.pkg.id,input.releasePlanId||current.release?.id||null,
     input.archiveKey,versionNo,asJson(input.finalAssets),asJson(input.reconstructableSources),
     asJson(input.manifests),asJson(input.selectedAssetProvenance),asJson(input.qaEvalEvidence),
     asJson(input.rightsEvidence),asJson(input.publicationPerformanceSnapshot),
     asJson(input.retentionPolicy),asJson(input.restoreVerification),asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId:review.project_id,sourceType:'REVIEW_CYCLE',sourceId:review.id,
    targetType:'ARCHIVE_PACKAGE',targetId:id,linkType:'ARCHIVES_AS',actorId,
    evidence:{archiveKey:input.archiveKey,versionNo}});
  return {id,reviewCycleId:review.id,projectId:review.project_id,archiveKey:input.archiveKey,
    versionNo,status:'CANDIDATE',isCurrent:false};
};

export const evaluateAigcReviewGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[],evidence={};
  let reviewCycleId=input.reviewCycleId;
  if(!reviewCycleId){
    const [rows]=await db.execute(
      "SELECT id FROM aigc_review_cycles WHERE project_id=? AND status='CANDIDATE' ORDER BY version_no DESC,created_at DESC LIMIT 1",
      [projectId]
    );
    reviewCycleId=rows[0]?.id||null;
  }
  if(!reviewCycleId)throw errorOf('Review cycle is required','AIGC_REVIEW_REQUIRED',409);
  const [reviews]=await db.execute(
    'SELECT * FROM aigc_review_cycles WHERE id=? AND project_id=?',[reviewCycleId,projectId]
  );
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  const performanceGate=await latestPerformanceGate(projectId,db);
  if(!performanceGate||performanceGate.status!=='PASS'||
     review.performance_gate_evaluation_id!==performanceGate.id)
    reasons.push('AIGC_REVIEW_PERFORMANCE_GATE_STALE');

  const reviewDimensions=parseJson(review.review_dimensions_json)||{};
  const missingReviewDimensions=REVIEW_DIMENSIONS.filter(k=>!nonEmpty(reviewDimensions[k]));
  if(missingReviewDimensions.length)reasons.push('AIGC_REVIEW_DIMENSIONS_INCOMPLETE');

  const [knowledge,backlog,proposals,storyFeedback,archives]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_knowledge_records WHERE review_cycle_id=? AND status="APPROVED"',[review.id]),
    listRows(db,'SELECT * FROM aigc_improvement_backlog WHERE review_cycle_id=?',[review.id]),
    listRows(db,'SELECT * FROM aigc_next_version_proposals WHERE review_cycle_id=?',[review.id]),
    listRows(db,'SELECT * FROM aigc_feedback_signals WHERE project_id=? AND story_rule_change_requested=TRUE',[projectId]),
    listRows(db,'SELECT * FROM aigc_archive_packages WHERE review_cycle_id=? AND status="CANDIDATE"',[review.id])
  ]);

  const knowledgeDomains=new Set(knowledge.map(x=>x.domain_key));
  const missingKnowledgeDomains=KNOWLEDGE_DOMAINS.filter(x=>!knowledgeDomains.has(x));
  if(missingKnowledgeDomains.length)reasons.push('AIGC_REVIEW_KNOWLEDGE_DOMAIN_INCOMPLETE');
  if(!backlog.length)reasons.push('AIGC_REVIEW_IMPROVEMENT_BACKLOG_REQUIRED');
  if(!proposals.length)reasons.push('AIGC_REVIEW_NEXT_VERSION_PROPOSAL_REQUIRED');

  const storyProposals=proposals.filter(x=>x.proposal_type==='STORY_RULE_CHANGE');
  const resolvedStoryFeedbackIds=new Set();
  for(const proposal of storyProposals){
    const refs=parseJson(proposal.source_refs_json)||{};
    const decision=parseJson(proposal.human_decision_json)||{};
    const humanResolved=['APPROVED','REJECTED'].includes(proposal.status)&&
      upper(decision.mode)==='HUMAN'&&upper(decision.decision)===proposal.status;
    if(humanResolved){
      for(const id of refs.feedbackSignalIds||[])resolvedStoryFeedbackIds.add(id);
    }
  }
  const unresolvedStoryFeedback=storyFeedback.filter(x=>!resolvedStoryFeedbackIds.has(x.id));
  if(unresolvedStoryFeedback.length)reasons.push('AIGC_STORY_RULE_HUMAN_REVIEW_UNRESOLVED');

  if(archives.length!==1)reasons.push('AIGC_REVIEW_ARCHIVE_CANDIDATE_REQUIRED');
  const archive=archives[0]||null;
  const current=await currentObjects(projectId,db);
  let archiveInvalid=false;
  if(archive){
    const restore=parseJson(archive.restore_verification_json)||{};
    const manifests=parseJson(archive.manifests_json)||{};
    archiveInvalid=
      !current.master||archive.master_version_id!==current.master.id||
      !current.pkg||archive.distribution_package_id!==current.pkg.id||
      (current.release&&archive.release_plan_id!==current.release.id)||
      upper(restore.status)!=='PASS'||
      ['script','shot','timeline','caption','audioTracks'].some(k=>!nonEmpty(manifests[k]))||
      !nonEmpty(parseJson(archive.final_assets_json))||
      !nonEmpty(parseJson(archive.selected_asset_provenance_json))||
      !nonEmpty(parseJson(archive.qa_eval_evidence_json))||
      !nonEmpty(parseJson(archive.rights_evidence_json))||
      !nonEmpty(parseJson(archive.publication_performance_snapshot_json))||
      !nonEmpty(parseJson(archive.retention_policy_json));
    if(archiveInvalid)reasons.push('AIGC_REVIEW_ARCHIVE_INCOMPLETE');
  }

  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  evidence.performanceGateEvaluationId=performanceGate?.id||null;
  evidence.reviewCycleId=review.id;
  evidence.missingReviewDimensions=missingReviewDimensions;
  evidence.knowledgeRecordCount=knowledge.length;
  evidence.knowledgeDomains=[...knowledgeDomains].sort();
  evidence.missingKnowledgeDomains=missingKnowledgeDomains;
  evidence.backlogCount=backlog.length;
  evidence.nextVersionProposalCount=proposals.length;
  evidence.storyRuleFeedbackCount=storyFeedback.length;
  evidence.resolvedStoryRuleFeedbackCount=storyFeedback.length-unresolvedStoryFeedback.length;
  evidence.unresolvedStoryRuleFeedbackIds=unresolvedStoryFeedback.map(x=>x.id);
  evidence.storyRuleChangesRequireHumanGate=true;
  evidence.archivePackageId=archive?.id||null;
  evidence.archiveRestoreVerified=archive?upper((parseJson(archive.restore_verification_json)||{}).status)==='PASS':false;
  evidence.readyToCloseVersion=reasons.length===0;

  const result={projectId,reviewCycleId:review.id,archivePackageId:archive?.id||null,
    gateKey:GATE,status:reasons.length?'HOLD':'PASS',reasonCodes:[...new Set(reasons)],
    evidenceSnapshot:evidence,asOf};
  if(input.persist!==false&&archive)await db.execute(
    `INSERT INTO aigc_m2816_gate_evaluations
      (id,project_id,review_cycle_id,archive_package_id,gate_key,status,reason_codes_json,
       evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,review.id,archive.id,GATE,result.status,
     asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const freezeAigcReviewCycle=async(reviewCycleId,input={},actorId=null)=>{
  requireFields(input,['archivePackageId','evidence'],'INVALID_AIGC_REVIEW_FREEZE');
  const db=getRuntimePool();
  const [reviews]=await db.execute('SELECT * FROM aigc_review_cycles WHERE id=?',[reviewCycleId]);
  const review=reviews[0];
  if(!review)throw errorOf('Review cycle not found','AIGC_REVIEW_NOT_FOUND',404);
  if(review.status==='FROZEN'&&review.is_current)return {
    id:review.id,projectId:review.project_id,status:'FROZEN',isCurrent:true,idempotent:true
  };
  if(review.status!=='CANDIDATE')throw errorOf(
    'Only CANDIDATE review can be frozen','AIGC_REVIEW_STATE_INVALID',409,{status:review.status}
  );
  const [archives]=await db.execute(
    'SELECT * FROM aigc_archive_packages WHERE id=? AND review_cycle_id=?',
    [input.archivePackageId,review.id]
  );
  const archive=archives[0];
  if(!archive||archive.status!=='CANDIDATE')throw errorOf(
    'Review freeze requires CANDIDATE archive package','AIGC_ARCHIVE_CANDIDATE_REQUIRED',409
  );
  const [gates]=await db.execute(
    `SELECT * FROM aigc_m2816_gate_evaluations
      WHERE review_cycle_id=? AND archive_package_id=? AND gate_key=?
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [review.id,archive.id,GATE]
  );
  if(!gates.length||gates[0].status!=='PASS')throw errorOf(
    'G-AIGC-REVIEW must PASS before freeze','G_AIGC_REVIEW_REQUIRED',409
  );

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_review_cycles SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND status='FROZEN' AND is_current=TRUE",
      [review.project_id]
    );
    await conn.execute(
      "UPDATE aigc_archive_packages SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND status='FROZEN' AND is_current=TRUE",
      [review.project_id]
    );
    await conn.execute(
      `UPDATE aigc_review_cycles
          SET status='FROZEN',is_current=TRUE,approval_json=?,frozen_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [asJson(input.approval||{mode:'GATE_PASS'}),review.id]
    );
    await conn.execute(
      `UPDATE aigc_archive_packages
          SET status='FROZEN',is_current=TRUE,frozen_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,[archive.id]
    );
    await insertTrace(conn,{projectId:review.project_id,sourceType:'REVIEW_CYCLE',sourceId:review.id,
      targetType:'ARCHIVE_PACKAGE',targetId:archive.id,linkType:'CLOSES_WITH',actorId,evidence:input.evidence});
    await conn.commit();
    return {id:review.id,projectId:review.project_id,status:'FROZEN',isCurrent:true,
      archivePackageId:archive.id,archiveStatus:'FROZEN',versionClosed:true,idempotent:false};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const getAigcReviewState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [reviews,knowledge,backlog,proposals,archives,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_review_cycles WHERE project_id=? ORDER BY version_no,created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_knowledge_records WHERE project_id=? ORDER BY domain_key,created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_improvement_backlog WHERE project_id=? ORDER BY priority,created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_next_version_proposals WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_archive_packages WHERE project_id=? ORDER BY version_no,created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2816_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['复盘周期','知识沉淀','改进待办','下一版本候选','交付 / 归档包'],
      gateName:'复盘 / 知识 / 下一版本门禁',
      storyRulePolicy:'故事规则变更必须由复盘承接并经过人工批准或拒绝，性能数据不得自动升级故事规则'
    },
    reviews:reviews.map(x=>({
      id:x.id,performanceGateEvaluationId:x.performance_gate_evaluation_id,
      reviewKey:x.review_key,versionNo:Number(x.version_no),reviewWindow:parseJson(x.review_window_json),
      plannedActual:parseJson(x.planned_actual_json),reviewDimensions:parseJson(x.review_dimensions_json),
      findings:parseJson(x.findings_json),improvementSummary:parseJson(x.improvement_summary_json),
      status:x.status,isCurrent:Boolean(x.is_current),approval:parseJson(x.approval_json),frozenAt:x.frozen_at
    })),
    knowledge:knowledge.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,knowledgeKey:x.knowledge_key,domainKey:x.domain_key,
      knowledgeType:x.knowledge_type,statement:x.statement_text,applicability:parseJson(x.applicability_json),
      evidenceRefs:parseJson(x.evidence_refs_json),confidence:parseJson(x.confidence_json),status:x.status
    })),
    improvementBacklog:backlog.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,itemKey:x.item_key,improvementType:x.improvement_type,
      title:x.title,problem:parseJson(x.problem_json),recommendation:parseJson(x.recommendation_json),
      priority:x.priority,acceptance:parseJson(x.acceptance_json),status:x.status
    })),
    nextVersionProposals:proposals.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,proposalKey:x.proposal_key,proposalType:x.proposal_type,
      sourceRefs:parseJson(x.source_refs_json),title:x.title,hypothesis:parseJson(x.hypothesis_json),
      proposedChange:parseJson(x.proposed_change_json),guardrails:parseJson(x.guardrails_json),
      status:x.status,humanDecision:parseJson(x.human_decision_json),decidedAt:x.decided_at
    })),
    archives:archives.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,masterVersionId:x.master_version_id,
      distributionPackageId:x.distribution_package_id,releasePlanId:x.release_plan_id||null,
      archiveKey:x.archive_key,versionNo:Number(x.version_no),finalAssets:parseJson(x.final_assets_json),
      reconstructableSources:parseJson(x.reconstructable_sources_json),manifests:parseJson(x.manifests_json),
      selectedAssetProvenance:parseJson(x.selected_asset_provenance_json),
      qaEvalEvidence:parseJson(x.qa_eval_evidence_json),rightsEvidence:parseJson(x.rights_evidence_json),
      publicationPerformanceSnapshot:parseJson(x.publication_performance_snapshot_json),
      retentionPolicy:parseJson(x.retention_policy_json),restoreVerification:parseJson(x.restore_verification_json),
      status:x.status,isCurrent:Boolean(x.is_current),frozenAt:x.frozen_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,reviewCycleId:x.review_cycle_id,archivePackageId:x.archive_package_id,
      gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
