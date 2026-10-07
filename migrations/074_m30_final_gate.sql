-- AI Native Runtime V3.0 M30.6 / AI Native 2.0 Final Aggregate Gate
-- Migration: 074_m30_final_gate.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_IMPLEMENTATION_FINAL_GATE','M30 实现最终验收','M30_OPERATIONS',1090,'聚合 M30.1–M30.5 与 M29 实现最终状态，验证 Private Workspace / Platform Operations 完整实现'),
  ('AI_NATIVE_2_REAL_FINAL_EVIDENCE','AI Native 2.0 真实最终实证','M30_OPERATIONS',1100,'AI Native 2.0 FINAL / FROZEN 必须满足真实 Product E2E、真实 AIGC E2E 与真实双域结果自闭环；CI/Synthetic 不可替代')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-FINAL','AI Native 2.0 最终门禁','ACTIVE'),
  ('M30_FINAL_STATUS','IMPLEMENTATION_PASS','M30 实现通过','ACTIVE'),
  ('M30_FINAL_STATUS','BLUEPRINT_HOLD','2.0 真实终验待实证','ACTIVE'),
  ('M30_FINAL_STATUS','FINAL_FROZEN','AI Native 2.0 FINAL / FROZEN（最终冻结）','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m30_final_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  scope_key VARCHAR(64) NOT NULL DEFAULT 'PLATFORM',
  workspace_id CHAR(36) NULL,
  gate_key VARCHAR(64) NOT NULL,
  implementation_status VARCHAR(16) NOT NULL,
  blueprint_final_status VARCHAR(16) NOT NULL,
  implementation_criteria_json JSON NOT NULL,
  final_criteria_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m306_final_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m306_final_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m306_final_latest (scope_key,gate_key,as_of,created_at),
  INDEX idx_m306_final_workspace (workspace_id,implementation_status,blueprint_final_status,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
