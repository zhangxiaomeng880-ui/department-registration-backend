-- AI Native Runtime V2.2 M22.2 Tenant / Workspace + Quota / Usage Meter
-- Migration: 008_tenant_workspace_quota_meter.sql
-- Existing projects are backfilled into a legacy SaaS scope for backward compatibility.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) PRIMARY KEY,
  tenant_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  plan_key VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_tenants_status_plan (status, plan_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workspaces (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_workspace_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE KEY uq_workspace_tenant_key (tenant_id, workspace_key),
  INDEX idx_workspace_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO tenants (id, tenant_key, name, plan_key, status, metadata_json)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'legacy-runtime',
  'Legacy Runtime Tenant',
  'LEGACY',
  'ACTIVE',
  JSON_OBJECT('system', TRUE, 'migration', '008_tenant_workspace_quota_meter')
);

INSERT IGNORE INTO workspaces (id, tenant_id, workspace_key, name, status, metadata_json)
VALUES (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  'legacy-runtime',
  'Legacy Runtime Workspace',
  'ACTIVE',
  JSON_OBJECT('system', TRUE, 'migration', '008_tenant_workspace_quota_meter')
);

ALTER TABLE projects
  ADD COLUMN tenant_id CHAR(36) NULL AFTER id,
  ADD COLUMN workspace_id CHAR(36) NULL AFTER tenant_id;

UPDATE projects
SET tenant_id='00000000-0000-4000-8000-000000000101',
    workspace_id='00000000-0000-4000-8000-000000000102'
WHERE tenant_id IS NULL OR workspace_id IS NULL;

ALTER TABLE projects
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL,
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_project_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  ADD CONSTRAINT fk_project_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  ADD INDEX idx_project_tenant_workspace (tenant_id, workspace_id, status);

ALTER TABLE runs
  ADD COLUMN tenant_id CHAR(36) NULL AFTER id,
  ADD COLUMN workspace_id CHAR(36) NULL AFTER tenant_id;

UPDATE runs r
JOIN projects p ON p.id=r.project_id
SET r.tenant_id=p.tenant_id,
    r.workspace_id=p.workspace_id
WHERE r.tenant_id IS NULL OR r.workspace_id IS NULL;

ALTER TABLE runs
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL,
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_run_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  ADD CONSTRAINT fk_run_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  ADD INDEX idx_run_tenant_workspace_created (tenant_id, workspace_id, created_at);

ALTER TABLE usage_ledger
  ADD COLUMN tenant_id CHAR(36) NULL AFTER id,
  ADD COLUMN workspace_id CHAR(36) NULL AFTER tenant_id;

UPDATE usage_ledger u
JOIN projects p ON p.id=u.project_id
SET u.tenant_id=p.tenant_id,
    u.workspace_id=p.workspace_id
WHERE u.tenant_id IS NULL OR u.workspace_id IS NULL;

ALTER TABLE usage_ledger
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL,
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_usage_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  ADD CONSTRAINT fk_usage_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  ADD INDEX idx_usage_tenant_period (tenant_id, recorded_at),
  ADD INDEX idx_usage_workspace_period (workspace_id, recorded_at);

CREATE TABLE IF NOT EXISTS quota_policies (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  subject_type VARCHAR(16) NOT NULL,
  subject_id CHAR(36) NOT NULL,
  policy_key VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metric_key VARCHAR(64) NOT NULL,
  period_type VARCHAR(16) NOT NULL DEFAULT 'MONTH',
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  soft_limit DECIMAL(30,10) NULL,
  hard_limit DECIMAL(30,10) NULL,
  action_on_soft VARCHAR(16) NOT NULL DEFAULT 'HOLD',
  action_on_hard VARCHAR(16) NOT NULL DEFAULT 'BLOCK',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_quota_policy_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE KEY uq_quota_subject_policy (subject_type, subject_id, policy_key),
  INDEX idx_quota_tenant_enabled (tenant_id, enabled),
  INDEX idx_quota_subject_enabled (subject_type, subject_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quota_evaluations (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NULL,
  run_id CHAR(36) NOT NULL,
  policy_id CHAR(36) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  period_type VARCHAR(16) NOT NULL,
  period_start TIMESTAMP(6) NOT NULL,
  period_end TIMESTAMP(6) NOT NULL,
  usage_value DECIMAL(30,10) NULL,
  soft_limit DECIMAL(30,10) NULL,
  hard_limit DECIMAL(30,10) NULL,
  reason_code VARCHAR(128) NULL,
  evaluated_by VARCHAR(128) NOT NULL DEFAULT 'RUNTIME',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_quota_eval_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_quota_eval_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_quota_eval_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_quota_eval_policy FOREIGN KEY (policy_id) REFERENCES quota_policies(id),
  INDEX idx_quota_eval_run_created (run_id, created_at),
  INDEX idx_quota_eval_workspace_created (workspace_id, created_at),
  INDEX idx_quota_eval_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
