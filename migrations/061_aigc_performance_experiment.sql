-- AI Native Runtime V2.8 M28.15 Performance / Experiment / Feedback
-- Migration: 061_aigc_performance_experiment.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_PERFORMANCE_OBSERVATION','表现数据观测','AIGC_13_PERFORMANCE',470,'发布后表现数据：留存、完播、观看、互动、关注、CTA、连续观看、跳转、地区/语言/版本表现'),
  ('AIGC_PRODUCTION_METRICS','生产指标快照','AIGC_13_PERFORMANCE',480,'生成次数、候选→选中率、一次 QA、重生成/失败阻塞、成本、时长、资产复用、模型工具成功率'),
  ('AIGC_EXPERIMENT_CANDIDATE','实验候选','AIGC_13_PERFORMANCE',490,'只生成 Distribution / Production / Creative Experiment Candidate；不得自动升级 Story Rule'),
  ('AIGC_FEEDBACK_SIGNAL','反馈信号','AIGC_13_PERFORMANCE',500,'来自平台表现、评论/运营、成本/质量异常的结构化反馈，交给 Stage 14 Review')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-PERFORMANCE','表现 / 实验 / 反馈门禁','ACTIVE'),
  ('DATA_QUALITY','PASS','数据质量通过','ACTIVE'),
  ('DATA_QUALITY','WARN','数据质量警告','ACTIVE'),
  ('DATA_QUALITY','FAIL','数据质量失败','ACTIVE'),
  ('EXPERIMENT_SCOPE','DISTRIBUTION','分发实验','ACTIVE'),
  ('EXPERIMENT_SCOPE','PRODUCTION','生产实验','ACTIVE'),
  ('EXPERIMENT_SCOPE','CREATIVE','创意实验','ACTIVE'),
  ('FEEDBACK_SEVERITY','LOW','低','ACTIVE'),
  ('FEEDBACK_SEVERITY','MEDIUM','中','ACTIVE'),
  ('FEEDBACK_SEVERITY','HIGH','高','ACTIVE'),
  ('FEEDBACK_SEVERITY','CRITICAL','严重','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_performance_observations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  publication_record_id CHAR(36) NOT NULL,
  observation_key VARCHAR(200) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  metrics_json JSON NOT NULL,
  dimensions_json JSON NOT NULL,
  sample_size BIGINT NOT NULL,
  data_quality_status VARCHAR(16) NOT NULL,
  data_quality_json JSON NOT NULL,
  source_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_obs_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_obs_publication FOREIGN KEY (publication_record_id) REFERENCES aigc_publication_records(id),
  UNIQUE KEY uq_m2815_observation_key (project_id,observation_key),
  INDEX idx_m2815_obs_publication (publication_record_id,window_end),
  INDEX idx_m2815_obs_quality (project_id,data_quality_status,window_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_production_metric_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  snapshot_key VARCHAR(200) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  metrics_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_m2815_snapshot_key (project_id,snapshot_key),
  INDEX idx_m2815_snapshot_window (project_id,window_end),
  CONSTRAINT fk_m2815_snapshot_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_experiment_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  candidate_key VARCHAR(200) NOT NULL,
  experiment_scope VARCHAR(24) NOT NULL,
  source_observation_ids_json JSON NOT NULL,
  source_snapshot_ids_json JSON NOT NULL,
  hypothesis_json JSON NOT NULL,
  control_json JSON NOT NULL,
  treatment_json JSON NOT NULL,
  target_metrics_json JSON NOT NULL,
  guardrails_json JSON NOT NULL,
  expected_learning_json JSON NOT NULL,
  risk_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_candidate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_candidate_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_candidate_key (project_id,candidate_key),
  INDEX idx_m2815_candidate_scope (project_id,experiment_scope,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_feedback_signals (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  feedback_key VARCHAR(200) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_ref_json JSON NOT NULL,
  summary TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  classification_json JSON NOT NULL,
  recommended_scope VARCHAR(24) NULL,
  story_rule_change_requested BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'COLLECTED',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  collected_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_feedback_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_feedback_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_feedback_key (project_id,feedback_key),
  INDEX idx_m2815_feedback_scope (project_id,status,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2815_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2815_gate_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
