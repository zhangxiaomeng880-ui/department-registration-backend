-- AI Native Runtime V2.4 M24.2 Eval Runner + Assertion Engine
-- Migration: 018_eval_runner.sql
-- Executes frozen replay manifests through the existing Runtime path and stores only sanitized assertion evidence.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_runs (
  id CHAR(36) PRIMARY KEY,
  replay_manifest_id CHAR(36) NOT NULL,
  execution_project_id CHAR(36) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  total_cases INT UNSIGNED NOT NULL DEFAULT 0,
  passed_cases INT UNSIGNED NOT NULL DEFAULT 0,
  failed_cases INT UNSIGNED NOT NULL DEFAULT 0,
  result_sha256 CHAR(64) NULL,
  summary_json JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_eval_run_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  CONSTRAINT fk_m242_eval_run_project FOREIGN KEY (execution_project_id) REFERENCES projects(id),
  INDEX idx_m242_eval_run_manifest (replay_manifest_id,created_at),
  INDEX idx_m242_eval_run_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_case_results (
  id CHAR(36) PRIMARY KEY,
  eval_run_id CHAR(36) NOT NULL,
  eval_case_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  runtime_run_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL,
  assertion_results_json JSON NOT NULL,
  route_summary_json JSON NULL,
  execution_summary_json JSON NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  result_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_case_result_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m242_case_result_case FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id),
  CONSTRAINT fk_m242_case_result_runtime_run FOREIGN KEY (runtime_run_id) REFERENCES runs(id),
  UNIQUE KEY uq_m242_eval_case_result (eval_run_id,eval_case_id),
  INDEX idx_m242_eval_case_status (eval_run_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
