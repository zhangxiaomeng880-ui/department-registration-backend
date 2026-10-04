-- AI Native Runtime V2.2 M22.4 Tenant Identity / Membership / RBAC / Scoped Credentials
-- Migration: 010_identity_rbac_scoped_credentials.sql
-- Scoped credentials are stored as hashes only. Platform RUNTIME_API_TOKEN remains a compatibility admin path.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS identities (
  id CHAR(36) PRIMARY KEY,
  identity_key VARCHAR(190) NOT NULL UNIQUE,
  identity_type VARCHAR(32) NOT NULL DEFAULT 'SERVICE',
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_identity_type_status (identity_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS roles (
  role_key VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  system_role BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_role_scope_status (scope_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key VARCHAR(128) NOT NULL,
  permission_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_key,permission_key),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_key) REFERENCES roles(role_key),
  INDEX idx_permission_role (permission_key,role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  identity_id CHAR(36) NOT NULL,
  role_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_tenant_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_tenant_member_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_tenant_member_role FOREIGN KEY (role_key) REFERENCES roles(role_key),
  UNIQUE KEY uq_tenant_identity (tenant_id,identity_id),
  INDEX idx_tenant_member_identity_status (identity_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  identity_id CHAR(36) NOT NULL,
  role_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_workspace_member_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_workspace_member_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_workspace_member_role FOREIGN KEY (role_key) REFERENCES roles(role_key),
  UNIQUE KEY uq_workspace_identity (workspace_id,identity_id),
  INDEX idx_workspace_member_identity_status (identity_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_credentials (
  id CHAR(36) PRIMARY KEY,
  identity_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NULL,
  credential_prefix VARCHAR(32) NOT NULL UNIQUE,
  secret_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMP(6) NULL,
  last_used_at TIMESTAMP(6) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_credential_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_credential_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_credential_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_credential_identity_status (identity_id,status),
  INDEX idx_credential_tenant_workspace (tenant_id,workspace_id,status),
  INDEX idx_credential_expiry (status,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_credential_scopes (
  credential_id CHAR(36) NOT NULL,
  permission_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (credential_id,permission_key),
  CONSTRAINT fk_credential_scope_credential FOREIGN KEY (credential_id) REFERENCES api_credentials(id),
  INDEX idx_credential_scope_permission (permission_key,credential_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS runtime_authz_decisions (
  id CHAR(36) PRIMARY KEY,
  credential_id CHAR(36) NULL,
  identity_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  permission_key VARCHAR(128) NULL,
  resource_type VARCHAR(64) NULL,
  resource_id VARCHAR(128) NULL,
  decision VARCHAR(16) NOT NULL,
  reason_code VARCHAR(128) NULL,
  method VARCHAR(16) NOT NULL,
  route_pattern VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_authz_credential FOREIGN KEY (credential_id) REFERENCES api_credentials(id),
  CONSTRAINT fk_authz_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_authz_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_authz_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_authz_identity_created (identity_id,created_at),
  INDEX idx_authz_tenant_created (tenant_id,created_at),
  INDEX idx_authz_decision_created (decision,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO roles (role_key,name,scope_type,status,system_role) VALUES
  ('TENANT_OWNER','Tenant Owner','TENANT','ACTIVE',TRUE),
  ('TENANT_OPERATOR','Tenant Operator','TENANT','ACTIVE',TRUE),
  ('TENANT_VIEWER','Tenant Viewer','TENANT','ACTIVE',TRUE),
  ('WORKSPACE_OPERATOR','Workspace Operator','WORKSPACE','ACTIVE',TRUE),
  ('WORKSPACE_VIEWER','Workspace Viewer','WORKSPACE','ACTIVE',TRUE);

INSERT IGNORE INTO role_permissions (role_key,permission_key) VALUES
  ('TENANT_OWNER','project.write'),
  ('TENANT_OWNER','run.execute'),
  ('TENANT_OWNER','run.read'),
  ('TENANT_OWNER','usage.read'),
  ('TENANT_OWNER','policy.manage'),
  ('TENANT_OWNER','member.manage'),
  ('TENANT_OWNER','credential.manage'),
  ('TENANT_OPERATOR','project.write'),
  ('TENANT_OPERATOR','run.execute'),
  ('TENANT_OPERATOR','run.read'),
  ('TENANT_OPERATOR','usage.read'),
  ('TENANT_VIEWER','run.read'),
  ('TENANT_VIEWER','usage.read'),
  ('WORKSPACE_OPERATOR','project.write'),
  ('WORKSPACE_OPERATOR','run.execute'),
  ('WORKSPACE_OPERATOR','run.read'),
  ('WORKSPACE_OPERATOR','usage.read'),
  ('WORKSPACE_VIEWER','run.read'),
  ('WORKSPACE_VIEWER','usage.read');
