-- AI Native Runtime V2.6 M26.4 Portfolio Intelligence / Project Closure Governance
-- Migration: 033_portfolio_closure_governance.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE portfolios
  ADD COLUMN last_intelligence_at TIMESTAMP(6) NULL AFTER status;

CREATE TABLE IF NOT EXISTS project_health_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  health VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  signals_json JSON NOT NULL,
  evidence_json JSON NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m264_health_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m264_health_project_asof (project_id,as_of),
  INDEX idx_m264_health_value (health,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS portfolio_intelligence_snapshots (
  id CHAR(36) PRIMARY KEY,
  portfolio_id CHAR(36) NOT NULL,
  health VARCHAR(16) NOT NULL,
  project_count INT NOT NULL DEFAULT 0,
  at_risk_count INT NOT NULL DEFAULT 0,
  blocked_count INT NOT NULL DEFAULT 0,
  forecast_end DATE NULL,
  cross_project_dependency_count INT NOT NULL DEFAULT 0,
  capacity_signal_json JSON NULL,
  budget_signal_json JSON NULL,
  project_summary_json JSON NOT NULL,
  evidence_json JSON NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m264_portfolio_snapshot_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  INDEX idx_m264_portfolio_snapshot_asof (portfolio_id,as_of),
  INDEX idx_m264_portfolio_snapshot_health (health,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_closure_reviews (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  final_baseline_id CHAR(36) NOT NULL,
  final_review_status VARCHAR(32) NOT NULL,
  final_review_json JSON NOT NULL,
  archive_policy_json JSON NOT NULL,
  outcome_json JSON NULL,
  residual_risks_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m264_closure_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m264_closure_baseline FOREIGN KEY (final_baseline_id) REFERENCES project_baselines(id),
  CONSTRAINT fk_m264_closure_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  INDEX idx_m264_closure_project_created (project_id,created_at),
  INDEX idx_m264_closure_status (project_id,final_review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
