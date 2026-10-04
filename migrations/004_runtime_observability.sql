-- AI Native 2.1 Runtime Observability
-- Migration: 004_runtime_observability.sql
-- Additive only. Keeps v2.0 API/schema compatibility.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE runs
  ADD COLUMN correlation_id CHAR(36) NULL AFTER id,
  ADD COLUMN error_category VARCHAR(64) NULL AFTER error_code,
  ADD INDEX idx_runs_correlation (correlation_id);

ALTER TABLE tasks
  ADD COLUMN correlation_id CHAR(36) NULL AFTER run_id,
  ADD COLUMN error_category VARCHAR(64) NULL AFTER error_code,
  ADD INDEX idx_tasks_correlation (correlation_id);

ALTER TABLE route_executions
  ADD COLUMN correlation_id CHAR(36) NULL AFTER task_id,
  ADD COLUMN error_category VARCHAR(64) NULL AFTER duration_ms,
  ADD INDEX idx_route_correlation (correlation_id);

ALTER TABLE tool_executions
  ADD COLUMN correlation_id CHAR(36) NULL AFTER route_execution_id,
  ADD COLUMN provider_key VARCHAR(128) NULL AFTER tool_key,
  ADD COLUMN error_category VARCHAR(64) NULL AFTER error_code,
  ADD INDEX idx_tool_correlation (correlation_id),
  ADD INDEX idx_tool_provider_model (provider_key, model_key, created_at);

ALTER TABLE gate_results
  ADD COLUMN correlation_id CHAR(36) NULL AFTER task_id,
  ADD INDEX idx_gate_correlation (correlation_id);

ALTER TABLE qa_evidence
  ADD COLUMN correlation_id CHAR(36) NULL AFTER task_id,
  ADD INDEX idx_qa_correlation (correlation_id);

ALTER TABLE checkpoints
  ADD COLUMN correlation_id CHAR(36) NULL AFTER task_id,
  ADD INDEX idx_checkpoint_correlation (correlation_id);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  route_execution_id CHAR(36) NULL,
  tool_execution_id CHAR(36) NOT NULL,
  correlation_id CHAR(36) NULL,
  provider_key VARCHAR(128) NULL,
  model_key VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  token_input BIGINT NOT NULL DEFAULT 0,
  token_output BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT NULL,
  error_category VARCHAR(64) NULL,
  recorded_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_usage_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_usage_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_usage_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_usage_route FOREIGN KEY (route_execution_id) REFERENCES route_executions(id),
  CONSTRAINT fk_usage_tool FOREIGN KEY (tool_execution_id) REFERENCES tool_executions(id),
  UNIQUE KEY uq_usage_tool_execution (tool_execution_id),
  INDEX idx_usage_project_recorded (project_id, recorded_at),
  INDEX idx_usage_run_recorded (run_id, recorded_at),
  INDEX idx_usage_provider_model (provider_key, model_key, recorded_at),
  INDEX idx_usage_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
