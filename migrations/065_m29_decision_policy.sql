-- AI Native Runtime V2.9 M29.2 Unified Decision / Policy / Human Gate
-- Migration: 065_m29_decision_policy.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_DECISION_CANDIDATE','决策候选','M29_DECISION',740,'由检测信号生成可审计决策候选，不直接执行动作'),
  ('M29_DECISION_POLICY','决策策略','M29_DECISION',750,'冻结 Detection Rule 决策策略、风险、副作用和 Human Gate 判定'),
  ('M29_HUMAN_DECISION','人工决策','M29_DECISION',760,'高风险、不可逆、外部副作用或策略要求人工时记录明确批准/拒绝证据')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-DECISION','决策 / 策略 / 人工门禁','ACTIVE'),
  ('M29_DECISION_OUTCOME','ACTION','进入执行','ACTIVE'),
  ('M29_DECISION_OUTCOME','NO_ACTION','无需动作','ACTIVE'),
  ('M29_DECISION_OUTCOME','BACKLOG','进入待办','ACTIVE'),
  ('M29_DECISION_OUTCOME','REVIEW','进入复盘','ACTIVE'),
  ('M29_DECISION_STATUS','AUTO_APPROVED','自动批准','ACTIVE'),
  ('M29_DECISION_STATUS','APPROVAL_REQUIRED','待人工批准','ACTIVE'),
  ('M29_DECISION_STATUS','APPROVED','人工批准','ACTIVE'),
  ('M29_DECISION_STATUS','REJECTED','人工拒绝','ACTIVE'),
  ('M29_DECISION_STATUS','RESOLVED','已决策','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_decision_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  detected_signal_id CHAR(36) NOT NULL,
  decision_key VARCHAR(260) NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  action_spec_json JSON NOT NULL,
  policy_snapshot_json JSON NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  external_side_effect BOOLEAN NOT NULL DEFAULT FALSE,
  irreversible BOOLEAN NOT NULL DEFAULT FALSE,
  human_gate_required BOOLEAN NOT NULL DEFAULT FALSE,
  rationale_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL,
  human_decision_json JSON NULL,
  decided_at TIMESTAMP(6) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m292_decision_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m292_decision_signal FOREIGN KEY (detected_signal_id) REFERENCES m29_detected_signals(id),
  CONSTRAINT fk_m292_decision_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m292_decision_signal (detected_signal_id),
  UNIQUE KEY uq_m292_decision_key (project_id,decision_key),
  INDEX idx_m292_decision_status (project_id,status,risk_level,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_decision_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m292_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m292_gate_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
