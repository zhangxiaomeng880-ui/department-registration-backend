-- AI Native Runtime V2.8 M28.15 Performance / Experiment / Feedback
-- Migration: 061_aigc_performance_feedback.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_PERFORMANCE_SNAPSHOT','表现数据快照','AIGC_13_PERFORMANCE',470,'发布后外部表现事实快照：时间窗、平台、地区、语言、留存、互动、转化与来源证据'),
  ('AIGC_PRODUCTION_METRICS','生产效率指标','AIGC_13_PERFORMANCE',480,'从 Runtime Generation / Candidate / Cost / Duration 自动汇总生产效率与成本指标'),
  ('AIGC_EXPERIMENT_CANDIDATE','实验候选','AIGC_13_PERFORMANCE',490,'仅生成分发 / 生产 / 创意实验候选，不直接改写 Story Rule'),
  ('AIGC_FEEDBACK_SIGNAL','反馈信号','AIGC_13_PERFORMANCE',500,'结构化定量/定性反馈信号，保留来源、置信度与限制')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-PERFORMANCE','表现 / 实验 / 反馈门禁','ACTIVE'),
  ('EXPERIMENT_TYPE','DISTRIBUTION','分发实验','ACTIVE'),
  ('EXPERIMENT_TYPE','PRODUCTION','生产实验','ACTIVE'),
  ('EXPERIMENT_TYPE','CREATIVE','创意实验','ACTIVE'),
  ('EXPERIMENT_STATUS','CANDIDATE','候选实验','ACTIVE'),
  ('EXPERIMENT_STATUS','REVIEW_REQUIRED','待复盘 / 人工评审','ACTIVE'),
  ('DATA_QUALITY','PASS','数据质量通过','ACTIVE'),
  ('DATA_QUALITY','WARN','数据质量警告','ACTIVE'),
  ('DATA_QUALITY','FAIL','数据质量失败','ACTIVE'),
  ('FEEDBACK_TYPE','QUANTITATIVE','定量反馈','ACTIVE'),
  ('FEEDBACK_TYPE','QUALITATIVE','定性反馈','ACTIVE'),
  ('FEEDBACK_SEVERITY','LOW','低','ACTIVE'),
  ('FEEDBACK_SEVERITY','MEDIUM','中','ACTIVE'),
  ('FEEDBACK_SEVERITY','HIGH','高','ACTIVE'),
  ('FEEDBACK_SEVERITY','CRITICAL','严重','ACTIVE'),
  ('FEEDBACK_STATUS','COLLECTED','已收集','ACTIVE'),
  ('FEEDBACK_STATUS','REVIEW_REQUIRED','待复盘 / 人工评审','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_performance_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  publication_record_id CHAR(36) NOT NULL,
  snapshot_key VARCHAR(200) NOT NULL,
  platform_key VARCHAR(80) NOT NULL,
  region VARCHAR(80) NOT NULL,
  language VARCHAR(80) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  metrics_json JSON NOT NULL,
  sample_size BIGINT NOT NULL,
  data_quality_status VARCHAR(16) NOT NULL,
  data_quality_json JSON NOT NULL,
  source_json JSON NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  limitations_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_perf_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_perf_publication FOREIGN KEY (publication_record_id) REFERENCES aigc_publication_records(id),
  CONSTRAINT fk_m2815_perf_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_perf_key (project_id,snapshot_key),
  INDEX idx_m2815_perf_window (project_id,platform_key,window_end,observed_at),
  INDEX idx_m2815_perf_quality (project_id,data_quality_status,window_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_production_metric_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  snapshot_key VARCHAR(200) NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  metrics_json JSON NOT NULL,
  source_counts_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_prod_metric_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_prod_metric_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_prod_metric_key (project_id,snapshot_key),
  INDEX idx_m2815_prod_metric_asof (project_id,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_feedback_signals (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  performance_snapshot_id CHAR(36) NULL,
  signal_key VARCHAR(200) NOT NULL,
  feedback_type VARCHAR(24) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  signal_json JSON NOT NULL,
  source_json JSON NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  limitation_json JSON NOT NULL,
  recommended_scope VARCHAR(24) NULL,
  story_rule_change_requested BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'COLLECTED',
  evidence_json JSON NOT NULL,
  collected_at TIMESTAMP(6) NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_feedback_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_feedback_perf FOREIGN KEY (performance_snapshot_id) REFERENCES aigc_performance_snapshots(id),
  CONSTRAINT fk_m2815_feedback_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_feedback_key (project_id,signal_key),
  INDEX idx_m2815_feedback_subject (project_id,feedback_type,subject,created_at),
  INDEX idx_m2815_feedback_scope (project_id,status,severity,recommended_scope),
  INDEX idx_m2815_feedback_severity (project_id,severity,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_experiment_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  experiment_key VARCHAR(200) NOT NULL,
  experiment_type VARCHAR(24) NOT NULL,
  hypothesis TEXT NOT NULL,
  source_performance_snapshot_ids_json JSON NOT NULL,
  source_production_metric_snapshot_ids_json JSON NOT NULL,
  source_feedback_signal_ids_json JSON NOT NULL,
  target_json JSON NOT NULL,
  variant_json JSON NOT NULL,
  success_metrics_json JSON NOT NULL,
  guardrails_json JSON NOT NULL,
  story_rule_escalation_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2815_experiment_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2815_experiment_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2815_experiment_key (project_id,experiment_key),
  INDEX idx_m2815_experiment_status (project_id,experiment_type,status,created_at)
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
