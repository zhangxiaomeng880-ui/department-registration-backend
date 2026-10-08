-- Criterion 19 C19-P2 real Product self-loop evidence materialization
-- Migration: 075_c19_product_real_self_loop.sql
-- Scope: evidence backfill only. Does NOT create HUMAN real-loop attestation.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Dedicated evidence-mirror project. It represents the real historical outcome,
-- not a synthetic test project and not a claim of Production deployment.
INSERT IGNORE INTO projects
  (id,tenant_id,workspace_id,project_key,name,project_type,status,current_workflow_version,current_knowledge_commit_sha)
VALUES
  ('c1900000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000102',
   'c19-product-real-self-loop',
   'Criterion 19｜科室挂号真实结果证据镜像',
   'PRODUCT_DEVELOPMENT',
   'ACTIVE',
   'C19-P2-REAL-EVIDENCE',
   NULL);

SET @c19_project_id := (
  SELECT id FROM projects WHERE project_key='c19-product-real-self-loop' LIMIT 1
);

-- M29 Data Source / Metric definition.
INSERT IGNORE INTO m29_data_sources
  (id,source_key,display_name,scope_type,tenant_id,workspace_id,project_id,adapter_key,
   connection_ref_json,schema_contract_json,freshness_policy_json,permission_policy_json,status,evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000010',
   'C19-P2-REAL-PRODUCT-REVIEW',
   'Criterion 19｜科室挂号 V1.0 真实质量复盘',
   'PROJECT',
   '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000102',
   @c19_project_id,
   'PRODUCT_OUTCOME',
   JSON_OBJECT(
     'source','LIBRARY_REAL_EVIDENCE_BACKFILL',
     'libraryFileId','libfile_46b76fc847f08191a7d12fd60caa1816',
     'document','AI_Native_产品研发闭环实践复盘_V1.0.docx'
   ),
   JSON_OBJECT(
     'factType','REAL_PROJECT_QUALITY_REVIEW',
     'metric','review_issue_category_count',
     'issueCategories',JSON_ARRAY(
       'RUNNER_WORKFLOW',
       'TOOL_OPERATION_BOUNDARY',
       'ACCEPTANCE_CLASSIFICATION',
       'QA_NOT_RUN_STATE',
       'RESPONSIVE_REQUIREMENT_TIMING',
       'MOCK_API_BOUNDARY'
     )
   ),
   JSON_OBJECT('maxAgeSeconds',315576000,'historicalEvidenceAllowed',TRUE),
   JSON_OBJECT('read','PROJECT_EVIDENCE','write','MIGRATION_BACKFILL_ONLY'),
   'ACTIVE',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE,
     'materializationMode','HISTORICAL_REAL_EVIDENCE_BACKFILL',
     'sourceLibraryFileId','libfile_46b76fc847f08191a7d12fd60caa1816'
   ));

SET @c19_source_id := (
  SELECT id FROM m29_data_sources WHERE source_key='C19-P2-REAL-PRODUCT-REVIEW' LIMIT 1
);

INSERT IGNORE INTO m29_metric_definitions
  (id,source_id,metric_key,display_name,domain_key,value_type,unit,direction,
   extraction_json,dimensions_json,quality_policy_json,status,evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000011',
   @c19_source_id,
   'review_issue_category_count',
   '真实项目复盘问题类别数',
   'PRODUCT',
   'COUNT',
   'issue_categories',
   'LOWER_BETTER',
   JSON_OBJECT('path','value','backfillMode','HISTORICAL_REAL_EVIDENCE'),
   JSON_OBJECT('sourceProject','科室挂号 V1.0','reviewVersion','V1.0'),
   JSON_OBJECT('maxAgeSeconds',315576000,'minSampleSize',1),
   'ACTIVE',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'source','AI_Native_产品研发闭环实践复盘_V1.0.docx'
   ));

SET @c19_metric_id := (
  SELECT id FROM m29_metric_definitions
   WHERE source_id=@c19_source_id AND metric_key='review_issue_category_count'
   LIMIT 1
);

-- Immutable real observation from the owner-authored formal review.
INSERT IGNORE INTO m29_metric_observations
  (id,project_id,metric_definition_id,source_object_type,source_object_id,observation_key,
   numeric_value,dimensions_json,source_quality_status,sample_size,observed_at,source_evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000012',
   @c19_project_id,
   @c19_metric_id,
   'HISTORICAL_PRODUCT_REVIEW',
   'c1900000-0000-4000-8000-000000000013',
   'C19-P2-REAL-REVIEW-ISSUE-CATEGORIES',
   6,
   JSON_OBJECT(
     'sourceProject','科室挂号 V1.0',
     'issueKeys',JSON_ARRAY(
       'RUNNER_WORKFLOW',
       'TOOL_OPERATION_BOUNDARY',
       'ACCEPTANCE_CLASSIFICATION',
       'QA_NOT_RUN_STATE',
       'RESPONSIVE_REQUIREMENT_TIMING',
       'MOCK_API_BOUNDARY'
     ),
     'excludedEstimatedRanges',TRUE
   ),
   'PASS',
   1,
   '2026-08-13 08:59:34.842019',
   JSON_OBJECT(
     'adapterKey','PRODUCT_OUTCOME',
     'factClass','REAL_PROJECT_DELIVERY_OUTCOME',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE,
     'libraryFileId','libfile_46b76fc847f08191a7d12fd60caa1816',
     'sourceDocument','AI_Native_产品研发闭环实践复盘_V1.0.docx',
     'note','Count is derived only from six explicitly documented execution-problem categories; estimated 20%-70% improvement ranges are excluded.'
   ));

SET @c19_observation_id := (
  SELECT id FROM m29_metric_observations
   WHERE project_id=@c19_project_id
     AND observation_key='C19-P2-REAL-REVIEW-ISSUE-CATEGORIES'
   LIMIT 1
);

INSERT IGNORE INTO m29_data_quality_evaluations
  (id,project_id,metric_observation_id,status,freshness_status,completeness_status,
   sample_status,source_quality_status,checks_json,reason_codes_json,evaluated_at,evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000014',
   @c19_project_id,
   @c19_observation_id,
   'PASS',
   'PASS',
   'PASS',
   'PASS',
   'PASS',
   JSON_OBJECT(
     'sourceIsOwnerAuthoredFormalReview',TRUE,
     'issueCountDirectlyDerivable',TRUE,
     'estimatedEfficiencyRangesExcluded',TRUE,
     'minSampleSize',1,
     'historicalEvidencePolicy','PASS'
   ),
   JSON_ARRAY(),
   '2026-10-07 09:50:00.000000',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'dataQualityDecision','PASS',
     'reason','Direct categorical facts from formal project review; no inferred KPI.'
   ));

SET @c19_quality_id := (
  SELECT id FROM m29_data_quality_evaluations
   WHERE metric_observation_id=@c19_observation_id LIMIT 1
);

INSERT IGNORE INTO m29_detection_rules
  (id,project_id,metric_definition_id,rule_key,display_name,operator,threshold_json,
   required_quality_status,severity,dedupe_window_seconds,decision_policy_json,status,evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000015',
   @c19_project_id,
   @c19_metric_id,
   'C19-P2-EXECUTION-CONTRACT-GAPS',
   '真实复盘执行契约缺口检测',
   'GTE',
   JSON_OBJECT('value',1),
   'PASS',
   'HIGH',
   315576000,
   JSON_OBJECT(
     'decisionType','HISTORICAL_HUMAN_DECISION_MATERIALIZATION',
     'recommendedAction','BACKLOG',
     'newApprovalRequired',FALSE,
     'finalRealLoopAttestationStillHumanGate',TRUE
   ),
   'ACTIVE',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'sourceDecision','Formal V1.0 review'
   ));

SET @c19_rule_id := (
  SELECT id FROM m29_detection_rules
   WHERE project_id=@c19_project_id
     AND rule_key='C19-P2-EXECUTION-CONTRACT-GAPS'
   LIMIT 1
);

INSERT IGNORE INTO m29_detection_evaluations
  (id,project_id,detection_rule_id,metric_observation_id,data_quality_evaluation_id,
   matched,evaluated_value,comparison_json,quality_status,evaluated_at,evidence_json)
VALUES
  ('c1900000-0000-4000-8000-000000000016',
   @c19_project_id,
   @c19_rule_id,
   @c19_observation_id,
   @c19_quality_id,
   TRUE,
   6,
   JSON_OBJECT('operator','GTE','threshold',JSON_OBJECT('value',1),'qualityRequired','PASS'),
   'PASS',
   '2026-10-07 09:51:00.000000',
   JSON_OBJECT('criterion','19','subcriterion','C19-P2','matchedRealReviewSignal',TRUE));

INSERT IGNORE INTO m29_detected_signals
  (id,project_id,detection_rule_id,detection_evaluation_id,metric_observation_id,
   signal_key,severity,signal_payload_json,dedupe_key,status,evidence_json,detected_at,resolved_at)
VALUES
  ('c1900000-0000-4000-8000-000000000017',
   @c19_project_id,
   @c19_rule_id,
   'c1900000-0000-4000-8000-000000000016',
   @c19_observation_id,
   'C19-P2-EXECUTION-CONTRACT-GAPS:C19-P2-REAL-REVIEW-ISSUE-CATEGORIES',
   'HIGH',
   JSON_OBJECT(
     'issueCategoryCount',6,
     'signal','Reliable AI delivery needs explicit execution contracts, not merely more AI capability.',
     'issueKeys',JSON_ARRAY(
       'RUNNER_WORKFLOW',
       'TOOL_OPERATION_BOUNDARY',
       'ACCEPTANCE_CLASSIFICATION',
       'QA_NOT_RUN_STATE',
       'RESPONSIVE_REQUIREMENT_TIMING',
       'MOCK_API_BOUNDARY'
     )
   ),
   SHA2('C19-P2-REAL-PRODUCT-REVIEW-SIGNAL',256),
   'CLOSED',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE
   ),
   '2026-08-13 08:59:34.842019',
   '2026-10-07 09:54:00.000000');

SET @c19_signal_id := (
  SELECT id FROM m29_detected_signals
   WHERE dedupe_key=SHA2('C19-P2-REAL-PRODUCT-REVIEW-SIGNAL',256)
   LIMIT 1
);

-- Historical human decision from the formal review. This is not a new automatic decision.
INSERT IGNORE INTO project_decisions
  (id,project_id,decision_key,title,context_json,options_json,decision_json,
   owner_identity_id,approver_identity_id,impact_json,reversible,effective_version,status,evidence_json,decided_at)
VALUES
  ('c1900000-0000-4000-8000-000000000019',
   @c19_project_id,
   'M29:C19-P2-REAL-DECISION',
   '将真实复盘结果固化为可复用 AI Native 项目模板与执行标准',
   JSON_OBJECT(
     'source','HISTORICAL_HUMAN_REVIEW',
     'sourceDocument','AI_Native_产品研发闭环实践复盘_V1.0.docx',
     'signalId',@c19_signal_id,
     'humanDecisionAlreadyOccurred',TRUE
   ),
   JSON_OBJECT(
     'rejectedOption','继续增加 AI 能力或简单复制旧流程',
     'selectedOption','固化项目初始化、验收、QA、Mock/API、Issue、DoD 等执行契约'
   ),
   JSON_OBJECT(
     'actionType','BACKLOG',
     'rationale','V1.0 正式复盘明确指出下一轮重点是把经验固化成可复用 AI Native 项目模板，而不是继续增加 AI 能力。'
   ),
   NULL,
   NULL,
   JSON_OBJECT('nextRound',TRUE,'riskLevel','MEDIUM','historicalHumanDecision',TRUE),
   TRUE,
   'C19-P2-HISTORICAL-REVIEW',
   'EFFECTIVE',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'libraryFileId','libfile_46b76fc847f08191a7d12fd60caa1816',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE
   ),
   '2026-08-13 08:59:34.842019');

SET @c19_decision_id := (
  SELECT id FROM project_decisions
   WHERE project_id=@c19_project_id AND decision_key='M29:C19-P2-REAL-DECISION'
   LIMIT 1
);

INSERT IGNORE INTO project_work_items
  (id,project_id,item_key,item_type,title,stage_key,priority,status,estimate_hours,
   actual_work_minutes,waiting_minutes,blocked_minutes,acceptance_criteria_json,evidence_json,metadata_json)
VALUES
  ('c1900000-0000-4000-8000-000000000020',
   @c19_project_id,
   'M29-LOOP-C19-P2-REAL-DECISION',
   'IMPROVEMENT',
   '将科室挂号 V1.0 复盘固化为 AI Native 2.0 可执行标准',
   'M29_SELF_LOOP',
   'MEDIUM',
   'COMPLETED',
   NULL,
   0,0,0,
   JSON_ARRAY(
     '项目初始化基线可复用',
     '验收矩阵前置',
     'QA Test Matrix 与显式执行状态',
     'Mock Schema 与 API Contract 边界前置',
     'Issue / Retest 可追踪',
     'Definition of Done 前置',
     'Runtime Gate / Checkpoint / Resume / Evidence 可执行'
   ),
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'sourceReview','AI_Native_产品研发闭环实践复盘_V1.0.docx',
     'executedNextRound','AI Native 2.0',
     'stagingSha','ec7570411958a2f6e0466eb5aa97678fa3a64ad7',
     'stagingDeploymentId','fc5307b1-c6ff-428f-adae-167a8fa85567'
   ),
   JSON_OBJECT('realEvidenceMirror',TRUE,'notSyntheticFixture',TRUE));

SET @c19_work_item_id := (
  SELECT id FROM project_work_items
   WHERE project_id=@c19_project_id AND item_key='M29-LOOP-C19-P2-REAL-DECISION'
   LIMIT 1
);

INSERT IGNORE INTO m29_decision_candidates
  (id,project_id,detected_signal_id,candidate_key,title,action_type,proposed_action_json,
   rationale,risk_level,requires_human_approval,approval_request_id,status,evidence_json,created_by_identity_id)
VALUES
  ('c1900000-0000-4000-8000-000000000018',
   @c19_project_id,
   @c19_signal_id,
   'C19-P2-REAL-DECISION',
   '固化 AI Native 执行契约并进入下一轮实现',
   'BACKLOG',
   JSON_OBJECT(
     'title','将 V1.0 真实复盘固化为可复用执行标准',
     'workItemType','IMPROVEMENT',
     'stageKey','M29_SELF_LOOP',
     'completedWorkItemId',@c19_work_item_id
   ),
   '正式 V1.0 复盘的人类决策已发生；本记录只做历史真实决策的 Runtime materialization。',
   'MEDIUM',
   FALSE,
   NULL,
   'CLOSED',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'historicalHumanDecision',TRUE,
     'newAutomaticDecision',FALSE,
     'finalRealLoopAttestationStillHumanGate',TRUE,
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE
   ),
   NULL);

SET @c19_candidate_id := (
  SELECT id FROM m29_decision_candidates
   WHERE project_id=@c19_project_id AND candidate_key='C19-P2-REAL-DECISION'
   LIMIT 1
);

INSERT IGNORE INTO m29_loop_executions
  (id,project_id,decision_candidate_id,project_decision_id,execution_mode,work_item_id,
   trigger_fire_id,status,result_json,evidence_json,executed_by_identity_id,executed_at)
VALUES
  ('c1900000-0000-4000-8000-000000000021',
   @c19_project_id,
   @c19_candidate_id,
   @c19_decision_id,
   'BACKLOG',
   @c19_work_item_id,
   NULL,
   'PASS',
   JSON_OBJECT(
     'decisionExecuted',TRUE,
     'nextRound','AI Native 2.0 Runtime',
     'implementationFinal','PASS',
     'm30StagingPass',TRUE,
     'stagingSha','ec7570411958a2f6e0466eb5aa97678fa3a64ad7',
     'stagingDeploymentId','fc5307b1-c6ff-428f-adae-167a8fa85567',
     'migrationCount',75
   ),
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'evidenceCandidateLibraryFileId','libfile_5fc82e4a83a8819190fc319a370e6787',
     'checkpointLibraryFileId','libfile_22e4193d57ac8191a9b588929ff627f1',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE
   ),
   NULL,
   '2026-10-07 09:54:00.000000');

SET @c19_execution_id := (
  SELECT id FROM m29_loop_executions
   WHERE decision_candidate_id=@c19_candidate_id LIMIT 1
);

INSERT IGNORE INTO m29_loop_closures
  (id,project_id,loop_execution_id,closure_key,outcome_json,knowledge_refs_json,
   backlog_refs_json,next_round_json,status,evidence_json,closed_by_identity_id,closed_at)
VALUES
  ('c1900000-0000-4000-8000-000000000022',
   @c19_project_id,
   @c19_execution_id,
   'C19-P2-REAL-PRODUCT-SELF-LOOP',
   JSON_OBJECT(
     'sourceResult','6 explicitly documented execution-problem categories in the real V1.0 quality review',
     'decision','Turn review findings into reusable AI Native project-init / acceptance / QA / Mock-API / Issue / DoD contracts',
     'executedResult','AI Native 2.0 was actually built and reached Implementation Final PASS / M30 Staging PASS',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE
   ),
   JSON_ARRAY(
     JSON_OBJECT('type','LIBRARY','ref','libfile_46b76fc847f08191a7d12fd60caa1816','role','REAL_SOURCE_REVIEW'),
     JSON_OBJECT('type','LIBRARY','ref','libfile_5fc82e4a83a8819190fc319a370e6787','role','C19_P2_QUALIFICATION'),
     JSON_OBJECT('type','LIBRARY','ref','libfile_22e4193d57ac8191a9b588929ff627f1','role','CURRENT_CHECKPOINT')
   ),
   JSON_ARRAY(@c19_work_item_id),
   JSON_OBJECT(
     'status','EXECUTED',
     'nextRound','AI Native 2.0 reusable Project Operating Runtime',
     'result','M30 STAGING PASS / IMPLEMENTATION FINAL PASS',
     'stagingSha','ec7570411958a2f6e0466eb5aa97678fa3a64ad7',
     'remainingHumanGate','C19-P2 REAL LOOP ATTESTATION'
   ),
   'FROZEN',
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'materializationMode','HISTORICAL_REAL_EVIDENCE_BACKFILL',
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE,
     'attestationCreated',FALSE,
     'attestationPolicy','HUMAN_ONLY'
   ),
   NULL,
   '2026-10-07 09:55:00.000000');

-- Persist implementation gates for this evidence-mirror project.
INSERT IGNORE INTO m29_data_detection_gate_evaluations
  (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
VALUES
  ('c1900000-0000-4000-8000-000000000023',
   @c19_project_id,
   'G-M29-DATA-DETECTION',
   'PASS',
   JSON_ARRAY(),
   JSON_OBJECT(
     'dataSourceCount',1,
     'metricDefinitionCount',1,
     'metricObservationCount',1,
     'dataQualityEvaluationCount',1,
     'dataQualityFailCount',0,
     'detectionRuleCount',1,
     'detectedSignalCount',1,
     'adapters',JSON_ARRAY('PRODUCT_OUTCOME'),
     'readyForDecisionLayer',TRUE,
     'historicalRealEvidenceBackfill',TRUE
   ),
   '2026-10-07 09:55:30.000000');

INSERT IGNORE INTO m29_self_loop_gate_evaluations
  (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
VALUES
  ('c1900000-0000-4000-8000-000000000024',
   @c19_project_id,
   'G-M29-SELF-LOOP',
   'PASS',
   JSON_ARRAY(),
   JSON_OBJECT(
     'dataGateStatus','PASS',
     'decisionCandidateCount',1,
     'loopExecutionCount',1,
     'passExecutionCount',1,
     'frozenClosureCount',1,
     'writebackCount',1,
     'nextRoundCount',1,
     'realExternalOutcome',TRUE,
     'isSynthetic',FALSE,
     'humanAttestationPending',TRUE
   ),
   '2026-10-07 09:56:00.000000');

-- Guardrail: this migration must never auto-create the final HUMAN attestation.
-- m29_real_loop_attestations intentionally untouched.
