-- AI Native Runtime V2.4 M24.3 Regression Comparator + Release Gate
-- Migration: 020_eval_regression_gate.sql
-- Built on the deployed M24.2 Runtime Replay schema (018 + 019 compatibility).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_regression_comparisons (
  id CHAR(36) PRIMARY KEY,
  baseline_eval_run_id CHAR(36) NOT NULL,
  candidate_eval_run_id CHAR(36) NOT NULL,
  suite_version_id CHAR(36) NOT NULL,
  fixture_sha256 CHAR(64) NOT NULL,
  baseline_runtime_sha CHAR(40) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  policy_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL,
  blocker_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  case_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  case_improvements INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_improvements INT UNSIGNED NOT NULL DEFAULT 0,
  evidence_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  router_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  latency_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  cost_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  summary_json JSON NOT NULL,
  comparison_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_cmp_baseline FOREIGN KEY (baseline_eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m243_cmp_candidate FOREIGN KEY (candidate_eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m243_cmp_suite_version FOREIGN KEY (suite_version_id) REFERENCES eval_suite_versions(id),
  UNIQUE KEY uq_m243_cmp_pair_policy (baseline_eval_run_id,candidate_eval_run_id,policy_version),
  INDEX idx_m243_cmp_candidate (candidate_eval_run_id,created_at),
  INDEX idx_m243_cmp_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_case_regressions (
  id CHAR(36) PRIMARY KEY,
  comparison_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  baseline_status VARCHAR(32) NULL,
  candidate_status VARCHAR(32) NULL,
  transition VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  blocker_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  blockers_json JSON NOT NULL,
  warnings_json JSON NOT NULL,
  metrics_json JSON NOT NULL,
  comparison_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_case_cmp FOREIGN KEY (comparison_id) REFERENCES eval_regression_comparisons(id),
  UNIQUE KEY uq_m243_case_cmp_key (comparison_id,case_key),
  INDEX idx_m243_case_cmp_status (comparison_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_release_gates (
  id CHAR(36) PRIMARY KEY,
  comparison_id CHAR(36) NOT NULL,
  gate_key VARCHAR(191) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  blocker_count INT UNSIGNED NOT NULL,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  blockers_json JSON NOT NULL,
  warnings_json JSON NOT NULL,
  policy_sha256 CHAR(64) NOT NULL,
  gate_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  decided_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_gate_cmp FOREIGN KEY (comparison_id) REFERENCES eval_regression_comparisons(id),
  UNIQUE KEY uq_m243_gate_key_cmp (comparison_id,gate_key),
  INDEX idx_m243_gate_decision (decision,decided_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
