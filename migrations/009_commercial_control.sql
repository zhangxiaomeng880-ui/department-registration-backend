-- AI Native Runtime V2.2 M22.3 Plan / Entitlement + Rate Limit / Usage Reservation
-- Migration: 009_commercial_control.sql
-- Existing tenant plan keys are imported as compatible plans before fail-closed entitlement enforcement.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS plans (
  plan_key VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_plans_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO plans (plan_key,name,status,metadata_json)
VALUES (
  'LEGACY',
  'Legacy Compatibility Plan',
  'ACTIVE',
  JSON_OBJECT('system', TRUE, 'migration', '009_commercial_control')
);

INSERT IGNORE INTO plans (plan_key,name,status,metadata_json)
SELECT DISTINCT
  plan_key,
  CONCAT('Imported Plan ', plan_key),
  'ACTIVE',
  JSON_OBJECT('imported', TRUE, 'migration', '009_commercial_control')
FROM tenants
WHERE plan_key IS NOT NULL AND plan_key <> '';

UPDATE tenants
SET plan_key='LEGACY'
WHERE plan_key IS NULL OR plan_key='';

ALTER TABLE tenants
  MODIFY COLUMN plan_key VARCHAR(128) NOT NULL DEFAULT 'LEGACY',
  ADD CONSTRAINT fk_tenant_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  ADD INDEX idx_tenant_plan_status (plan_key,status);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  id CHAR(36) PRIMARY KEY,
  plan_key VARCHAR(128) NOT NULL,
  entitlement_key VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_entitlement_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  UNIQUE KEY uq_plan_entitlement (plan_key,entitlement_key),
  INDEX idx_entitlement_plan_enabled (plan_key,enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO plan_entitlements (id,plan_key,entitlement_key,enabled,config_json)
SELECT
  UUID(),
  plan_key,
  'MODEL_EXECUTION',
  TRUE,
  JSON_OBJECT('migrationCompatibility', TRUE)
FROM plans;

CREATE TABLE IF NOT EXISTS entitlement_evaluations (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  entitlement_key VARCHAR(128) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  reason_code VARCHAR(128) NULL,
  config_snapshot_json JSON NULL,
  evaluated_by VARCHAR(128) NOT NULL DEFAULT 'RUNTIME',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_ent_eval_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_ent_eval_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_ent_eval_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_ent_eval_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  INDEX idx_ent_eval_run_created (run_id,created_at),
  INDEX idx_ent_eval_tenant_created (tenant_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rate_limit_policies (
  id CHAR(36) PRIMARY KEY,
  scope_type VARCHAR(16) NOT NULL,
  plan_key VARCHAR(128) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  scope_guard VARCHAR(180)
    GENERATED ALWAYS AS (
      CASE
        WHEN scope_type='PLAN' THEN CONCAT('PLAN:',plan_key)
        WHEN scope_type='TENANT' THEN CONCAT('TENANT:',tenant_id)
        WHEN scope_type='WORKSPACE' THEN CONCAT('WORKSPACE:',workspace_id)
        ELSE NULL
      END
    ) STORED,
  policy_key VARCHAR(128) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  window_seconds INT UNSIGNED NOT NULL,
  max_requests BIGINT UNSIGNED NOT NULL,
  action_on_exceed VARCHAR(16) NOT NULL DEFAULT 'BLOCK',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_rate_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  CONSTRAINT fk_rate_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_rate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE KEY uq_rate_scope_policy (scope_guard,policy_key),
  INDEX idx_rate_operation_enabled (operation_key,enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  policy_id CHAR(36) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  used_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (policy_id,window_start),
  CONSTRAINT fk_rate_bucket_policy FOREIGN KEY (policy_id) REFERENCES rate_limit_policies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rate_limit_decisions (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  policy_id CHAR(36) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  used_before BIGINT UNSIGNED NOT NULL,
  max_requests BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(128) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_rate_decision_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_rate_decision_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_rate_decision_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_rate_decision_policy FOREIGN KEY (policy_id) REFERENCES rate_limit_policies(id),
  INDEX idx_rate_decision_run_created (run_id,created_at),
  INDEX idx_rate_decision_scope_created (tenant_id,workspace_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS usage_reservations (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  entitlement_key VARCHAR(128) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  currency CHAR(3) NULL,
  reserved_amount DECIMAL(30,10) NOT NULL,
  actual_amount DECIMAL(30,10) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
  expires_at TIMESTAMP(6) NOT NULL,
  committed_tool_execution_id CHAR(36) NULL,
  reason_code VARCHAR(128) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_reservation_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_reservation_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_reservation_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_reservation_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_reservation_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  CONSTRAINT fk_reservation_tool FOREIGN KEY (committed_tool_execution_id) REFERENCES tool_executions(id),
  INDEX idx_reservation_run_status (run_id,status,created_at),
  INDEX idx_reservation_tenant_metric (tenant_id,metric_key,status,created_at),
  INDEX idx_reservation_workspace_metric (workspace_id,metric_key,status,created_at),
  INDEX idx_reservation_expiry (status,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
