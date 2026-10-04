-- AI Native Runtime V2.4 M24.1 Eval Dataset + Replay Contract
-- Migration: 017_eval_replay_contract.sql
-- Defines immutable, hash-verifiable synthetic eval fixtures and replay manifests.
-- No model/provider execution is introduced by this migration.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_suites (
  id CHAR(36) PRIMARY KEY,
  suite_key VARCHAR(191) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m241_eval_suite_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_suite_versions (
  id CHAR(36) PRIMARY KEY,
  suite_id CHAR(36) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  replay_contract_version VARCHAR(64) NOT NULL DEFAULT 'eval-replay-v1',
  fixture_sha256 CHAR(64) NULL,
  case_count INT UNSIGNED NOT NULL DEFAULT 0,
  frozen_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m241_eval_version_suite FOREIGN KEY (suite_id) REFERENCES eval_suites(id),
  UNIQUE KEY uq_m241_eval_suite_version (suite_id,version_no),
  INDEX idx_m241_eval_version_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_cases (
  id CHAR(36) PRIMARY KEY,
  suite_version_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  fixture_kind VARCHAR(32) NOT NULL DEFAULT 'SYNTHETIC',
  replay_input_json JSON NOT NULL,
  source_refs_json JSON NULL,
  assertions_json JSON NOT NULL,
  case_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m241_eval_case_version FOREIGN KEY (suite_version_id) REFERENCES eval_suite_versions(id),
  UNIQUE KEY uq_m241_eval_case_key (suite_version_id,case_key),
  UNIQUE KEY uq_m241_eval_case_sequence (suite_version_id,sequence_no),
  INDEX idx_m241_eval_case_version (suite_version_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_replay_manifests (
  id CHAR(36) PRIMARY KEY,
  suite_version_id CHAR(36) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  baseline_runtime_sha CHAR(40) NULL,
  workflow_version VARCHAR(64) NULL,
  router_version VARCHAR(64) NULL,
  rag_index_version VARCHAR(128) NULL,
  replay_contract_version VARCHAR(64) NOT NULL,
  fixture_sha256 CHAR(64) NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'READY',
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  metadata_json JSON NULL,
  generated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m241_replay_manifest_version FOREIGN KEY (suite_version_id) REFERENCES eval_suite_versions(id),
  INDEX idx_m241_replay_candidate (candidate_runtime_sha,generated_at),
  INDEX idx_m241_replay_suite (suite_version_id,generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
