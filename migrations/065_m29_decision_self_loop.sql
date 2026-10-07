-- AI Native Runtime V2.9 M29.2 Decision / Execution / Self-loop
-- Migration: 065_m29_decision_self_loop.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_DECISION_LOOP','决策闭环','M29_SELF_LOOP',740,'将合格检测信号转为可审计决策候选，并复用 Human Gate'),
  ('M29_LOOP_EXECUTION','闭环执行','M29_SELF_LOOP',750,'复用项目 Backlog 或 Trigger Runtime 执行下一轮动作'),
  ('M29_LOOP_CLOSURE','闭环回写','M29_SELF_LOOP',760,'记录 Signal→Decision→Execution→Knowledge/Backlog→Next Round 血缘')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-SELF-LOOP','决策 / 执行 / 闭环门禁','ACTIVE'),
  ('M29_ACTION','BACKLOG','进入待办','ACTIVE'),
  ('M29_ACTION','TRIGGER','触发工作流','ACTIVE'),
  ('M29_ACTION','NO_ACTION','记录无动作决策','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_decision_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  detected_signal_id CHAR(36) NOT NULL,
  candidate_key VARCHAR(200) NOT NULL,
  title VARCHAR(255) NOT NULL,
  action_type VARCHAR(24) NOT NULL,
  proposed_action_json JSON NOT NULL,
  rationale TEXT NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_request_id CHAR(36) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'READY',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m292_candidate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m292_candidate_signal FOREIGN KEY (detected_signal_id) REFERENCES m29_detected_signals(id),
  CONSTRAINT fk_m292_candidate_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  CONSTRAINT fk_m292_candidate_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m292_candidate_key (project_id,candidate_key),
  INDEX idx_m292_candidate_status (project_id,status,risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_loop_executions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  decision_candidate_id CHAR(36) NOT NULL,
  project_decision_id CHAR(36) NOT NULL,
  execution_mode VARCHAR(24) NOT NULL,
  work_item_id CHAR(36) NULL,
  trigger_fire_id CHAR(36) NULL,
  status VARCHAR(24) NOT NULL,
  result_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  executed_by_identity_id CHAR(36) NULL,
  executed_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m292_execution_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m292_execution_candidate FOREIGN KEY (decision_candidate_id) REFERENCES m29_decision_candidates(id),
  CONSTRAINT fk_m292_execution_decision FOREIGN KEY (project_decision_id) REFERENCES project_decisions(id),
  CONSTRAINT fk_m292_execution_work_item FOREIGN KEY (work_item_id) REFERENCES project_work_items(id),
  CONSTRAINT fk_m292_execution_trigger FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  CONSTRAINT fk_m292_execution_identity FOREIGN KEY (executed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m292_execution_candidate (decision_candidate_id),
  INDEX idx_m292_execution_status (project_id,status,executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_loop_closures (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  loop_execution_id CHAR(36) NOT NULL,
  closure_key VARCHAR(220) NOT NULL,
  outcome_json JSON NOT NULL,
  knowledge_refs_json JSON NOT NULL,
  backlog_refs_json JSON NOT NULL,
  next_round_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  closed_by_identity_id CHAR(36) NULL,
  closed_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m292_closure_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m292_closure_execution FOREIGN KEY (loop_execution_id) REFERENCES m29_loop_executions(id),
  CONSTRAINT fk_m292_closure_identity FOREIGN KEY (closed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m292_closure_execution (loop_execution_id),
  UNIQUE KEY uq_m292_closure_key (project_id,closure_key),
  INDEX idx_m292_closure_status (project_id,status,closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_self_loop_gate_evaluations (
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
