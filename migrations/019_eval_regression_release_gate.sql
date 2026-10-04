-- AI Native Runtime V2.4 M24.3 Regression Comparator + Release Gate
-- Migration: 019_eval_regression_release_gate.sql
-- Compares immutable Eval Runs and persists deterministic release-gate decisions.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_regression_comparisons (
  id CHAR(36) PRIMARY KEY,
  baseline_eval_run_id CHAR(36) NOT NULL,
  candidate_eval_run_id CHAR(36) NOT NULL,
  baseline_runtime_sha CHAR(40) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  fixture_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  case_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  case_improvements INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_improvements INT UNSIGNED NOT NULL DEFAULT 0,
  evidence_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  router_drifts INT UNSIGNED NOT NULL DEFAULT 0,
  baseline_total_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  candidate_total_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  cost_change_pct DECIMAL(20,6) NULL,
  baseline_total_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  candidate_total_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  latency_change_pct DECIMAL(20,6) NULL,
  comparison_sha256 CHAR(64) NOT NULL,
  summary_json JSON NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_comparison_baseline_run FOREIGN KEY (baseline_eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m243_comparison_candidate_run FOREIGN KEY (candidate_eval_run_id) REFERENCES eval_runs(id),
  UNIQUE KEY uq_m243_comparison_pair (baseline_eval_run_id,candidate_eval_run_id),
  INDEX idx_m243_comparison_candidate (candidate_runtime_sha,created_at),
  INDEX idx_m243_comparison_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_regression_case_diffs (
  id CHAR(36) PRIMARY KEY,
  comparison_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  baseline_status VARCHAR(32) NOT NULL,
  candidate_status VARCHAR(32) NOT NULL,
  case_transition VARCHAR(32) NOT NULL,
  assertion_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_improvements INT UNSIGNED NOT NULL DEFAULT 0,
  evidence_regressions INT UNSIGNED NOT NULL DEFAULT 0,
  router_drift BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  candidate_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  cost_change_pct DECIMAL(20,6) NULL,
  baseline_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  candidate_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  latency_change_pct DECIMAL(20,6) NULL,
  diff_json JSON NOT NULL,
  diff_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_case_diff_comparison FOREIGN KEY (comparison_id) REFERENCES eval_regression_comparisons(id),
  UNIQUE KEY uq_m243_comparison_case (comparison_id,case_key),
  INDEX idx_m243_case_transition (comparison_id,case_transition)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_release_gates (
  id CHAR(36) PRIMARY KEY,
  comparison_id CHAR(36) NOT NULL,
  gate_key VARCHAR(191) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  policy_json JSON NOT NULL,
  blockers_json JSON NOT NULL,
  policy_sha256 CHAR(64) NOT NULL,
  decision_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  decided_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m243_release_gate_comparison FOREIGN KEY (comparison_id) REFERENCES eval_regression_comparisons(id),
  UNIQUE KEY uq_m243_gate_key_comparison (comparison_id,gate_key),
  INDEX idx_m243_gate_decision (decision,decided_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
