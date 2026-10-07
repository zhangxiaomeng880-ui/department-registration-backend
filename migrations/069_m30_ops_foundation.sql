-- AI Native Runtime V3.0 M30.1 Private Workspace / Operations Foundation
-- Migration: 069_m30_ops_foundation.sql
-- Reuses existing Tenant/Workspace/RBAC, Provider Health and Runtime Observability.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_ENVIRONMENT_REGISTRY','环境注册表','M30_OPERATIONS',900,'统一记录 Private Workspace 的环境、用途、健康与外部运行引用，不复制云厂商控制面'),
  ('M30_CONNECTION_REGISTRY','连接注册表','M30_OPERATIONS',910,'统一记录 Workspace 外部连接与凭证引用；禁止持久化真实 Secret'),
  ('M30_CONNECTION_HEALTH','连接健康','M30_OPERATIONS',920,'连接与环境健康事件、原因、延迟与证据'),
  ('M30_OPERATIONS_WORKBENCH','运维工作台','M30_OPERATIONS',930,'聚合 Workspace 项目、运行、权限、Provider、Environment、Connection、Usage 与上游 Gate 状态')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-OPS-FOUNDATION','私有工作台 / 环境 / 连接健康门禁','ACTIVE'),
  ('M30_HEALTH','HEALTHY','健康','ACTIVE'),
  ('M30_HEALTH','DEGRADED','降级','ACTIVE'),
  ('M30_HEALTH','DOWN','不可用','ACTIVE'),
  ('M30_HEALTH','UNKNOWN','未知','ACTIVE'),
  ('M30_ENVIRONMENT','DEVELOPMENT','开发环境','ACTIVE'),
  ('M30_ENVIRONMENT','STAGING','预发环境','ACTIVE'),
  ('M30_ENVIRONMENT','PRODUCTION','生产环境','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS platform_environments (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  environment_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  environment_type VARCHAR(32) NOT NULL,
  release_channel VARCHAR(64) NULL,
  provider_key VARCHAR(128) NULL,
  external_ref_json JSON NOT NULL,
  health_status VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  last_health_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m301_env_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m301_env_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m301_env_provider FOREIGN KEY (provider_key) REFERENCES provider_registry(provider_key),
  UNIQUE KEY uq_m301_env_key (workspace_id,environment_key),
  INDEX idx_m301_env_type_health (workspace_id,environment_type,health_status,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_connections (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  connection_key VARCHAR(160) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  connection_type VARCHAR(64) NOT NULL,
  provider_key VARCHAR(128) NULL,
  adapter_key VARCHAR(128) NOT NULL,
  credential_ref VARCHAR(512) NOT NULL,
  endpoint_ref_json JSON NOT NULL,
  capability_scope_json JSON NOT NULL,
  health_status VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  last_health_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m301_conn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m301_conn_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m301_conn_provider FOREIGN KEY (provider_key) REFERENCES provider_registry(provider_key),
  UNIQUE KEY uq_m301_conn_key (workspace_id,connection_key),
  INDEX idx_m301_conn_type_health (workspace_id,connection_type,health_status,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_health_events (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  subject_type VARCHAR(24) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  previous_status VARCHAR(16) NULL,
  health_status VARCHAR(16) NOT NULL,
  reason_code VARCHAR(128) NULL,
  latency_ms BIGINT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  source VARCHAR(64) NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m301_health_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m301_health_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m301_health_subject (workspace_id,subject_type,subject_id,observed_at),
  INDEX idx_m301_health_status (workspace_id,health_status,observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m30_ops_foundation_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m301_gate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m301_gate_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
