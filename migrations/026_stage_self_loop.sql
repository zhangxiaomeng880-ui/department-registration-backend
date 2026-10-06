-- AI Native Runtime V2.5 M25.3 Stage Runtime / Self-loop
-- Migration: 026_stage_self_loop.sql
-- Adds atomic stage transition events and lifecycle attempt / gate state.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE project_stage_instances
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN last_gate_result_id CHAR(36) NULL AFTER gate_policy_key,
  ADD COLUMN last_transition_type VARCHAR(32) NULL AFTER last_gate_result_id,
  ADD COLUMN blocked_reason TEXT NULL AFTER last_transition_type,
  ADD COLUMN last_transition_at TIMESTAMP(6) NULL AFTER blocked_reason,
  ADD CONSTRAINT fk_m253_stage_last_gate
    FOREIGN KEY (last_gate_result_id) REFERENCES gate_results(id),
  ADD INDEX idx_m253_stage_transition (project_id,status,sequence_no,last_transition_at);

ALTER TABLE project_milestones
  ADD COLUMN last_transition_at TIMESTAMP(6) NULL AFTER completed_at,
  ADD INDEX idx_m253_milestone_transition (project_id,status,sequence_no,last_transition_at);

CREATE TABLE IF NOT EXISTS stage_transition_events (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  project_stage_instance_id CHAR(36) NOT NULL,
  target_stage_instance_id CHAR(36) NULL,
  transition_type VARCHAR(32) NOT NULL,
  gate_result_id CHAR(36) NOT NULL,
  checkpoint_id CHAR(36) NOT NULL,
  stage_snapshot_id CHAR(36) NOT NULL,
  from_stage_key VARCHAR(128) NOT NULL,
  to_stage_key VARCHAR(128) NULL,
  attempt_no INT NOT NULL,
  decision_json JSON NOT NULL,
  evidence_json JSON NULL,
  actor_key VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m253_transition_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m253_transition_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m253_transition_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m253_transition_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_m253_transition_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_m253_transition_stage FOREIGN KEY (project_stage_instance_id) REFERENCES project_stage_instances(id),
  CONSTRAINT fk_m253_transition_target_stage FOREIGN KEY (target_stage_instance_id) REFERENCES project_stage_instances(id),
  CONSTRAINT fk_m253_transition_gate FOREIGN KEY (gate_result_id) REFERENCES gate_results(id),
  CONSTRAINT fk_m253_transition_checkpoint FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id),
  CONSTRAINT fk_m253_transition_snapshot FOREIGN KEY (stage_snapshot_id) REFERENCES stage_snapshots(id),
  INDEX idx_m253_transition_project_created (project_id,created_at),
  INDEX idx_m253_transition_run_created (run_id,created_at),
  INDEX idx_m253_transition_stage_created (project_stage_instance_id,created_at),
  INDEX idx_m253_transition_type (transition_type,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
