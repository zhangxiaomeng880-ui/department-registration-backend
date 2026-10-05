-- AI Native Runtime V2.4 M24.5 Reliability Analytics
-- Migration: 023_eval_reliability_analytics.sql
-- Persists immutable, hash-verifiable reliability snapshots derived from Eval/Regression/Shadow evidence.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS eval_reliability_snapshots (
  id CHAR(36) PRIMARY KEY,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  candidate_runtime_sha CHAR(40) NULL,
  policy_version VARCHAR(64) NOT NULL,
  scope_json JSON NOT NULL,
  metrics_json JSON NOT NULL,
  source_watermark_json JSON NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  generated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_m245_snapshot_hash (snapshot_sha256),
  INDEX idx_m245_window (window_start,window_end,generated_at),
  INDEX idx_m245_runtime (candidate_runtime_sha,generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
