-- AI Native Runtime V2.4 M24.4 Production-safe Replay / Shadow Eval
-- Migration: 021_production_safe_shadow_eval.sql
-- Adds server-owned Shadow Eval policy controls and marks Shadow usage as non-billable.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE usage_ledger
  ADD COLUMN usage_class VARCHAR(16) NOT NULL DEFAULT 'BILLABLE' AFTER status,
  ADD INDEX idx_m244_usage_class_recorded (usage_class,recorded_at),
  ADD INDEX idx_m244_tenant_usage_class (tenant_id,usage_class,recorded_at);

CREATE TABLE IF NOT EXISTS shadow_eval_policies (
  id CHAR(36) PRIMARY KEY,
  policy_key VARCHAR(191) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  max_cases_per_run INT UNSIGNED NOT NULL,
  max_estimated_cost DECIMAL(30,10) NOT NULL,
  cost_currency CHAR(3) NOT NULL,
  max_duration_ms BIGINT UNSIGNED NOT NULL,
  allowed_task_types_json JSON NOT NULL,
  allowed_provider_keys_json JSON NOT NULL,
  allowed_model_keys_json JSON NOT NULL,
  require_transient_context TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m244_shadow_policy_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS shadow_eval_executions (
  id CHAR(36) PRIMARY KEY,
  policy_id CHAR(36) NOT NULL,
  replay_manifest_id CHAR(36) NOT NULL,
  execution_project_id CHAR(36) NOT NULL,
  eval_run_id CHAR(36) NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  case_count INT UNSIGNED NOT NULL DEFAULT 0,
  actual_estimated_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  cost_currency CHAR(3) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  blocked_reason VARCHAR(128) NULL,
  summary_json JSON NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m244_shadow_policy FOREIGN KEY (policy_id) REFERENCES shadow_eval_policies(id),
  CONSTRAINT fk_m244_shadow_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  CONSTRAINT fk_m244_shadow_project FOREIGN KEY (execution_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m244_shadow_eval_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  INDEX idx_m244_shadow_status (status,created_at),
  INDEX idx_m244_shadow_manifest (replay_manifest_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
