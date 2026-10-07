-- AI Native Runtime V2.7 M27.9 Data / Experiment / Feedback / Outcome
-- Migration: 042_product_outcome.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_OUTCOME_METRIC','产品指标','PD_16_OUTCOME',440,'Primary、Guardrail、KPI、Funnel、Retention、Conversion 与 Reliability 指标定义'),
  ('PRODUCT_OUTCOME_OBSERVATION','指标观测','PD_16_OUTCOME',450,'指标时间窗、样本、结果与数据质量证据'),
  ('PRODUCT_EXPERIMENT','产品实验','PD_16_OUTCOME',460,'Hypothesis、Control/Treatment、Population、Primary/Guardrail、Sample、SRM、Result、Confidence、Decision'),
  ('PRODUCT_FEEDBACK','反馈与支持','PD_16_OUTCOME',470,'用户、运营与 Support 反馈的收集、分诊、洞察与行动闭环'),
  ('PRODUCT_OUTCOME_REVIEW','结果评审','PD_16_OUTCOME',480,'发布后指标、实验、反馈、事故与决策的冻结结果快照')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_outcome_metrics (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  metric_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(32) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  aggregation VARCHAR(32) NOT NULL,
  direction VARCHAR(16) NOT NULL,
  target_json JSON NULL,
  source_json JSON NOT NULL,
  instrumentation_ref_json JSON NOT NULL,
  owner_identity_id CHAR(36) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_metric_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_metric_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m279_metric_key (project_id,metric_key),
  INDEX idx_m279_metric_type (project_id,metric_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_outcome_observations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  metric_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  observation_key VARCHAR(128) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  value_json JSON NOT NULL,
  sample_size BIGINT NOT NULL,
  data_quality_status VARCHAR(16) NOT NULL,
  data_quality_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_obs_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_obs_metric FOREIGN KEY (metric_id) REFERENCES product_outcome_metrics(id),
  CONSTRAINT fk_m279_obs_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  UNIQUE KEY uq_m279_obs_key (project_id,observation_key),
  INDEX idx_m279_obs_metric (metric_id,window_end,data_quality_status),
  INDEX idx_m279_obs_rollout (release_rollout_id,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_experiments (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  experiment_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  hypothesis_json JSON NOT NULL,
  control_json JSON NOT NULL,
  treatment_json JSON NOT NULL,
  population_json JSON NOT NULL,
  primary_metric_id CHAR(36) NOT NULL,
  guardrail_metric_ids_json JSON NOT NULL,
  planned_sample_json JSON NOT NULL,
  time_window_json JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
  actual_sample_json JSON NULL,
  srm_json JSON NULL,
  result_json JSON NULL,
  confidence_json JSON NULL,
  decision_json JSON NULL,
  evidence_json JSON NOT NULL,
  owner_identity_id CHAR(36) NULL,
  started_at TIMESTAMP(6) NULL,
  completed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_exp_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_exp_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m279_exp_primary FOREIGN KEY (primary_metric_id) REFERENCES product_outcome_metrics(id),
  CONSTRAINT fk_m279_exp_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m279_exp_key (project_id,experiment_key),
  INDEX idx_m279_exp_status (project_id,status,completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_feedback_signals (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  feedback_key VARCHAR(128) NOT NULL,
  source_type VARCHAR(24) NOT NULL,
  source_ref_json JSON NOT NULL,
  summary TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COLLECTED',
  evidence_json JSON NOT NULL,
  triage_json JSON NULL,
  insight_json JSON NULL,
  problem_opportunity_json JSON NULL,
  decision_json JSON NULL,
  action_type VARCHAR(16) NULL,
  action_target_id CHAR(36) NULL,
  owner_identity_id CHAR(36) NULL,
  collected_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_feedback_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_feedback_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m279_feedback_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m279_feedback_key (project_id,feedback_key),
  INDEX idx_m279_feedback_status (project_id,status,source_type,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_outcome_reviews (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  post_release_verification_id CHAR(36) NOT NULL,
  review_key VARCHAR(128) NOT NULL,
  primary_metric_observation_id CHAR(36) NOT NULL,
  guardrail_observation_ids_json JSON NOT NULL,
  experiment_ids_json JSON NOT NULL,
  feedback_signal_ids_json JSON NOT NULL,
  incident_ids_json JSON NOT NULL,
  reliability_json JSON NOT NULL,
  outcome_json JSON NOT NULL,
  decision_json JSON NOT NULL,
  next_action_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'FROZEN',
  reviewed_by_identity_id CHAR(36) NULL,
  reviewed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_review_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_review_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m279_review_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m279_review_verify FOREIGN KEY (post_release_verification_id) REFERENCES product_post_release_verifications(id),
  CONSTRAINT fk_m279_review_primary_obs FOREIGN KEY (primary_metric_observation_id) REFERENCES product_outcome_observations(id),
  CONSTRAINT fk_m279_review_identity FOREIGN KEY (reviewed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m279_review_key (project_id,review_key),
  INDEX idx_m279_review_rollout (release_rollout_id,status,reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m279_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m279_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m279_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m279_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
