import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { createProjectBaseline } from './project-governance.mjs';

const CONFIDENCE=new Set(['LOW','MEDIUM','HIGH']);
const EVIDENCE_SOURCES=new Set([
  'USER_INTERVIEW','USER_FEEDBACK','SUPPORT','SALES','OPERATIONS','PRODUCT_DATA',
  'BUSINESS_DATA','INCIDENT','RELIABILITY','RESEARCH','MARKET','COMPETITOR',
  'BUSINESS_REQUIREMENT','TECHNICAL_REQUIREMENT','SECURITY_REQUIREMENT','COMPLIANCE_REQUIREMENT'
]);
const RESEARCH_METHODS=new Set(['INTERVIEW','USABILITY','SURVEY','SUPPORT','SALES','OPERATIONS','ANALYTICS','FIELD_OBSERVATION']);
const OPPORTUNITY_TYPES=new Set(['PROBLEM','OPPORTUNITY']);
const PRIORITY_OUTPUTS=new Set(['DO_NOW','PLAN','EXPERIMENT','RESEARCH_MORE','PARK','REJECT']);
const REQUIREMENT_TYPES=new Set([
  'BUSINESS','USER','FUNCTIONAL','NON_FUNCTIONAL','DATA','INTEGRATION','COMPLIANCE','AI_BEHAVIOR'
]);
const REQUIREMENT_STATUSES=new Set(['DRAFT','APPROVED','CURRENT','DEPRECATED','REJECTED']);
const PRODUCT_GATES=new Set(['G-PD-DISCOVERY','G-PD-PRIORITY','G-PD-GOAL','G-PD-PRODUCT']);
const TRACE_TYPES=new Set([
  'RESEARCH_STUDY','EVIDENCE','INSIGHT','OPPORTUNITY','SOLUTION_CANDIDATE','HYPOTHESIS','PRIORITIZATION',
  'GOAL','PRODUCT_BET','REQUIREMENT','REQUIREMENT_VERSION','PRODUCT_BASELINE',
  'PROJECT_BASELINE','PROJECT_DECISION','BENCHMARK_SNAPSHOT'
]);

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
const dateOrNull=v=>v?new Date(v):null;
const assertEnum=(value,set,code,label)=>{
  const x=upper(value);
  if(!set.has(x))throw errorOf(`Unsupported ${label}`,code,400,{value});
  return x;
};
const normalizeEvidence=row=>({
  id:row.id,projectId:row.project_id,researchStudyId:row.research_study_id||null,evidenceKey:row.evidence_key,sourceType:row.source_type,
  sourceRef:row.source_ref||null,sourceDate:row.source_date||null,timeRange:parseJson(row.time_range_json),
  segment:parseJson(row.segment_json),context:parseJson(row.context_json),observation:row.observation,
  rawEvidence:parseJson(row.raw_evidence_json),confidence:row.confidence,
  limitation:parseJson(row.limitation_json),freshnessExpiresAt:row.freshness_expires_at||null,
  privacy:parseJson(row.privacy_json),status:row.status,createdAt:row.created_at
});
const normalizeRequirementVersion=row=>({
  id:row.id,requirementId:row.requirement_id,projectId:row.project_id,versionNo:Number(row.version_no),
  userRoleSegment:parseJson(row.user_role_segment_json),scenario:parseJson(row.scenario_json),
  useCaseJob:parseJson(row.use_case_job_json),businessRules:parseJson(row.business_rules_json),
  preconditions:parseJson(row.preconditions_json),mainFlow:parseJson(row.main_flow_json),
  alternateFlow:parseJson(row.alternate_flow_json),exceptionFlow:parseJson(row.exception_flow_json),
  stateMatrix:parseJson(row.state_matrix_json),inScope:parseJson(row.in_scope_json),
  outOfScope:parseJson(row.out_of_scope_json),assumptions:parseJson(row.assumptions_json),
  openQuestions:parseJson(row.open_questions_json),priority:row.priority,
  acceptanceCriteria:parseJson(row.acceptance_criteria_json),metric:parseJson(row.metric_json),
  dependency:parseJson(row.dependency_json),risk:parseJson(row.risk_json),
  evidenceLinks:parseJson(row.evidence_links_json),changeId:row.change_id||null,
  evidence:parseJson(row.evidence_json),createdAt:row.created_at
});

const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key,status,current_baseline_id FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Product domain objects require PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409,
    {projectType:rows[0].project_type}
  );
  return rows[0];
};
const assertProjectObject=async(db,table,id,projectId,code='PRODUCT_OBJECT_NOT_FOUND')=>{
  const [rows]=await db.execute(`SELECT project_id FROM ${table} WHERE id=?`,[id]);
  if(!rows.length)throw errorOf('Product object not found',code,404,{id});
  if(rows[0].project_id!==projectId)throw errorOf('Product object scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
};
const TRACE_TABLES={
  RESEARCH_STUDY:'product_research_studies',EVIDENCE:'product_evidence',INSIGHT:'product_insights',
  OPPORTUNITY:'product_opportunities',SOLUTION_CANDIDATE:'product_solution_candidates',
  HYPOTHESIS:'product_hypotheses',PRIORITIZATION:'product_prioritization_records',
  GOAL:'product_goal_definitions',PRODUCT_BET:'product_bets',REQUIREMENT:'product_requirements',
  REQUIREMENT_VERSION:'product_requirement_versions',PRODUCT_BASELINE:'product_requirement_baselines',
  PROJECT_BASELINE:'project_baselines',PROJECT_DECISION:'project_decisions'
};
const assertTraceObject=async(db,type,id,projectId)=>{
  const t=assertEnum(type,TRACE_TYPES,'INVALID_PRODUCT_TRACE_TYPE','trace object type');
  if(t==='BENCHMARK_SNAPSHOT'){
    const [rows]=await db.execute(
      `SELECT s.project_id FROM benchmark_snapshots b JOIN benchmark_subjects s ON s.id=b.subject_id WHERE b.id=?`,
      [id]
    );
    if(!rows.length)throw errorOf('Trace object not found','PRODUCT_TRACE_OBJECT_NOT_FOUND',404,{type:t,id});
    if(rows[0].project_id!==projectId)throw errorOf('Trace object scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{type:t,id});
    return;
  }
  const table=TRACE_TABLES[t];
  if(!table)throw errorOf('Trace object type is not resolvable','PRODUCT_TRACE_OBJECT_NOT_RESOLVABLE',409,{type:t});
  await assertProjectObject(db,table,id,projectId,'PRODUCT_TRACE_OBJECT_NOT_FOUND');
};

const createTraceInternal=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,createdByIdentityId})=>{
  const s=assertEnum(sourceType,TRACE_TYPES,'INVALID_PRODUCT_TRACE_TYPE','trace sourceType');
  const t=assertEnum(targetType,TRACE_TYPES,'INVALID_PRODUCT_TRACE_TYPE','trace targetType');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [id,projectId,s,sourceId,t,targetId,upper(linkType||'SUPPORTS'),asJson(evidence||null),createdByIdentityId||null]
  );
  const [rows]=await db.execute(
    `SELECT * FROM product_trace_links WHERE project_id=? AND source_type=? AND source_id=?
      AND target_type=? AND target_id=? AND link_type=?`,
    [projectId,s,sourceId,t,targetId,upper(linkType||'SUPPORTS')]
  );
  const row=rows[0];
  return {id:row.id,projectId,sourceType:s,sourceId,targetType:t,targetId,linkType:row.link_type,evidence:parseJson(row.evidence_json)};
};

export const resolveProductProjectScope=async projectId=>{
  const p=await loadProductProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};
export const resolveProductRequirementScope=async requirementId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,p.workspace_id FROM product_requirements r JOIN projects p ON p.id=r.project_id WHERE r.id=?`,
    [requirementId]
  );
  if(!rows.length)throw errorOf('Product requirement not found','PRODUCT_REQUIREMENT_NOT_FOUND',404);
  return {requirementId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createProductResearchStudy=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.researchKey||!input.objective||!input.researchQuestion||!input.method||
     !nonEmpty(input.sample)||!nonEmpty(input.rawEvidenceLocator))throw errorOf(
    'researchKey, objective, researchQuestion, method, sample and rawEvidenceLocator are required',
    'INVALID_PRODUCT_RESEARCH_STUDY'
  );
  const method=assertEnum(input.method,RESEARCH_METHODS,'INVALID_PRODUCT_RESEARCH_METHOD','research method');
  const confidence=assertEnum(input.confidence||'MEDIUM',CONFIDENCE,'INVALID_PRODUCT_CONFIDENCE','confidence');
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO product_research_studies
      (id,project_id,research_key,objective,research_question,method,participant_segment_json,sample_json,
       recruitment_json,time_range_json,consent_privacy_json,recording_boundary_json,raw_evidence_locator_json,
       confidence,limitation_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.researchKey,input.objective,input.researchQuestion,method,
     asJson(input.participantSegment||null),asJson(input.sample),asJson(input.recruitment||null),
     asJson(input.timeRange||null),asJson(input.consentPrivacy||null),asJson(input.recordingBoundary||null),
     asJson(input.rawEvidenceLocator),confidence,asJson(input.limitation||null),upper(input.status||'ACTIVE'),
     asJson(input.evidence||null),actorId]
  );
  return {id,projectId,researchKey:input.researchKey,objective:input.objective,researchQuestion:input.researchQuestion,method,confidence,status:upper(input.status||'ACTIVE')};
};

export const createProductEvidence=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.evidenceKey||!input.sourceType||!input.observation||!nonEmpty(input.rawEvidence))throw errorOf(
    'evidenceKey, sourceType, observation and rawEvidence are required','INVALID_PRODUCT_EVIDENCE'
  );
  const sourceType=assertEnum(input.sourceType,EVIDENCE_SOURCES,'INVALID_PRODUCT_EVIDENCE_SOURCE','evidence sourceType');
  const confidence=assertEnum(input.confidence||'MEDIUM',CONFIDENCE,'INVALID_PRODUCT_CONFIDENCE','confidence');
  const db=getRuntimePool(),id=randomUUID();
  if(input.researchStudyId)await assertProjectObject(db,'product_research_studies',input.researchStudyId,projectId,'PRODUCT_RESEARCH_STUDY_NOT_FOUND');
  await db.execute(
    `INSERT INTO product_evidence
      (id,project_id,research_study_id,evidence_key,source_type,source_ref,source_date,time_range_json,segment_json,context_json,
       observation,raw_evidence_json,confidence,limitation_json,freshness_expires_at,privacy_json,status,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.researchStudyId||null,input.evidenceKey,sourceType,input.sourceRef||null,input.sourceDate||null,
     asJson(input.timeRange||null),asJson(input.segment||null),asJson(input.context||null),
     input.observation,asJson(input.rawEvidence),confidence,asJson(input.limitation||null),
     dateOrNull(input.freshnessExpiresAt),asJson(input.privacy||null),upper(input.status||'ACTIVE'),actorId]
  );
  if(input.researchStudyId)await createTraceInternal(db,{
    projectId,sourceType:'RESEARCH_STUDY',sourceId:input.researchStudyId,targetType:'EVIDENCE',targetId:id,
    linkType:'PRODUCES',createdByIdentityId:actorId
  });
  const [rows]=await db.execute('SELECT * FROM product_evidence WHERE id=?',[id]);
  return normalizeEvidence(rows[0]);
};

export const createProductInsight=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.insightKey||!input.title||!input.observation||!Array.isArray(input.evidenceIds)||!input.evidenceIds.length)throw errorOf(
    'insightKey, title, observation and evidenceIds are required','INVALID_PRODUCT_INSIGHT'
  );
  const db=getRuntimePool();
  for(const id of input.evidenceIds)await assertProjectObject(db,'product_evidence',id,projectId,'PRODUCT_EVIDENCE_NOT_FOUND');
  const id=randomUUID(),confidence=assertEnum(input.confidence||'MEDIUM',CONFIDENCE,'INVALID_PRODUCT_CONFIDENCE','confidence');
  await db.execute(
    `INSERT INTO product_insights
      (id,project_id,insight_key,title,observation,user_context_json,confidence,freshness_expires_at,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.insightKey,input.title,input.observation,asJson(input.userContext||null),confidence,
     dateOrNull(input.freshnessExpiresAt),upper(input.status||'ACTIVE'),asJson(input.evidence||null),actorId]
  );
  for(const evidenceId of input.evidenceIds)await createTraceInternal(db,{
    projectId,sourceType:'EVIDENCE',sourceId:evidenceId,targetType:'INSIGHT',targetId:id,
    linkType:'SUPPORTS',evidence:{declaredBy:'product-insight'},createdByIdentityId:actorId
  });
  return {id,projectId,insightKey:input.insightKey,title:input.title,observation:input.observation,confidence,evidenceIds:input.evidenceIds};
};

export const createProductOpportunity=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.opportunityKey||!input.title||!input.painOpportunity||!nonEmpty(input.impact)||!Array.isArray(input.insightIds)||!input.insightIds.length)throw errorOf(
    'opportunityKey, title, painOpportunity, impact and insightIds are required','INVALID_PRODUCT_OPPORTUNITY'
  );
  const db=getRuntimePool();
  for(const id of input.insightIds)await assertProjectObject(db,'product_insights',id,projectId,'PRODUCT_INSIGHT_NOT_FOUND');
  const type=assertEnum(input.opportunityType||'OPPORTUNITY',OPPORTUNITY_TYPES,'INVALID_PRODUCT_OPPORTUNITY_TYPE','opportunityType');
  const confidence=assertEnum(input.confidence||'MEDIUM',CONFIDENCE,'INVALID_PRODUCT_CONFIDENCE','confidence');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_opportunities
      (id,project_id,opportunity_key,opportunity_type,title,user_role_json,scenario_json,pain_opportunity,impact_json,
       existing_workaround_json,frequency,severity,unknowns_json,confidence,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.opportunityKey,type,input.title,asJson(input.userRole||null),asJson(input.scenario||null),
     input.painOpportunity,asJson(input.impact),asJson(input.existingWorkaround||null),input.frequency||null,
     input.severity||null,asJson(input.unknowns||null),confidence,upper(input.status||'OPEN'),asJson(input.evidence||null),actorId]
  );
  for(const insightId of input.insightIds)await createTraceInternal(db,{
    projectId,sourceType:'INSIGHT',sourceId:insightId,targetType:'OPPORTUNITY',targetId:id,
    linkType:'SUPPORTS',createdByIdentityId:actorId
  });
  return {id,projectId,opportunityKey:input.opportunityKey,opportunityType:type,title:input.title,status:upper(input.status||'OPEN'),insightIds:input.insightIds};
};

export const createSolutionCandidate=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.opportunityId||!input.candidateKey||!input.title||!input.summary)throw errorOf(
    'opportunityId, candidateKey, title and summary are required','INVALID_SOLUTION_CANDIDATE'
  );
  const db=getRuntimePool();
  await assertProjectObject(db,'product_opportunities',input.opportunityId,projectId,'PRODUCT_OPPORTUNITY_NOT_FOUND');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_solution_candidates
      (id,project_id,opportunity_id,candidate_key,title,summary,assumptions_json,constraints_json,evidence_json,status,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.opportunityId,input.candidateKey,input.title,input.summary,asJson(input.assumptions||null),
     asJson(input.constraints||null),asJson(input.evidence||null),upper(input.status||'CANDIDATE'),actorId]
  );
  await createTraceInternal(db,{projectId,sourceType:'OPPORTUNITY',sourceId:input.opportunityId,targetType:'SOLUTION_CANDIDATE',targetId:id,linkType:'EXPLORES',createdByIdentityId:actorId});
  return {id,projectId,opportunityId:input.opportunityId,candidateKey:input.candidateKey,title:input.title,status:upper(input.status||'CANDIDATE')};
};

export const createProductHypothesis=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.opportunityId||!input.hypothesisKey||!input.statement||!nonEmpty(input.validationMethod)||!nonEmpty(input.successSignal))throw errorOf(
    'opportunityId, hypothesisKey, statement, validationMethod and successSignal are required','INVALID_PRODUCT_HYPOTHESIS'
  );
  const db=getRuntimePool();
  await assertProjectObject(db,'product_opportunities',input.opportunityId,projectId,'PRODUCT_OPPORTUNITY_NOT_FOUND');
  if(input.solutionCandidateId)await assertProjectObject(db,'product_solution_candidates',input.solutionCandidateId,projectId,'SOLUTION_CANDIDATE_NOT_FOUND');
  const id=randomUUID(),confidence=assertEnum(input.confidence||'MEDIUM',CONFIDENCE,'INVALID_PRODUCT_CONFIDENCE','confidence');
  await db.execute(
    `INSERT INTO product_hypotheses
      (id,project_id,opportunity_id,solution_candidate_id,hypothesis_key,statement,validation_method_json,success_signal_json,
       confidence,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.opportunityId,input.solutionCandidateId||null,input.hypothesisKey,input.statement,
     asJson(input.validationMethod),asJson(input.successSignal),confidence,upper(input.status||'OPEN'),asJson(input.evidence||null),actorId]
  );
  await createTraceInternal(db,{projectId,sourceType:'OPPORTUNITY',sourceId:input.opportunityId,targetType:'HYPOTHESIS',targetId:id,linkType:'TESTED_BY',createdByIdentityId:actorId});
  if(input.solutionCandidateId)await createTraceInternal(db,{projectId,sourceType:'SOLUTION_CANDIDATE',sourceId:input.solutionCandidateId,targetType:'HYPOTHESIS',targetId:id,linkType:'VALIDATED_BY',createdByIdentityId:actorId});
  return {id,projectId,opportunityId:input.opportunityId,hypothesisKey:input.hypothesisKey,statement:input.statement,confidence};
};

export const createProductPrioritization=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.opportunityId||!input.prioritizationKey||!nonEmpty(input.scoreInputs)||!input.output||!input.rationale||!input.decisionId||!nonEmpty(input.evidence))throw errorOf(
    'opportunityId, prioritizationKey, scoreInputs, output, rationale, decisionId and evidence are required','INVALID_PRODUCT_PRIORITIZATION'
  );
  const db=getRuntimePool();
  await assertProjectObject(db,'product_opportunities',input.opportunityId,projectId,'PRODUCT_OPPORTUNITY_NOT_FOUND');
  if(input.hypothesisId)await assertProjectObject(db,'product_hypotheses',input.hypothesisId,projectId,'PRODUCT_HYPOTHESIS_NOT_FOUND');
  await assertProjectObject(db,'project_decisions',input.decisionId,projectId,'PROJECT_DECISION_NOT_FOUND');
  const requiredScoreDimensions=[
    'goalFit','impact','evidenceStrength','reachFrequency','confidence',
    'effort','riskDependency','timeCriticality','opportunityCost'
  ];
  const missingScoreDimensions=requiredScoreDimensions.filter(key=>input.scoreInputs?.[key]==null);
  if(missingScoreDimensions.length)throw errorOf(
    'Prioritization scoreInputs must include all required decision dimensions',
    'PRODUCT_PRIORITY_DIMENSIONS_REQUIRED',409,{missing:missingScoreDimensions}
  );
  const output=assertEnum(input.output,PRIORITY_OUTPUTS,'INVALID_PRODUCT_PRIORITY_OUTPUT','priority output');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_prioritization_records
      (id,project_id,opportunity_id,hypothesis_id,prioritization_key,scoring_model,score_inputs_json,
       computed_score,output,rationale,decision_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.opportunityId,input.hypothesisId||null,input.prioritizationKey,upper(input.scoringModel||'CUSTOM'),
     asJson(input.scoreInputs),input.computedScore==null?null:Number(input.computedScore),output,input.rationale,
     input.decisionId,asJson(input.evidence),actorId]
  );
  await createTraceInternal(db,{projectId,sourceType:'OPPORTUNITY',sourceId:input.opportunityId,targetType:'PRIORITIZATION',targetId:id,linkType:'PRIORITIZED_BY',createdByIdentityId:actorId});
  await createTraceInternal(db,{projectId,sourceType:'PRIORITIZATION',sourceId:id,targetType:'PROJECT_DECISION',targetId:input.decisionId,linkType:'DECIDED_BY',createdByIdentityId:actorId});
  return {id,projectId,opportunityId:input.opportunityId,hypothesisId:input.hypothesisId||null,output,decisionId:input.decisionId,computedScore:input.computedScore??null};
};

export const createProductGoal=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.goalKey||!input.businessGoal||!input.productGoal||!nonEmpty(input.primaryMetric)||!nonEmpty(input.qualitativeAcceptance))throw errorOf(
    'goalKey, businessGoal, productGoal, primaryMetric and qualitativeAcceptance are required','INVALID_PRODUCT_GOAL'
  );
  const db=getRuntimePool(),id=randomUUID();
  await db.execute("UPDATE product_goal_definitions SET status='HISTORICAL' WHERE project_id=? AND status='CURRENT'",[projectId]);
  await db.execute(
    `INSERT INTO product_goal_definitions
      (id,project_id,goal_key,business_goal,product_goal,primary_metric_json,guardrail_metrics_json,
       qualitative_acceptance_json,target_window,target_version,non_goals_json,decision_owner_identity_id,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CURRENT',?)`,
    [id,projectId,input.goalKey,input.businessGoal,input.productGoal,asJson(input.primaryMetric),
     asJson(input.guardrailMetrics||null),asJson(input.qualitativeAcceptance),input.targetWindow||null,
     input.targetVersion||null,asJson(input.nonGoals||null),input.decisionOwnerIdentityId||actorId||null,asJson(input.evidence||null)]
  );
  return {id,projectId,goalKey:input.goalKey,businessGoal:input.businessGoal,productGoal:input.productGoal,status:'CURRENT'};
};

export const createProductBet=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.goalDefinitionId||!input.opportunityId||!input.betKey||!input.statement||!nonEmpty(input.expectedOutcome)||!nonEmpty(input.evidence))throw errorOf(
    'goalDefinitionId, opportunityId, betKey, statement, expectedOutcome and evidence are required','INVALID_PRODUCT_BET'
  );
  const db=getRuntimePool();
  await assertProjectObject(db,'product_goal_definitions',input.goalDefinitionId,projectId,'PRODUCT_GOAL_NOT_FOUND');
  await assertProjectObject(db,'product_opportunities',input.opportunityId,projectId,'PRODUCT_OPPORTUNITY_NOT_FOUND');
  if(input.hypothesisId)await assertProjectObject(db,'product_hypotheses',input.hypothesisId,projectId,'PRODUCT_HYPOTHESIS_NOT_FOUND');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_bets
      (id,project_id,goal_definition_id,opportunity_id,hypothesis_id,bet_key,statement,expected_outcome_json,
       constraints_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.goalDefinitionId,input.opportunityId,input.hypothesisId||null,input.betKey,input.statement,
     asJson(input.expectedOutcome),asJson(input.constraints||null),upper(input.status||'APPROVED'),asJson(input.evidence),actorId]
  );
  await createTraceInternal(db,{projectId,sourceType:'OPPORTUNITY',sourceId:input.opportunityId,targetType:'PRODUCT_BET',targetId:id,linkType:'SELECTED_FOR',createdByIdentityId:actorId});
  await createTraceInternal(db,{projectId,sourceType:'GOAL',sourceId:input.goalDefinitionId,targetType:'PRODUCT_BET',targetId:id,linkType:'GOVERNS',createdByIdentityId:actorId});
  return {id,projectId,goalDefinitionId:input.goalDefinitionId,opportunityId:input.opportunityId,betKey:input.betKey,status:upper(input.status||'APPROVED')};
};

const validateRequirementPayload=input=>{
  const required=['scenario','businessRules','mainFlow','stateMatrix','inScope','outOfScope','acceptanceCriteria','metric','evidenceLinks'];
  const missing=required.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Requirement version is incomplete','INVALID_PRODUCT_REQUIREMENT_VERSION',400,{missing});
};
const insertRequirementVersion=async(db,{requirementId,projectId,versionNo,input,changeId,actorId})=>{
  validateRequirementPayload(input);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_requirement_versions
      (id,requirement_id,project_id,version_no,user_role_segment_json,scenario_json,use_case_job_json,business_rules_json,
       preconditions_json,main_flow_json,alternate_flow_json,exception_flow_json,state_matrix_json,in_scope_json,
       out_of_scope_json,assumptions_json,open_questions_json,priority,acceptance_criteria_json,metric_json,
       dependency_json,risk_json,evidence_links_json,change_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,requirementId,projectId,versionNo,asJson(input.userRoleSegment||null),asJson(input.scenario),
     asJson(input.useCaseJob||null),asJson(input.businessRules),asJson(input.preconditions||null),
     asJson(input.mainFlow),asJson(input.alternateFlow||null),asJson(input.exceptionFlow||null),asJson(input.stateMatrix),
     asJson(input.inScope),asJson(input.outOfScope),asJson(input.assumptions||null),asJson(input.openQuestions||null),
     upper(input.priority||'MEDIUM'),asJson(input.acceptanceCriteria),asJson(input.metric),asJson(input.dependency||null),
     asJson(input.risk||null),asJson(input.evidenceLinks),changeId||null,asJson(input.evidence||null),actorId]
  );
  return id;
};

export const createProductRequirement=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.requirementKey||!input.requirementType||!input.title)throw errorOf(
    'requirementKey, requirementType and title are required','INVALID_PRODUCT_REQUIREMENT'
  );
  const requirementType=assertEnum(input.requirementType,REQUIREMENT_TYPES,'INVALID_PRODUCT_REQUIREMENT_TYPE','requirementType');
  const status=assertEnum(input.status||'DRAFT',REQUIREMENT_STATUSES,'INVALID_PRODUCT_REQUIREMENT_STATUS','requirement status');
  const db=getRuntimePool(),conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_requirements
        (id,project_id,requirement_key,requirement_type,title,status,current_version_no,owner_identity_id)
       VALUES (?,?,?,?,?,?,1,?)`,
      [id,projectId,input.requirementKey,requirementType,input.title,status,input.ownerIdentityId||actorId||null]
    );
    const versionId=await insertRequirementVersion(conn,{requirementId:id,projectId,versionNo:1,input,changeId:null,actorId});
    for(const link of input.traceFrom||[]){
      await assertTraceObject(conn,link.sourceType,link.sourceId,projectId);
      await createTraceInternal(conn,{
        projectId,sourceType:link.sourceType,sourceId:link.sourceId,targetType:'REQUIREMENT',
        targetId:id,linkType:link.linkType||'JUSTIFIES',evidence:link.evidence,createdByIdentityId:actorId
      });
    }
    await conn.commit();
    return {id,projectId,requirementKey:input.requirementKey,requirementType,title:input.title,status,currentVersionNo:1,currentVersionId:versionId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const reviseProductRequirement=async(requirementId,input={},actorId=null)=>{
  if(!input.changeId)throw errorOf('Requirement revision requires changeId','PRODUCT_REQUIREMENT_CHANGE_REQUIRED',409);
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_requirements WHERE id=? FOR UPDATE',[requirementId]);
    if(!rows.length)throw errorOf('Product requirement not found','PRODUCT_REQUIREMENT_NOT_FOUND',404);
    const req=rows[0];
    await assertProjectObject(conn,'project_changes',input.changeId,req.project_id,'PROJECT_CHANGE_NOT_FOUND');
    const versionNo=Number(req.current_version_no)+1;
    const versionId=await insertRequirementVersion(conn,{requirementId,projectId:req.project_id,versionNo,input,changeId:input.changeId,actorId});
    const status=input.status?assertEnum(input.status,REQUIREMENT_STATUSES,'INVALID_PRODUCT_REQUIREMENT_STATUS','requirement status'):req.status;
    await conn.execute('UPDATE product_requirements SET current_version_no=?,status=? WHERE id=?',[versionNo,status,requirementId]);
    await conn.commit();
    return {id:requirementId,projectId:req.project_id,requirementKey:req.requirement_key,status,currentVersionNo:versionNo,currentVersionId:versionId,changeId:input.changeId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createProductTraceLink=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.sourceType||!input.sourceId||!input.targetType||!input.targetId)throw errorOf(
    'sourceType, sourceId, targetType and targetId are required','INVALID_PRODUCT_TRACE_LINK'
  );
  const db=getRuntimePool();
  await assertTraceObject(db,input.sourceType,input.sourceId,projectId);
  await assertTraceObject(db,input.targetType,input.targetId,projectId);
  return createTraceInternal(db,{projectId,...input,createdByIdentityId:actorId});
};

const counts=async(db,projectId)=>{
  const [[row]]=await db.execute(
    `SELECT
      (SELECT COUNT(*) FROM product_evidence WHERE project_id=? AND status='ACTIVE') evidence_count,
      (SELECT COUNT(*) FROM product_insights WHERE project_id=? AND status='ACTIVE') insight_count,
      (SELECT COUNT(*) FROM product_opportunities WHERE project_id=? AND status NOT IN ('REJECTED','CLOSED')) opportunity_count,
      (SELECT COUNT(*) FROM product_solution_candidates WHERE project_id=? AND status<>'REJECTED') candidate_count,
      (SELECT COUNT(*) FROM product_hypotheses WHERE project_id=? AND status NOT IN ('REJECTED','CLOSED')) hypothesis_count,
      (SELECT COUNT(*) FROM product_prioritization_records WHERE project_id=?) priority_count,
      (SELECT COUNT(*) FROM product_goal_definitions WHERE project_id=? AND status='CURRENT') goal_count,
      (SELECT COUNT(*) FROM product_bets WHERE project_id=? AND status='APPROVED') bet_count,
      (SELECT COUNT(*) FROM product_requirements WHERE project_id=? AND status IN ('APPROVED','CURRENT')) requirement_count,
      (SELECT COUNT(*) FROM benchmark_subjects s JOIN benchmark_snapshots b ON b.subject_id=s.id
         WHERE s.project_id=? AND s.benchmark_type='PRODUCT_MARKET' AND b.status='CURRENT') benchmark_count`,
    Array(10).fill(projectId)
  );
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v||0)]));
};
const traceCount=async(db,projectId,sourceType,targetType)=>{
  const [[row]]=await db.execute(
    'SELECT COUNT(*) AS count FROM product_trace_links WHERE project_id=? AND source_type=? AND target_type=?',
    [projectId,sourceType,targetType]
  );
  return Number(row.count||0);
};
const currentRequirements=async(db,projectId)=>{
  const [rows]=await db.execute(
    `SELECT r.*,v.id version_id,v.version_no,v.acceptance_criteria_json,v.metric_json,v.evidence_links_json,
            v.business_rules_json,v.in_scope_json,v.out_of_scope_json,v.created_at version_created_at
       FROM product_requirements r
       JOIN product_requirement_versions v ON v.requirement_id=r.id AND v.version_no=r.current_version_no
      WHERE r.project_id=? AND r.status IN ('APPROVED','CURRENT')
      ORDER BY r.requirement_key`,[projectId]
  );
  return rows;
};
const productGateReadiness=async(projectId,gateKey,{asOf=new Date(),ignoreBaselineFreshness=false}={})=>{
  const gate=assertEnum(gateKey,PRODUCT_GATES,'INVALID_PRODUCT_GATE','product gate');
  const db=getRuntimePool();
  await loadProductProject(projectId,db);
  const c=await counts(db,projectId),reasons=[],evidence={counts:c};
  if(gate==='G-PD-DISCOVERY'){
    const atDate=new Date(asOf);
    const [[freshEvidence]]=await db.execute(
      `SELECT COUNT(*) AS count FROM product_evidence
        WHERE project_id=? AND status='ACTIVE'
          AND (freshness_expires_at IS NULL OR freshness_expires_at>=?)`,
      [projectId,atDate]
    );
    const [[freshBenchmark]]=await db.execute(
      `SELECT COUNT(*) AS count
         FROM benchmark_subjects s JOIN benchmark_snapshots b ON b.subject_id=s.id
        WHERE s.project_id=? AND s.benchmark_type='PRODUCT_MARKET' AND b.status='CURRENT'
          AND b.observed_at<=?
          AND (b.freshness_days IS NULL OR DATE_ADD(b.observed_at, INTERVAL b.freshness_days DAY)>=?)`,
      [projectId,atDate,atDate]
    );
    evidence.freshEvidenceCount=Number(freshEvidence.count||0);
    evidence.freshCompetitiveSnapshotCount=Number(freshBenchmark.count||0);
    if(!c.evidence_count)reasons.push('EVIDENCE_REQUIRED');
    else if(!evidence.freshEvidenceCount)reasons.push('EVIDENCE_STALE');
    if(!c.insight_count)reasons.push('INSIGHT_REQUIRED');
    if(!c.opportunity_count)reasons.push('PROBLEM_OR_OPPORTUNITY_REQUIRED');
    if(!c.benchmark_count)reasons.push('COMPETITIVE_SNAPSHOT_REQUIRED');
    else if(!evidence.freshCompetitiveSnapshotCount)reasons.push('COMPETITIVE_SNAPSHOT_STALE');
    if(await traceCount(db,projectId,'EVIDENCE','INSIGHT')<1)reasons.push('EVIDENCE_INSIGHT_TRACE_REQUIRED');
    if(await traceCount(db,projectId,'INSIGHT','OPPORTUNITY')<1)reasons.push('INSIGHT_OPPORTUNITY_TRACE_REQUIRED');
  }
  if(gate==='G-PD-PRIORITY'){
    const discovery=await productGateReadiness(projectId,'G-PD-DISCOVERY',{asOf});
    if(discovery.status!=='PASS')reasons.push('DISCOVERY_NOT_READY');
    if(!c.candidate_count)reasons.push('SOLUTION_CANDIDATE_REQUIRED');
    if(!c.hypothesis_count)reasons.push('HYPOTHESIS_REQUIRED');
    if(!c.priority_count)reasons.push('PRIORITIZATION_DECISION_REQUIRED');
  }
  if(gate==='G-PD-GOAL'){
    const priority=await productGateReadiness(projectId,'G-PD-PRIORITY',{asOf});
    if(priority.status!=='PASS')reasons.push('PRIORITY_NOT_READY');
    if(!c.goal_count)reasons.push('GOAL_DEFINITION_REQUIRED');
    if(!c.bet_count)reasons.push('PRODUCT_BET_REQUIRED');
  }
  if(gate==='G-PD-PRODUCT'){
    const goal=await productGateReadiness(projectId,'G-PD-GOAL',{asOf});
    if(goal.status!=='PASS')reasons.push('GOAL_NOT_READY');
    const reqs=await currentRequirements(db,projectId);
    evidence.requirements=reqs.map(r=>({id:r.id,key:r.requirement_key,versionNo:Number(r.version_no),versionId:r.version_id}));
    if(!reqs.length)reasons.push('APPROVED_REQUIREMENT_REQUIRED');
    for(const req of reqs){
      if(!nonEmpty(parseJson(req.acceptance_criteria_json)))reasons.push(`ACCEPTANCE_CRITERIA_REQUIRED:${req.requirement_key}`);
      if(!nonEmpty(parseJson(req.metric_json)))reasons.push(`METRIC_REQUIRED:${req.requirement_key}`);
      if(!nonEmpty(parseJson(req.evidence_links_json)))reasons.push(`EVIDENCE_LINK_REQUIRED:${req.requirement_key}`);
      if(!nonEmpty(parseJson(req.business_rules_json)))reasons.push(`BUSINESS_RULE_REQUIRED:${req.requirement_key}`);
    }
    if(reqs.length){
      const evidenceTrace=(await traceCount(db,projectId,'EVIDENCE','REQUIREMENT'))+
        (await traceCount(db,projectId,'INSIGHT','REQUIREMENT'));
      const opportunityTrace=(await traceCount(db,projectId,'OPPORTUNITY','REQUIREMENT'))+
        (await traceCount(db,projectId,'PRODUCT_BET','REQUIREMENT'));
      const goalTrace=await traceCount(db,projectId,'GOAL','REQUIREMENT');
      if(!evidenceTrace)reasons.push('EVIDENCE_OR_INSIGHT_REQUIREMENT_TRACE_REQUIRED');
      if(!opportunityTrace)reasons.push('BET_OR_OPPORTUNITY_REQUIREMENT_TRACE_REQUIRED');
      if(!goalTrace)reasons.push('GOAL_REQUIREMENT_TRACE_REQUIRED');
    }
    if(!ignoreBaselineFreshness){
      const [baselines]=await db.execute(
        "SELECT locked_at FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' ORDER BY locked_at DESC LIMIT 1",
        [projectId]
      );
      if(baselines.length&&reqs.some(r=>new Date(r.version_created_at)>new Date(baselines[0].locked_at)))reasons.push('REQUIREMENT_BASELINE_STALE');
    }
  }
  return {projectId,gateKey:gate,status:reasons.length?'HOLD':'PASS',reasonCodes:reasons,evidenceSnapshot:evidence,asOf:new Date(asOf)};
};

export const evaluateProductGate=async(projectId,gateKey,input={},actorId=null)=>{
  const result=await productGateReadiness(projectId,gateKey,{asOf:input.asOf||new Date()});
  if(input.persist!==false){
    const db=getRuntimePool();
    await db.execute(
      `INSERT INTO product_gate_evaluations
        (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,result.gateKey,result.status,asJson(result.reasonCodes),asJson(result.evidenceSnapshot),result.asOf,actorId]
    );
  }
  return result;
};

export const createProductRequirementBaseline=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  if(!input.baselineKey||!input.goalDefinitionId||!input.productBetId||!nonEmpty(input.scope)||
     !nonEmpty(input.businessRules)||!nonEmpty(input.acceptanceCriteria)||!nonEmpty(input.metric)||
     !nonEmpty(input.keyDecisions)||!nonEmpty(input.outOfScope)||!nonEmpty(input.evidence))throw errorOf(
    'baselineKey, goalDefinitionId, productBetId, scope, businessRules, acceptanceCriteria, metric, keyDecisions, outOfScope and evidence are required',
    'INVALID_PRODUCT_REQUIREMENT_BASELINE'
  );
  const db=getRuntimePool();
  await assertProjectObject(db,'product_goal_definitions',input.goalDefinitionId,projectId,'PRODUCT_GOAL_NOT_FOUND');
  await assertProjectObject(db,'product_bets',input.productBetId,projectId,'PRODUCT_BET_NOT_FOUND');
  const readiness=await productGateReadiness(projectId,'G-PD-PRODUCT',{asOf:input.asOf||new Date(),ignoreBaselineFreshness:true});
  if(readiness.status!=='PASS')throw errorOf('Product definition gate is not ready','PRODUCT_DEFINITION_GATE_BLOCKED',409,{reasonCodes:readiness.reasonCodes});
  const reqs=await currentRequirements(db,projectId);
  const requirementVersions=reqs.map(r=>({
    requirementId:r.id,requirementKey:r.requirement_key,versionNo:Number(r.version_no),versionId:r.version_id
  }));
  const projectBaseline=await createProjectBaseline(projectId,{
    versionLabel:input.versionLabel||input.baselineKey,
    scope:input.scope,outOfScope:input.outOfScope,
    decisions:input.keyDecisions,
    snapshot:{
      domain:'PRODUCT_DEVELOPMENT',productBaselineKey:input.baselineKey,
      goalDefinitionId:input.goalDefinitionId,productBetId:input.productBetId,
      requirementVersions,businessRules:input.businessRules,
      acceptanceCriteria:input.acceptanceCriteria,metric:input.metric
    },
    evidence:input.evidence,createdByIdentityId:actorId
  });
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const id=randomUUID();
    const [previous]=await conn.execute(
      "SELECT id FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' FOR UPDATE",[projectId]
    );
    await conn.execute(
      `INSERT INTO product_requirement_baselines
        (id,project_id,project_baseline_id,baseline_key,goal_definition_id,product_bet_id,requirement_versions_json,
         scope_json,business_rules_json,acceptance_criteria_json,metric_json,key_decisions_json,out_of_scope_json,
         status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT',?,?)`,
      [id,projectId,projectBaseline.id,input.baselineKey,input.goalDefinitionId,input.productBetId,
       asJson(requirementVersions),asJson(input.scope),asJson(input.businessRules),asJson(input.acceptanceCriteria),
       asJson(input.metric),asJson(input.keyDecisions),asJson(input.outOfScope),asJson(input.evidence),actorId]
    );
    for(const row of previous)await conn.execute(
      "UPDATE product_requirement_baselines SET status='HISTORICAL',replaced_by_id=? WHERE id=?",[id,row.id]
    );
    for(const req of requirementVersions){
      await createTraceInternal(conn,{projectId,sourceType:'REQUIREMENT_VERSION',sourceId:req.versionId,targetType:'PRODUCT_BASELINE',targetId:id,linkType:'LOCKED_IN',createdByIdentityId:actorId});
    }
    await createTraceInternal(conn,{projectId,sourceType:'PRODUCT_BASELINE',sourceId:id,targetType:'PROJECT_BASELINE',targetId:projectBaseline.id,linkType:'MATERIALIZED_AS',createdByIdentityId:actorId});
    await conn.execute(
      `INSERT INTO product_gate_evaluations
        (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,'G-PD-PRODUCT','PASS',asJson([]),
       asJson({productBaselineId:id,projectBaselineId:projectBaseline.id,requirementVersions}),new Date(input.asOf||Date.now()),actorId]
    );
    await conn.commit();
    return {id,projectId,baselineKey:input.baselineKey,status:'CURRENT',projectBaselineId:projectBaseline.id,requirementVersions};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const getProductDiscoveryState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [researchStudies,evidence,insights,opportunities,candidates,hypotheses,priorities,goals,bets,requirements,baselines,traces,gates]=await Promise.all([
    db.execute('SELECT * FROM product_research_studies WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_evidence WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_insights WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_opportunities WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_solution_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_hypotheses WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_prioritization_records WHERE project_id=? ORDER BY decided_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_goal_definitions WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_bets WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute(`SELECT r.*,v.id version_id,v.version_no,v.change_id,v.created_at version_created_at
      FROM product_requirements r JOIN product_requirement_versions v
        ON v.requirement_id=r.id AND v.version_no=r.current_version_no
      WHERE r.project_id=? ORDER BY r.requirement_key`,[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_requirement_baselines WHERE project_id=? ORDER BY locked_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_trace_links WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    researchStudies:researchStudies.map(r=>({
      id:r.id,researchKey:r.research_key,objective:r.objective,researchQuestion:r.research_question,
      method:r.method,confidence:r.confidence,status:r.status
    })),
    evidence:evidence.map(normalizeEvidence),
    insights:insights.map(r=>({id:r.id,insightKey:r.insight_key,title:r.title,observation:r.observation,confidence:r.confidence,status:r.status})),
    opportunities:opportunities.map(r=>({id:r.id,opportunityKey:r.opportunity_key,type:r.opportunity_type,title:r.title,status:r.status,confidence:r.confidence})),
    solutionCandidates:candidates.map(r=>({id:r.id,opportunityId:r.opportunity_id,candidateKey:r.candidate_key,title:r.title,status:r.status})),
    hypotheses:hypotheses.map(r=>({id:r.id,opportunityId:r.opportunity_id,hypothesisKey:r.hypothesis_key,statement:r.statement,status:r.status})),
    prioritizations:priorities.map(r=>({id:r.id,opportunityId:r.opportunity_id,hypothesisId:r.hypothesis_id,prioritizationKey:r.prioritization_key,output:r.output,decisionId:r.decision_id,computedScore:r.computed_score==null?null:Number(r.computed_score)})),
    goals:goals.map(r=>({id:r.id,goalKey:r.goal_key,businessGoal:r.business_goal,productGoal:r.product_goal,status:r.status,primaryMetric:parseJson(r.primary_metric_json)})),
    productBets:bets.map(r=>({id:r.id,betKey:r.bet_key,goalDefinitionId:r.goal_definition_id,opportunityId:r.opportunity_id,hypothesisId:r.hypothesis_id,status:r.status})),
    requirements:requirements.map(r=>({id:r.id,requirementKey:r.requirement_key,requirementType:r.requirement_type,title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no),currentVersionId:r.version_id,changeId:r.change_id||null})),
    baselines:baselines.map(r=>({id:r.id,baselineKey:r.baseline_key,status:r.status,projectBaselineId:r.project_baseline_id,lockedAt:r.locked_at,replacedById:r.replaced_by_id||null,requirementVersions:parseJson(r.requirement_versions_json)})),
    traces:traces.map(r=>({id:r.id,sourceType:r.source_type,sourceId:r.source_id,targetType:r.target_type,targetId:r.target_id,linkType:r.link_type})),
    gateEvaluations:gates.map(r=>({id:r.id,gateKey:r.gate_key,status:r.status,reasonCodes:parseJson(r.reason_codes_json),asOf:r.as_of}))
  };
};

export const getProductRequirement=async requirementId=>{
  const db=getRuntimePool();
  const [reqs]=await db.execute('SELECT * FROM product_requirements WHERE id=?',[requirementId]);
  if(!reqs.length)throw errorOf('Product requirement not found','PRODUCT_REQUIREMENT_NOT_FOUND',404);
  const [versions]=await db.execute('SELECT * FROM product_requirement_versions WHERE requirement_id=? ORDER BY version_no',[requirementId]);
  const r=reqs[0];
  return {
    id:r.id,projectId:r.project_id,requirementKey:r.requirement_key,requirementType:r.requirement_type,
    title:r.title,status:r.status,currentVersionNo:Number(r.current_version_no),
    versions:versions.map(normalizeRequirementVersion)
  };
};
