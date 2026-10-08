-- Criterion 19 C19-P2 HUMAN real-loop attestation
-- Migration: 076_c19_product_real_loop_human_attestation.sql
-- User explicitly approved the HUMAN attestation in ChatGPT on 2026-10-08 09:20 +08:00.
-- Scope: Product real-loop attestation only. Does NOT authorize AIGC publication or Production.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @c19_project_id := (
  SELECT id FROM projects WHERE project_key='c19-product-real-self-loop' LIMIT 1
);
SET @c19_signal_id := (
  SELECT id FROM m29_detected_signals
   WHERE project_id=@c19_project_id
     AND dedupe_key=SHA2('C19-P2-REAL-PRODUCT-REVIEW-SIGNAL',256)
   LIMIT 1
);
SET @c19_candidate_id := (
  SELECT id FROM m29_decision_candidates
   WHERE project_id=@c19_project_id AND candidate_key='C19-P2-REAL-DECISION'
   LIMIT 1
);
SET @c19_execution_id := (
  SELECT id FROM m29_loop_executions
   WHERE project_id=@c19_project_id AND decision_candidate_id=@c19_candidate_id
   LIMIT 1
);
SET @c19_closure_id := (
  SELECT id FROM m29_loop_closures
   WHERE project_id=@c19_project_id AND closure_key='C19-P2-REAL-PRODUCT-SELF-LOOP'
   LIMIT 1
);

-- Fail closed if the attested chain is not already FROZEN / PASS / PASS quality.
SET @c19_chain_valid := (
  SELECT COUNT(*)
    FROM m29_loop_closures c
    JOIN m29_loop_executions x ON x.id=c.loop_execution_id
    JOIN m29_decision_candidates d ON d.id=x.decision_candidate_id
    JOIN m29_detected_signals s ON s.id=d.detected_signal_id
    JOIN m29_metric_observations o ON o.id=s.metric_observation_id
    JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
   WHERE c.id=@c19_closure_id
     AND c.project_id=@c19_project_id
     AND c.status='FROZEN'
     AND x.status='PASS'
     AND q.status='PASS'
     AND o.source_object_type='HISTORICAL_PRODUCT_REVIEW'
     AND o.source_object_id='c1900000-0000-4000-8000-000000000013'
);
SET @c19_assert_chain := IF(@c19_chain_valid=1,1,CAST('C19_P2_CHAIN_NOT_ELIGIBLE' AS UNSIGNED));

INSERT IGNORE INTO m29_real_loop_attestations
  (id,project_id,project_type,detected_signal_id,decision_candidate_id,loop_execution_id,loop_closure_id,
   attestation_mode,decision,attested_by_ref,attested_at,is_synthetic,source_result_ref_json,
   provenance_json,evidence_json,status,created_by_identity_id)
VALUES
  ('c1900000-0000-4000-8000-000000000025',
   @c19_project_id,
   'PRODUCT_DEVELOPMENT',
   @c19_signal_id,
   @c19_candidate_id,
   @c19_execution_id,
   @c19_closure_id,
   'HUMAN',
   'APPROVED',
   'USER_EXPLICIT_APPROVAL_CHATGPT_2026-10-08T09:20:00+08:00',
   '2026-10-08 01:20:00.000000',
   FALSE,
   JSON_OBJECT(
     'sourceObjectType','HISTORICAL_PRODUCT_REVIEW',
     'sourceObjectId','c1900000-0000-4000-8000-000000000013',
     'observationKey','C19-P2-REAL-REVIEW-ISSUE-CATEGORIES'
   ),
   JSON_OBJECT(
     'realExternalOutcome',TRUE,
     'factClass','REAL_PROJECT_DELIVERY_OUTCOME',
     'sourceProject','科室挂号 V1.0',
     'sourceLibraryFileId','libfile_46b76fc847f08191a7d12fd60caa1816',
     'humanApproval',TRUE,
     'approvedAtLocal','2026-10-08T09:20:00+08:00',
     'isSynthetic',FALSE
   ),
   JSON_OBJECT(
     'criterion','19',
     'subcriterion','C19-P2',
     'approvalText','批准',
     'approvalChannel','ChatGPT',
     'explicitUserApproval',TRUE,
     'runtimeChainMigration','075_c19_product_real_self_loop.sql',
     'targetedGateRunId','37634370844',
     'stagingShaBeforeAttestation','76cdf521ef468c3f634b76bb181c84ccf0fd2ce1',
     'policy','HUMAN_ONLY',
     'aigcPublicationAuthorized',FALSE,
     'productionAuthorized',FALSE
   ),
   'ACTIVE',
   NULL);

-- Guardrail: one active APPROVED HUMAN non-synthetic attestation for this Product closure.
SET @c19_attestation_count := (
  SELECT COUNT(*) FROM m29_real_loop_attestations
   WHERE project_id=@c19_project_id
     AND loop_closure_id=@c19_closure_id
     AND decision='APPROVED'
     AND attestation_mode='HUMAN'
     AND is_synthetic=FALSE
     AND status='ACTIVE'
);
SET @c19_assert_attestation := IF(@c19_attestation_count=1,1,CAST('C19_P2_HUMAN_ATTESTATION_COUNT_INVALID' AS UNSIGNED));
