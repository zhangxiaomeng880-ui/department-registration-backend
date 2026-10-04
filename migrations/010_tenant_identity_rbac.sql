-- AI Native Runtime V2.2 M22.4 Tenant Identity / Membership / RBAC + Scoped API Credentials
-- Migration: 010_tenant_identity_rbac.sql
-- Platform token remains break-glass/admin. Scoped credentials are hashed and fail-closed.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS identities (
  id CHAR(36) PRIMARY KEY,
  identity_key VARCHAR(191) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_identity_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rbac_roles (
  role_key VARCHAR(64) PRIMARY KEY,
  scope_type VARCHAR(16) NOT NULL,
  name VARCHAR(128) NOT NULL,
  system_role BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_key VARCHAR(64) NOT NULL,
  permission_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (role_key,permission_key),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_key) REFERENCES rbac_roles(role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO rbac_roles (role_key,scope_type,name) VALUES
  ('TENANT_OWNER','TENANT','Tenant Owner'),
  ('TENANT_ADMIN','TENANT','Tenant Admin'),
  ('WORKSPACE_ADMIN','WORKSPACE','Workspace Admin'),
  ('OPERATOR','WORKSPACE','Operator'),
  ('VIEWER','WORKSPACE','Viewer');

INSERT IGNORE INTO rbac_role_permissions (role_key,permission_key) VALUES
  ('TENANT_OWNER','tenant:read'),
  ('TENANT_OWNER','tenant:write'),
  ('TENANT_OWNER','workspace:read'),
  ('TENANT_OWNER','workspace:write'),
  ('TENANT_OWNER','project:read'),
  ('TENANT_OWNER','project:write'),
  ('TENANT_OWNER','run:read'),
  ('TENANT_OWNER','run:write'),
  ('TENANT_OWNER','agent:execute'),
  ('TENANT_OWNER','usage:read'),
  ('TENANT_OWNER','quota:read'),
  ('TENANT_OWNER','quota:write'),
  ('TENANT_OWNER','commercial:read'),
  ('TENANT_OWNER','commercial:write'),
  ('TENANT_OWNER','membership:read'),
  ('TENANT_OWNER','membership:write'),
  ('TENANT_OWNER','credential:read'),
  ('TENANT_OWNER','credential:write'),

  ('TENANT_ADMIN','tenant:read'),
  ('TENANT_ADMIN','workspace:read'),
  ('TENANT_ADMIN','workspace:write'),
  ('TENANT_ADMIN','project:read'),
  ('TENANT_ADMIN','project:write'),
  ('TENANT_ADMIN','run:read'),
  ('TENANT_ADMIN','run:write'),
  ('TENANT_ADMIN','agent:execute'),
  ('TENANT_ADMIN','usage:read'),
  ('TENANT_ADMIN','quota:read'),
  ('TENANT_ADMIN','quota:write'),
  ('TENANT_ADMIN','commercial:read'),
  ('TENANT_ADMIN','commercial:write'),
  ('TENANT_ADMIN','membership:read'),
  ('TENANT_ADMIN','credential:read'),
  ('TENANT_ADMIN','credential:write'),

  ('WORKSPACE_ADMIN','workspace:read'),
  ('WORKSPACE_ADMIN','workspace:write'),
  ('WORKSPACE_ADMIN','project:read'),
  ('WORKSPACE_ADMIN','project:write'),
  ('WORKSPACE_ADMIN','run:read'),
  ('WORKSPACE_ADMIN','run:write'),
  ('WORKSPACE_ADMIN','agent:execute'),
  ('WORKSPACE_ADMIN','usage:read'),
  ('WORKSPACE_ADMIN','quota:read'),
  ('WORKSPACE_ADMIN','quota:write'),
  ('WORKSPACE_ADMIN','commercial:read'),
  ('WORKSPACE_ADMIN','credential:read'),
  ('WORKSPACE_ADMIN','credential:write'),

  ('OPERATOR','workspace:read'),
  ('OPERATOR','project:read'),
  ('OPERATOR','project:write'),
  ('OPERATOR','run:read'),
  ('OPERATOR','run:write'),
  ('OPERATOR','agent:execute'),
  ('OPERATOR','usage:read'),

  ('VIEWER','workspace:read'),
  ('VIEWER','project:read'),
  ('VIEWER','run:read'),
  ('VIEWER','usage:read');

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  identity_id CHAR(36) NOT NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_tenant_membership_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_tenant_membership_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_tenant_membership_role FOREIGN KEY (role_key) REFERENCES rbac_roles(role_key),
  UNIQUE KEY uq_tenant_membership (tenant_id,identity_id),
  INDEX idx_tenant_membership_identity (identity_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  identity_id CHAR(36) NOT NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_workspace_membership_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_workspace_membership_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_workspace_membership_role FOREIGN KEY (role_key) REFERENCES rbac_roles(role_key),
  UNIQUE KEY uq_workspace_membership (workspace_id,identity_id),
  INDEX idx_workspace_membership_identity (identity_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_credentials (
  id CHAR(36) PRIMARY KEY,
  credential_prefix VARCHAR(32) NOT NULL UNIQUE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  identity_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  allowed_permissions_json JSON NULL,
  expires_at TIMESTAMP(6) NULL,
  last_used_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  revoked_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_credential_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_credential_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_credential_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_credential_identity_status (identity_id,status),
  INDEX idx_credential_tenant_workspace (tenant_id,workspace_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS authorization_decisions (
  id CHAR(36) PRIMARY KEY,
  credential_id CHAR(36) NULL,
  identity_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  method VARCHAR(16) NOT NULL,
  path VARCHAR(512) NOT NULL,
  permission_key VARCHAR(128) NULL,
  decision VARCHAR(16) NOT NULL,
  reason_code VARCHAR(128) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_authz_credential FOREIGN KEY (credential_id) REFERENCES api_credentials(id),
  CONSTRAINT fk_authz_identity FOREIGN KEY (identity_id) REFERENCES identities(id),
  CONSTRAINT fk_authz_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_authz_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_authz_identity_created (identity_id,created_at),
  INDEX idx_authz_credential_created (credential_id,created_at),
  INDEX idx_authz_scope_created (tenant_id,workspace_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
