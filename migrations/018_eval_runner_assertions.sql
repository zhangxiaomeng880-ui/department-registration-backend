-- AI Native Runtime V2.4 M24.2 Eval Runner + Assertion Engine
-- Migration: 018_eval_runner_assertions.sql
-- Persists synthetic replay executions and deterministic assertion evidence.
-- No external model/provider invocation is introduced by this migration.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_runs (
  id CHAR(36) PRIMARY KEY,
  replay_manifest_id CHAR(36) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  baseline_runtime_sha CHAR(40) NULL,
  execution_mode VARCHAR(32) NOT NULL DEFAULT 'SYNTHETIC_REPLAY',
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  case_count INT UNSIGNED NOT NULL DEFAULT 0,
  passed_case_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_case_count INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  passed_assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  result_sha256 CHAR(64) NULL,
  summary_json JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_eval_run_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  INDEX idx_m242_eval_run_manifest (replay_manifest_id,created_at),
  INDEX idx_m242_eval_run_candidate (candidate_runtime_sha,created_at),
  INDEX idx_m242_eval_run_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_case_results (
  id CHAR(36) PRIMARY KEY,
  eval_run_id CHAR(36) NOT NULL,
  eval_case_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  route_json JSON NOT NULL,
  observed_output_json JSON NULL,
  observed_evidence_json JSON NULL,
  observed_execution_json JSON NULL,
  assertion_summary_json JSON NOT NULL,
  result_sha256 CHAR(64) NOT NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_case_result_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m242_case_result_case FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id),
  UNIQUE KEY uq_m242_eval_run_case (eval_run_id,eval_case_id),
  INDEX idx_m242_case_result_status (eval_run_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_assertion_results (
  id CHAR(36) PRIMARY KEY,
  eval_case_result_id CHAR(36) NOT NULL,
  assertion_group VARCHAR(64) NOT NULL,
  assertion_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  expected_json JSON NULL,
  actual_json JSON NULL,
  failure_code VARCHAR(128) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_assertion_case_result FOREIGN KEY (eval_case_result_id) REFERENCES eval_case_results(id),
  UNIQUE KEY uq_m242_assertion_key (eval_case_result_id,assertion_group,assertion_key),
  INDEX idx_m242_assertion_status (eval_case_result_id,status,assertion_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
