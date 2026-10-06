-- AI Native Runtime V2.6 M26.2 Milestone Intelligence / Forecast / Update / Staleness / Capacity
-- Migration: 031_milestone_intelligence.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE projects
  ADD COLUMN update_cadence_days INT NULL AFTER health,
  ADD COLUMN last_update_at TIMESTAMP(6) NULL AFTER update_cadence_days,
  ADD COLUMN stale_after_at TIMESTAMP(6) NULL AFTER last_update_at;

ALTER TABLE project_milestones
  ADD COLUMN calculated_progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER progress_percent,
  ADD COLUMN progress_override_percent DECIMAL(5,2) NULL AFTER calculated_progress_percent,
  ADD COLUMN progress_override_reason TEXT NULL AFTER progress_override_percent,
  ADD COLUMN progress_override_at TIMESTAMP(6) NULL AFTER progress_override_reason,
  ADD COLUMN health VARCHAR(16) NOT NULL DEFAULT 'ON_TRACK' AFTER progress_override_at,
  ADD COLUMN forecast_end DATE NULL AFTER health,
  ADD COLUMN forecast_method VARCHAR(64) NULL AFTER forecast_end,
  ADD COLUMN forecast_confidence VARCHAR(16) NULL AFTER forecast_method,
  ADD COLUMN update_cadence_days INT NULL AFTER forecast_confidence,
  ADD COLUMN last_update_at TIMESTAMP(6) NULL AFTER update_cadence_days,
  ADD COLUMN stale_after_at TIMESTAMP(6) NULL AFTER last_update_at,
  ADD COLUMN capacity_signal_json JSON NULL AFTER stale_after_at,
  ADD COLUMN dependency_signal_json JSON NULL AFTER capacity_signal_json,
  ADD COLUMN completion_evidence_json JSON NULL AFTER dependency_signal_json,
  ADD COLUMN completed_by_identity_id CHAR(36) NULL AFTER completion_evidence_json,
  ADD CONSTRAINT fk_m262_milestone_completed_by
    FOREIGN KEY (completed_by_identity_id) REFERENCES identities(id),
  ADD INDEX idx_m262_milestone_intelligence
    (project_id,management_status,health,forecast_end,stale_after_at);

CREATE TABLE IF NOT EXISTS governance_updates (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  target_type VARCHAR(24) NOT NULL,
  target_id CHAR(36) NOT NULL,
  update_status VARCHAR(16) NOT NULL,
  progress_percent DECIMAL(5,2) NULL,
  target_end DATE NULL,
  forecast_end DATE NULL,
  blocker_text TEXT NULL,
  decision_needed TEXT NULL,
  next_action TEXT NULL,
  evidence_json JSON NULL,
  observed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m262_update_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m262_update_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m262_update_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  INDEX idx_m262_update_target (target_type,target_id,observed_at),
  INDEX idx_m262_update_project (project_id,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS governance_capacity_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  target_type VARCHAR(24) NOT NULL,
  target_id CHAR(36) NOT NULL,
  available_hours_per_calendar_day DECIMAL(12,4) NULL,
  throughput_items_per_calendar_day DECIMAL(12,4) NULL,
  capacity_units_json JSON NULL,
  source_json JSON NULL,
  observed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m262_capacity_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m262_capacity_target (target_type,target_id,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  version_key VARCHAR(128) NOT NULL,
  version_type VARCHAR(32) NOT NULL,
  label VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  source_pointer_json JSON NULL,
  evidence_json JSON NULL,
  effective_at TIMESTAMP(6) NULL,
  retired_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m262_version_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m262_project_version (project_id,version_key),
  INDEX idx_m262_version_type_status (project_id,version_type,status,effective_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS milestone_version_links (
  milestone_id CHAR(36) NOT NULL,
  project_version_id CHAR(36) NOT NULL,
  link_role VARCHAR(32) NOT NULL DEFAULT 'TARGET',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (milestone_id,project_version_id,link_role),
  CONSTRAINT fk_m262_milestone_version_milestone FOREIGN KEY (milestone_id) REFERENCES project_milestones(id),
  CONSTRAINT fk_m262_milestone_version_version FOREIGN KEY (project_version_id) REFERENCES project_versions(id),
  INDEX idx_m262_version_milestone (project_version_id,milestone_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
