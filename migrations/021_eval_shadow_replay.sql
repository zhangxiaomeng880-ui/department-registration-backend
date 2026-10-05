-- AI Native Runtime V2.4 M24.4 Production-safe Replay / Shadow Eval
-- Migration: 021_eval_shadow_replay.sql
-- Adds explicit shadow-project isolation and immutable source-run fingerprints.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_shadow_projects (
  project_id CHAR(36) PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m244_shadow_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m244_shadow_project_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_shadow_replays (
  id CHAR(36) PRIMARY KEY,
  source_run_id CHAR(36) NOT NULL,
  source_project_id CHAR(36) NOT NULL,
  replay_manifest_id CHAR(36) NOT NULL,
  execution_project_id CHAR(36) NOT NULL,
  baseline_runtime_sha CHAR(40) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  source_snapshot_sha256 CHAR(64) NOT NULL,
  eval_run_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PREPARED',
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  prepared_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m244_shadow_source_run FOREIGN KEY (source_run_id) REFERENCES runs(id),
  CONSTRAINT fk_m244_shadow_source_project FOREIGN KEY (source_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m244_shadow_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  CONSTRAINT fk_m244_shadow_execution_project FOREIGN KEY (execution_project_id) REFERENCES eval_shadow_projects(project_id),
  CONSTRAINT fk_m244_shadow_eval_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  INDEX idx_m244_shadow_source_run (source_run_id,created_at),
  INDEX idx_m244_shadow_candidate (candidate_runtime_sha,created_at),
  INDEX idx_m244_shadow_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
