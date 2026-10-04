-- AI Native 2.0 Runtime Persistence
-- Migration: 001_runtime_persistence.sql
-- Target: MySQL 8.x
-- Scope: Runtime state only. Knowledge source remains in Git; RAG is out of scope for this migration.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  project_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  project_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  current_workflow_version VARCHAR(64) NULL,
  current_knowledge_commit_sha CHAR(40) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_projects_type_status (project_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS runs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  parent_run_id CHAR(36) NULL,
  run_type VARCHAR(64) NOT NULL DEFAULT 'WORKFLOW',
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  trigger_source VARCHAR(64) NOT NULL DEFAULT 'USER',
  input_json JSON NULL,
  output_json JSON NULL,
  runtime_commit_sha CHAR(40) NULL,
  knowledge_commit_sha CHAR(40) NULL,
  workflow_version VARCHAR(64) NULL,
  router_version VARCHAR(64) NULL,
  rag_index_version VARCHAR(128) NULL,
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  last_checkpoint_at TIMESTAMP(6) NULL,
  token_input BIGINT NOT NULL DEFAULT 0,
  token_output BIGINT NOT NULL DEFAULT 0,
  cost_amount DECIMAL(18,6) NOT NULL DEFAULT 0,
  cost_currency CHAR(3) NOT NULL DEFAULT 'USD',
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_runs_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_runs_parent FOREIGN KEY (parent_run_id) REFERENCES runs(id),
  INDEX idx_runs_project_status (project_id, status),
  INDEX idx_runs_created (project_id, created_at),
  INDEX idx_runs_parent (parent_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  parent_task_id CHAR(36) NULL,
  stage_key VARCHAR(128) NOT NULL,
  task_key VARCHAR(128) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  sequence_no INT NOT NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  dependency_json JSON NULL,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 0,
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_tasks_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
  UNIQUE KEY uq_tasks_run_task (run_id, task_key),
  UNIQUE KEY uq_tasks_run_sequence (run_id, sequence_no),
  INDEX idx_tasks_run_status (run_id, status),
  INDEX idx_tasks_stage_status (run_id, stage_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS checkpoints (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  sequence_no INT NOT NULL,
  checkpoint_type VARCHAR(32) NOT NULL DEFAULT 'AUTO',
  status VARCHAR(32) NOT NULL DEFAULT 'VALID',
  stage_key VARCHAR(128) NULL,
  step_key VARCHAR(128) NULL,
  state_json JSON NOT NULL,
  completed_task_keys_json JSON NULL,
  pending_task_keys_json JSON NULL,
  blocked_task_keys_json JSON NULL,
  dependency_fingerprint VARCHAR(128) NULL,
  runtime_commit_sha CHAR(40) NULL,
  knowledge_commit_sha CHAR(40) NULL,
  workflow_version VARCHAR(64) NULL,
  router_version VARCHAR(64) NULL,
  resume_from_task_key VARCHAR(128) NULL,
  created_by VARCHAR(128) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_checkpoints_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_checkpoints_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  UNIQUE KEY uq_checkpoints_run_sequence (run_id, sequence_no),
  INDEX idx_checkpoints_run_created (run_id, created_at),
  INDEX idx_checkpoints_resume (run_id, status, sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stage_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  stage_key VARCHAR(128) NOT NULL,
  snapshot_version INT NOT NULL,
  gate_status VARCHAR(32) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  current_guard VARCHAR(320)
    GENERATED ALWAYS AS (
      CASE WHEN is_current = TRUE THEN CONCAT(project_id, ':', stage_key) ELSE NULL END
    ) STORED,
  state_json JSON NOT NULL,
  evidence_json JSON NULL,
  runtime_commit_sha CHAR(40) NULL,
  knowledge_commit_sha CHAR(40) NULL,
  workflow_version VARCHAR(64) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_stage_snapshots_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_stage_snapshots_run FOREIGN KEY (run_id) REFERENCES runs(id),
  UNIQUE KEY uq_stage_snapshot_version (project_id, stage_key, snapshot_version),
  UNIQUE KEY uq_stage_current_guard (current_guard),
  INDEX idx_stage_snapshots_current (project_id, stage_key, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS route_executions (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  route_rule_key VARCHAR(128) NOT NULL,
  route_priority INT NULL,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  agent_key VARCHAR(128) NULL,
  skill_key VARCHAR(128) NULL,
  tool_key VARCHAR(128) NULL,
  policy_result VARCHAR(32) NULL,
  input_summary TEXT NULL,
  decision_json JSON NULL,
  duration_ms BIGINT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_route_executions_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_route_executions_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_route_run_rule (run_id, route_rule_key),
  INDEX idx_route_rule_match (route_rule_key, matched)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tool_executions (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  route_execution_id CHAR(36) NULL,
  tool_type VARCHAR(64) NOT NULL,
  tool_key VARCHAR(128) NOT NULL,
  model_key VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  token_input BIGINT NOT NULL DEFAULT 0,
  token_output BIGINT NOT NULL DEFAULT 0,
  cost_amount DECIMAL(18,6) NOT NULL DEFAULT 0,
  cost_currency CHAR(3) NOT NULL DEFAULT 'USD',
  duration_ms BIGINT NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_tool_executions_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_tool_executions_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_tool_executions_route FOREIGN KEY (route_execution_id) REFERENCES route_executions(id),
  INDEX idx_tool_run_status (run_id, status),
  INDEX idx_tool_task (task_id),
  INDEX idx_tool_key_created (tool_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS gate_results (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  stage_key VARCHAR(128) NOT NULL,
  gate_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  criteria_json JSON NOT NULL,
  evidence_json JSON NULL,
  blocking_reason TEXT NULL,
  decided_by VARCHAR(128) NOT NULL,
  decided_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_gate_results_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_gate_results_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_gate_run_stage (run_id, stage_key),
  INDEX idx_gate_key_status (gate_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS qa_evidence (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  gate_result_id CHAR(36) NULL,
  qa_case_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  evidence_uri TEXT NULL,
  evidence_json JSON NULL,
  issue_severity VARCHAR(32) NULL,
  issue_summary TEXT NULL,
  verified_by VARCHAR(128) NOT NULL,
  verified_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_qa_evidence_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_qa_evidence_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_qa_evidence_gate FOREIGN KEY (gate_result_id) REFERENCES gate_results(id),
  INDEX idx_qa_run_status (run_id, status),
  INDEX idx_qa_case (qa_case_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id CHAR(36) NULL,
  run_id CHAR(36) NULL,
  task_id CHAR(36) NULL,
  event_type VARCHAR(128) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_key VARCHAR(128) NOT NULL,
  object_type VARCHAR(64) NULL,
  object_id VARCHAR(128) NULL,
  event_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_audit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_audit_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_audit_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_audit_project_created (project_id, created_at),
  INDEX idx_audit_run_created (run_id, created_at),
  INDEX idx_audit_event_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
