-- AI Native Runtime V2.9 M29.5 Final Aggregate Gate
-- Migration: 068_m29_final_gate.sql
-- Separates structural implementation closure from real Product + AIGC loop Exit evidence.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_IMPLEMENTATION_FINAL_GATE','M29 实现最终验收','M29_FINAL',830,'聚合 M29 Data / Self-loop / Automation / Analytics-Eval 的结构化实现门禁'),
  ('M29_REAL_DUAL_DOMAIN_LOOP','真实双域自闭环实证','M29_FINAL',840,'Product 与 AIGC 各至少一个真实结果数据→决策→下一轮闭环；CI/合成证据不可替代')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-FINAL','M29 数据 / 评测 / 自动化 / 自闭环最终门禁','ACTIVE'),
  ('M29_FINAL_STATUS','IMPLEMENTATION_PASS','实现闭环通过','ACTIVE'),
  ('M29_FINAL_STATUS','REAL_EXIT_HOLD','真实双域闭环待实证','ACTIVE'),
  ('M29_REAL_LOOP_DOMAIN','PRODUCT','产品研发真实闭环','ACTIVE'),
  ('M29_REAL_LOOP_DOMAIN','AIGC','AIGC 真实闭环','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_real_loop_attestations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  project_type VARCHAR(64) NOT NULL,
  detected_signal_id CHAR(36) NOT NULL,
  decision_candidate_id CHAR(36) NOT NULL,
  loop_execution_id CHAR(36) NOT NULL,
  loop_closure_id CHAR(36) NOT NULL,
  attestation_mode VARCHAR(24) NOT NULL,
  decision VARCHAR(24) NOT NULL,
  attested_by_ref VARCHAR(255) NOT NULL,
  attested_at TIMESTAMP(6) NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  source_result_ref_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m295_attestation_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m295_attestation_signal FOREIGN KEY (detected_signal_id) REFERENCES m29_detected_signals(id),
  CONSTRAINT fk_m295_attestation_candidate FOREIGN KEY (decision_candidate_id) REFERENCES m29_decision_candidates(id),
  CONSTRAINT fk_m295_attestation_execution FOREIGN KEY (loop_execution_id) REFERENCES m29_loop_executions(id),
  CONSTRAINT fk_m295_attestation_closure FOREIGN KEY (loop_closure_id) REFERENCES m29_loop_closures(id),
  CONSTRAINT fk_m295_attestation_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m295_attestation_loop (project_id,loop_closure_id),
  INDEX idx_m295_attestation_real (project_type,decision,attestation_mode,is_synthetic,attested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_final_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  implementation_status VARCHAR(16) NOT NULL,
  blueprint_exit_status VARCHAR(16) NOT NULL,
  implementation_criteria_json JSON NOT NULL,
  exit_criteria_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m295_final_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m295_final_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m295_final_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
