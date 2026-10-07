-- AI Native Runtime V3.0 M30.6 AI Native 2.0 Final Aggregate Gate
-- Migration: 074_ai_native_v2_final_gate.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AI_NATIVE_V2_FINAL_REGRESSION','2.0 全量回归凭证','M30_FINAL',1090,'记录 exact Runtime SHA 对应的 M25–M30 全量 CI/Gate 回归凭证；仅证明实现能力，不替代真实业务 E2E 证据'),
  ('AI_NATIVE_V2_FINAL_GATE','AI Native 2.0 最终门禁','M30_FINAL',1100,'按 Master Blueprint 22 条 FINAL Criteria 区分 Implementation PASS 与真实 Blueprint FINAL/FROZEN')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AI-NATIVE-V2-FINAL','AI Native 2.0 最终门禁','ACTIVE'),
  ('AI_NATIVE_V2_FINAL_STATUS','IMPLEMENTATION_PASS','平台实现通过','ACTIVE'),
  ('AI_NATIVE_V2_FINAL_STATUS','BLUEPRINT_HOLD','真实蓝图终验待证','ACTIVE'),
  ('AI_NATIVE_V2_FINAL_STATUS','FINAL_FROZEN','AI Native 2.0 FINAL / FROZEN','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS ai_native_v2_final_regression_receipts (
  id CHAR(36) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  repository_full_name VARCHAR(320) NOT NULL,
  workflow_name VARCHAR(255) NOT NULL,
  workflow_run_id VARCHAR(128) NOT NULL,
  exact_runtime_sha CHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL,
  covered_criteria_json JSON NOT NULL,
  test_markers_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  recorded_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_m306_regression_run (provider,repository_full_name,workflow_run_id,exact_runtime_sha),
  INDEX idx_m306_regression_sha (exact_runtime_sha,status,recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_native_v2_final_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  gate_key VARCHAR(64) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  implementation_status VARCHAR(16) NOT NULL,
  blueprint_final_status VARCHAR(16) NOT NULL,
  criteria_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_m306_final_latest (gate_key,as_of,created_at),
  INDEX idx_m306_final_sha (candidate_runtime_sha,implementation_status,blueprint_final_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
