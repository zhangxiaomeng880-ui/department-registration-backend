-- AI Native Runtime V2.5 M25.5 Knowledge / Context Injection & Backwrite
-- Migration: 028_knowledge_context_backwrite.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS stage_knowledge_policies (
  id CHAR(36) PRIMARY KEY,
  workflow_stage_id CHAR(36) NOT NULL,
  policy_key VARCHAR(128) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  query_template TEXT NOT NULL,
  context_role VARCHAR(64) NOT NULL DEFAULT 'REFERENCE',
  required BOOLEAN NOT NULL DEFAULT TRUE,
  max_items INT NOT NULL DEFAULT 12,
  allowed_statuses_json JSON NOT NULL,
  injection_mode VARCHAR(32) NOT NULL DEFAULT 'APPEND_CONTEXT',
  writeback_mode VARCHAR(32) NOT NULL DEFAULT 'NONE',
  writeback_target_path VARCHAR(1024) NULL,
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m255_stage_knowledge_stage
    FOREIGN KEY (workflow_stage_id) REFERENCES workflow_template_stages(id),
  UNIQUE KEY uq_m255_stage_knowledge_policy (workflow_stage_id,policy_key),
  INDEX idx_m255_stage_knowledge_source (source_key,workflow_stage_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE workflow_orchestration_stage_attempts
  ADD COLUMN knowledge_context_count INT NOT NULL DEFAULT 0 AFTER failed_invocation_count,
  ADD COLUMN context_hash VARCHAR(128) NULL AFTER knowledge_context_count,
  ADD COLUMN writeback_count INT NOT NULL DEFAULT 0 AFTER context_hash,
  ADD INDEX idx_m255_attempt_context (session_id,context_hash);

CREATE TABLE IF NOT EXISTS knowledge_writeback_queue (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  project_stage_instance_id CHAR(36) NOT NULL,
  knowledge_policy_id CHAR(36) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  target_path VARCHAR(1024) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  payload_json JSON NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  expected_source_version VARCHAR(255) NULL,
  applied_source_version VARCHAR(255) NULL,
  external_write_id VARCHAR(255) NULL,
  decision_json JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at TIMESTAMP(6) NULL,
  applied_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m255_writeback_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m255_writeback_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m255_writeback_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m255_writeback_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_m255_writeback_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_m255_writeback_stage FOREIGN KEY (project_stage_instance_id) REFERENCES project_stage_instances(id),
  CONSTRAINT fk_m255_writeback_policy FOREIGN KEY (knowledge_policy_id) REFERENCES stage_knowledge_policies(id),
  INDEX idx_m255_writeback_project (project_id,status,created_at),
  INDEX idx_m255_writeback_source (source_key,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
