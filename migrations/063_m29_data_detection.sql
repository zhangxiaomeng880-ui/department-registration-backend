-- AI Native Runtime V2.9 M29.1 Unified Data / Metric / Quality / Detection
-- Migration: 063_m29_data_detection.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_DATA_SOURCE','数据源','M29_DATA_DETECTION',600,'统一接入 Product Outcome、AIGC Performance 等已验证结果数据，不复制 Domain 事实表'),
  ('M29_METRIC_DEFINITION','指标定义','M29_DATA_DETECTION',610,'统一指标语义、方向、单位、抽取合同与质量策略'),
  ('M29_DATA_QUALITY','数据质量','M29_DATA_DETECTION',620,'新鲜度、完整性、样本量与上游质量的 Fail-closed 评估'),
  ('M29_DETECTION_RULE','检测规则','M29_DATA_DETECTION',630,'基于合格指标观测检测变化并生成可去重 Signal')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-DATA-DETECTION','数据 / 指标 / 质量 / 检测门禁','ACTIVE'),
  ('M29_DOMAIN','PRODUCT','产品研发','ACTIVE'),
  ('M29_DOMAIN','AIGC','AIGC 内容生产','ACTIVE'),
  ('M29_DOMAIN','PLATFORM','平台','ACTIVE'),
  ('M29_DOMAIN','PORTFOLIO','项目组合','ACTIVE'),
  ('M29_QUALITY','PASS','数据质量通过','ACTIVE'),
  ('M29_QUALITY','WARN','数据质量警告','ACTIVE'),
  ('M29_QUALITY','FAIL','数据质量失败','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_data_sources (
  id CHAR(36) PRIMARY KEY,
  source_key VARCHAR(200) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(24) NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  project_id CHAR(36) NULL,
  adapter_key VARCHAR(64) NOT NULL,
  connection_ref_json JSON NOT NULL,
  schema_contract_json JSON NOT NULL,
  freshness_policy_json JSON NOT NULL,
  permission_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_source_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m291_source_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m291_source_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m291_source_key (source_key),
  INDEX idx_m291_source_scope (scope_type,workspace_id,project_id,status),
  INDEX idx_m291_source_adapter (adapter_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_metric_definitions (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  metric_key VARCHAR(240) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  domain_key VARCHAR(32) NOT NULL,
  value_type VARCHAR(24) NOT NULL,
  unit VARCHAR(64) NOT NULL,
  direction VARCHAR(24) NOT NULL,
  extraction_json JSON NOT NULL,
  dimensions_json JSON NOT NULL,
  quality_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_metric_source FOREIGN KEY (source_id) REFERENCES m29_data_sources(id),
  UNIQUE KEY uq_m291_metric_key (source_id,metric_key),
  INDEX idx_m291_metric_domain (domain_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_metric_observations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  metric_definition_id CHAR(36) NOT NULL,
  source_object_type VARCHAR(64) NOT NULL,
  source_object_id CHAR(36) NOT NULL,
  observation_key VARCHAR(260) NOT NULL,
  numeric_value DECIMAL(30,10) NOT NULL,
  dimensions_json JSON NOT NULL,
  source_quality_status VARCHAR(16) NOT NULL,
  sample_size BIGINT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  source_evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_observation_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m291_observation_metric FOREIGN KEY (metric_definition_id) REFERENCES m29_metric_definitions(id),
  UNIQUE KEY uq_m291_observation_key (project_id,observation_key),
  INDEX idx_m291_observation_metric (project_id,metric_definition_id,observed_at),
  INDEX idx_m291_observation_source (source_object_type,source_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_data_quality_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  metric_observation_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL,
  freshness_status VARCHAR(16) NOT NULL,
  completeness_status VARCHAR(16) NOT NULL,
  sample_status VARCHAR(16) NOT NULL,
  source_quality_status VARCHAR(16) NOT NULL,
  checks_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  evaluated_at TIMESTAMP(6) NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_quality_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m291_quality_observation FOREIGN KEY (metric_observation_id) REFERENCES m29_metric_observations(id),
  UNIQUE KEY uq_m291_quality_observation (metric_observation_id),
  INDEX idx_m291_quality_status (project_id,status,evaluated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_detection_rules (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  metric_definition_id CHAR(36) NOT NULL,
  rule_key VARCHAR(240) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  operator VARCHAR(24) NOT NULL,
  threshold_json JSON NOT NULL,
  required_quality_status VARCHAR(16) NOT NULL DEFAULT 'PASS',
  severity VARCHAR(16) NOT NULL,
  dedupe_window_seconds INT NOT NULL DEFAULT 3600,
  decision_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_rule_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m291_rule_metric FOREIGN KEY (metric_definition_id) REFERENCES m29_metric_definitions(id),
  UNIQUE KEY uq_m291_rule_key (project_id,rule_key),
  INDEX idx_m291_rule_active (project_id,status,metric_definition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_detection_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  detection_rule_id CHAR(36) NOT NULL,
  metric_observation_id CHAR(36) NOT NULL,
  data_quality_evaluation_id CHAR(36) NOT NULL,
  matched BOOLEAN NOT NULL,
  evaluated_value DECIMAL(30,10) NOT NULL,
  comparison_json JSON NOT NULL,
  quality_status VARCHAR(16) NOT NULL,
  evaluated_at TIMESTAMP(6) NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_eval_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m291_eval_rule FOREIGN KEY (detection_rule_id) REFERENCES m29_detection_rules(id),
  CONSTRAINT fk_m291_eval_observation FOREIGN KEY (metric_observation_id) REFERENCES m29_metric_observations(id),
  CONSTRAINT fk_m291_eval_quality FOREIGN KEY (data_quality_evaluation_id) REFERENCES m29_data_quality_evaluations(id),
  INDEX idx_m291_eval_rule (detection_rule_id,evaluated_at),
  INDEX idx_m291_eval_project (project_id,matched,evaluated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_detected_signals (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  detection_rule_id CHAR(36) NOT NULL,
  detection_evaluation_id CHAR(36) NOT NULL,
  metric_observation_id CHAR(36) NOT NULL,
  signal_key VARCHAR(320) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  signal_payload_json JSON NOT NULL,
  dedupe_key VARCHAR(640) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DETECTED',
  evidence_json JSON NOT NULL,
  detected_at TIMESTAMP(6) NOT NULL,
  resolved_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_signal_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m291_signal_rule FOREIGN KEY (detection_rule_id) REFERENCES m29_detection_rules(id),
  CONSTRAINT fk_m291_signal_eval FOREIGN KEY (detection_evaluation_id) REFERENCES m29_detection_evaluations(id),
  CONSTRAINT fk_m291_signal_observation FOREIGN KEY (metric_observation_id) REFERENCES m29_metric_observations(id),
  UNIQUE KEY uq_m291_signal_dedupe (dedupe_key),
  INDEX idx_m291_signal_project (project_id,status,severity,detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_data_detection_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m291_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m291_gate_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
