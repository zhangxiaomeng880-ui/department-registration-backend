-- AI Native Runtime V2.5 M25.4 Workflow Auto-Orchestration / Project Self-loop
-- Migration: 027_workflow_auto_orchestration.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS workflow_orchestration_sessions (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  workflow_template_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  current_stage_key VARCHAR(128) NULL,
  stop_reason_code VARCHAR(128) NULL,
  stop_reason_message TEXT NULL,
  stage_attempts INT NOT NULL DEFAULT 0,
  capability_invocation_count INT NOT NULL DEFAULT 0,
  max_stage_transitions INT NOT NULL DEFAULT 100,
  input_manifest_json JSON NULL,
  result_json JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m254_session_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m254_session_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m254_session_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m254_session_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_m254_session_template FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  INDEX idx_m254_session_project (project_id,status,created_at),
  INDEX idx_m254_session_run (run_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_orchestration_stage_attempts (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  project_stage_instance_id CHAR(36) NOT NULL,
  stage_key VARCHAR(128) NOT NULL,
  attempt_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  required_requirement_count INT NOT NULL DEFAULT 0,
  optional_requirement_count INT NOT NULL DEFAULT 0,
  invocation_count INT NOT NULL DEFAULT 0,
  passed_invocation_count INT NOT NULL DEFAULT 0,
  failed_invocation_count INT NOT NULL DEFAULT 0,
  gate_status VARCHAR(32) NULL,
  transition_type VARCHAR(32) NULL,
  transition_event_id CHAR(36) NULL,
  decision_json JSON NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m254_attempt_session FOREIGN KEY (session_id) REFERENCES workflow_orchestration_sessions(id),
  CONSTRAINT fk_m254_attempt_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_m254_attempt_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_m254_attempt_stage FOREIGN KEY (project_stage_instance_id) REFERENCES project_stage_instances(id),
  CONSTRAINT fk_m254_attempt_transition FOREIGN KEY (transition_event_id) REFERENCES stage_transition_events(id),
  UNIQUE KEY uq_m254_attempt_stage_no (session_id,project_stage_instance_id,attempt_no),
  INDEX idx_m254_attempt_session (session_id,created_at),
  INDEX idx_m254_attempt_stage (project_stage_instance_id,status,attempt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
