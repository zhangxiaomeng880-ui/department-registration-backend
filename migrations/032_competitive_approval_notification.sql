-- AI Native Runtime V2.6 M26.3 Competitive Intelligence + Approval / Notification
-- Migration: 032_competitive_approval_notification.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS benchmark_subjects (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  benchmark_type VARCHAR(32) NOT NULL,
  subject_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  capability_key VARCHAR(320) NULL,
  external_reference_json JSON NULL,
  creative_usage_role VARCHAR(64) NULL,
  rights_status VARCHAR(64) NULL,
  forbidden_copying BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_benchmark_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m263_benchmark_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_benchmark_capability FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m263_benchmark_subject (workspace_id,benchmark_type,subject_key),
  INDEX idx_m263_benchmark_type (workspace_id,benchmark_type,status),
  INDEX idx_m263_benchmark_project (project_id,benchmark_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS benchmark_dimensions (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  benchmark_type VARCHAR(32) NOT NULL,
  dimension_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  unit VARCHAR(64) NULL,
  comparison_direction VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_dimension_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE KEY uq_m263_dimension (workspace_id,benchmark_type,dimension_key),
  INDEX idx_m263_dimension_type (workspace_id,benchmark_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  id CHAR(36) PRIMARY KEY,
  subject_id CHAR(36) NOT NULL,
  snapshot_key VARCHAR(128) NOT NULL,
  source_provider VARCHAR(128) NOT NULL,
  source_ref VARCHAR(1024) NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  as_of_date DATE NOT NULL,
  region VARCHAR(128) NULL,
  plan_key VARCHAR(128) NULL,
  version_label VARCHAR(128) NULL,
  freshness_days INT NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CURRENT',
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_snapshot_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  UNIQUE KEY uq_m263_snapshot_key (subject_id,snapshot_key),
  INDEX idx_m263_snapshot_freshness (subject_id,status,expires_at,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS benchmark_observations (
  id CHAR(36) PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL,
  dimension_key VARCHAR(128) NOT NULL,
  observation_type VARCHAR(16) NOT NULL,
  statement TEXT NOT NULL,
  value_json JSON NULL,
  confidence VARCHAR(16) NOT NULL,
  evidence_json JSON NOT NULL,
  source_locator_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_observation_snapshot FOREIGN KEY (snapshot_id) REFERENCES benchmark_snapshots(id),
  INDEX idx_m263_observation_dimension (snapshot_id,dimension_key,observation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS creative_references (
  id CHAR(36) PRIMARY KEY,
  subject_id CHAR(36) NOT NULL,
  snapshot_id CHAR(36) NOT NULL,
  usage_role VARCHAR(64) NOT NULL,
  rights_status VARCHAR(64) NOT NULL,
  forbidden_copying BOOLEAN NOT NULL DEFAULT TRUE,
  reference_scope_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_creative_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  CONSTRAINT fk_m263_creative_snapshot FOREIGN KEY (snapshot_id) REFERENCES benchmark_snapshots(id),
  UNIQUE KEY uq_m263_creative_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS capability_benchmark_runs (
  id CHAR(36) PRIMARY KEY,
  subject_id CHAR(36) NOT NULL,
  snapshot_id CHAR(36) NOT NULL,
  capability_key VARCHAR(320) NOT NULL,
  eval_run_id CHAR(36) NULL,
  quality_score DECIMAL(12,4) NULL,
  latency_ms BIGINT NULL,
  cost_amount DECIMAL(18,8) NULL,
  cost_currency CHAR(3) NULL,
  reliability_score DECIMAL(12,4) NULL,
  reference_support_json JSON NULL,
  rights_terms_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_cap_run_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  CONSTRAINT fk_m263_cap_run_snapshot FOREIGN KEY (snapshot_id) REFERENCES benchmark_snapshots(id),
  CONSTRAINT fk_m263_cap_run_capability FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  CONSTRAINT fk_m263_cap_run_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  INDEX idx_m263_cap_run (capability_key,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS market_signals (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  subject_id CHAR(36) NULL,
  signal_key VARCHAR(128) NOT NULL,
  signal_type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  source_provider VARCHAR(128) NOT NULL,
  source_ref VARCHAR(1024) NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  as_of_date DATE NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_signal_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m263_signal_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_signal_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  UNIQUE KEY uq_m263_signal_key (workspace_id,signal_key),
  INDEX idx_m263_signal_freshness (workspace_id,status,expires_at,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS competitor_change_events (
  id CHAR(36) PRIMARY KEY,
  subject_id CHAR(36) NOT NULL,
  from_snapshot_id CHAR(36) NULL,
  to_snapshot_id CHAR(36) NOT NULL,
  change_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  summary TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  detected_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_change_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  CONSTRAINT fk_m263_change_from_snapshot FOREIGN KEY (from_snapshot_id) REFERENCES benchmark_snapshots(id),
  CONSTRAINT fk_m263_change_to_snapshot FOREIGN KEY (to_snapshot_id) REFERENCES benchmark_snapshots(id),
  INDEX idx_m263_change_subject (subject_id,detected_at,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS benchmark_decision_links (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  decision_id CHAR(36) NULL,
  subject_id CHAR(36) NOT NULL,
  snapshot_id CHAR(36) NULL,
  observation_id CHAR(36) NULL,
  change_event_id CHAR(36) NULL,
  link_role VARCHAR(32) NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_link_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_link_decision FOREIGN KEY (decision_id) REFERENCES project_decisions(id),
  CONSTRAINT fk_m263_link_subject FOREIGN KEY (subject_id) REFERENCES benchmark_subjects(id),
  CONSTRAINT fk_m263_link_snapshot FOREIGN KEY (snapshot_id) REFERENCES benchmark_snapshots(id),
  CONSTRAINT fk_m263_link_observation FOREIGN KEY (observation_id) REFERENCES benchmark_observations(id),
  CONSTRAINT fk_m263_link_change FOREIGN KEY (change_event_id) REFERENCES competitor_change_events(id),
  INDEX idx_m263_link_project (project_id,decision_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS approval_requests (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  request_key VARCHAR(128) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  required_role VARCHAR(64) NULL,
  approver_identity_id CHAR(36) NULL,
  requested_action VARCHAR(128) NOT NULL,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  context_json JSON NULL,
  evidence_json JSON NOT NULL,
  due_at TIMESTAMP(6) NULL,
  escalation_at TIMESTAMP(6) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  effective_object_type VARCHAR(64) NULL,
  effective_object_id VARCHAR(191) NULL,
  effective_version VARCHAR(128) NULL,
  requested_by_identity_id CHAR(36) NULL,
  decided_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_approval_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m263_approval_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m263_approval_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_approval_approver FOREIGN KEY (approver_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m263_approval_requester FOREIGN KEY (requested_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m263_approval_request (workspace_id,request_key),
  INDEX idx_m263_approval_inbox (workspace_id,status,due_at,risk_level),
  INDEX idx_m263_approval_project (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS approval_decisions (
  id CHAR(36) PRIMARY KEY,
  approval_request_id CHAR(36) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  decided_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_decision_request FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  CONSTRAINT fk_m263_decision_identity FOREIGN KEY (decided_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m263_decision_request (approval_request_id),
  INDEX idx_m263_decision_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  recipient_identity_id CHAR(36) NULL,
  notification_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'INFO',
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body_text TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'UNREAD',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  read_at TIMESTAMP(6) NULL,
  dismissed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m263_notification_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m263_notification_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m263_notification_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_notification_recipient FOREIGN KEY (recipient_identity_id) REFERENCES identities(id),
  INDEX idx_m263_notification_inbox (workspace_id,recipient_identity_id,status,created_at),
  INDEX idx_m263_notification_project (project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS activity_events (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  event_type VARCHAR(64) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(191) NOT NULL,
  actor_identity_id CHAR(36) NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m263_activity_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m263_activity_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m263_activity_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m263_activity_actor FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  INDEX idx_m263_activity_workspace (workspace_id,created_at,event_type),
  INDEX idx_m263_activity_project (project_id,created_at,event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
