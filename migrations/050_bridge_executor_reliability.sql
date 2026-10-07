-- AI Native Runtime V2.8 M28.5 Integrated Bridge Executor Reliability
-- Migration: 050_bridge_executor_reliability.sql
-- Adds least-privilege bridge permissions plus claim/lease/retry/dead-letter audit state.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT IGNORE INTO rbac_role_permissions (role_key,permission_key) VALUES
  ('TENANT_OWNER','bridge:read'),
  ('TENANT_OWNER','bridge:execute'),
  ('TENANT_ADMIN','bridge:read'),
  ('TENANT_ADMIN','bridge:execute'),
  ('WORKSPACE_ADMIN','bridge:read'),
  ('WORKSPACE_ADMIN','bridge:execute'),
  ('OPERATOR','bridge:read'),
  ('OPERATOR','bridge:execute');

ALTER TABLE trigger_dispatches
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN max_attempts INT NOT NULL DEFAULT 3 AFTER attempt_count,
  ADD COLUMN claimed_by_credential_id CHAR(36) NULL AFTER max_attempts,
  ADD COLUMN claimed_by_identity_id CHAR(36) NULL AFTER claimed_by_credential_id,
  ADD COLUMN claimed_at TIMESTAMP(6) NULL AFTER claimed_by_identity_id,
  ADD COLUMN lease_expires_at TIMESTAMP(6) NULL AFTER claimed_at,
  ADD COLUMN next_attempt_at TIMESTAMP(6) NULL AFTER lease_expires_at,
  ADD COLUMN last_error_code VARCHAR(128) NULL AFTER next_attempt_at,
  ADD COLUMN last_error_message TEXT NULL AFTER last_error_code,
  ADD COLUMN dead_lettered_at TIMESTAMP(6) NULL AFTER last_error_message,
  ADD CONSTRAINT fk_m284_dispatch_credential
    FOREIGN KEY (claimed_by_credential_id) REFERENCES api_credentials(id),
  ADD CONSTRAINT fk_m284_dispatch_identity
    FOREIGN KEY (claimed_by_identity_id) REFERENCES identities(id),
  ADD INDEX idx_m284_dispatch_claimable (status,next_attempt_at,lease_expires_at,created_at),
  ADD INDEX idx_m284_dispatch_actor (claimed_by_credential_id,status,created_at);

CREATE TABLE trigger_dispatch_events (
  id CHAR(36) PRIMARY KEY,
  trigger_dispatch_id CHAR(36) NOT NULL,
  trigger_fire_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_credential_id CHAR(36) NULL,
  actor_identity_id CHAR(36) NULL,
  attempt_no INT NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m284_dispatch_event_dispatch
    FOREIGN KEY (trigger_dispatch_id) REFERENCES trigger_dispatches(id),
  CONSTRAINT fk_m284_dispatch_event_fire
    FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  CONSTRAINT fk_m284_dispatch_event_credential
    FOREIGN KEY (actor_credential_id) REFERENCES api_credentials(id),
  CONSTRAINT fk_m284_dispatch_event_identity
    FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  INDEX idx_m284_dispatch_event_dispatch (trigger_dispatch_id,created_at),
  INDEX idx_m284_dispatch_event_fire (trigger_fire_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
