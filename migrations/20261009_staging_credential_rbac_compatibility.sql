-- Staging compatibility repair for mixed IAM/RBAC generations.
-- Keeps existing credentials valid while making the current Runtime contract available.

SET @has_token_hash := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='token_hash'
);
SET @sql := IF(
  @has_token_hash=0,
  'ALTER TABLE api_credentials ADD COLUMN token_hash VARCHAR(255) NULL AFTER credential_prefix',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_name := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='name'
);
SET @sql := IF(
  @has_name=0,
  'ALTER TABLE api_credentials ADD COLUMN name VARCHAR(255) NULL AFTER workspace_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_allowed_permissions := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='allowed_permissions_json'
);
SET @sql := IF(
  @has_allowed_permissions=0,
  'ALTER TABLE api_credentials ADD COLUMN allowed_permissions_json JSON NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_revoked_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='revoked_at'
);
SET @sql := IF(
  @has_revoked_at=0,
  'ALTER TABLE api_credentials ADD COLUMN revoked_at TIMESTAMP(6) NULL AFTER last_used_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_secret_hash := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='secret_hash'
);
SET @secret_hash_type := (
  SELECT column_type FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials' AND column_name='secret_hash'
  LIMIT 1
);
SET @sql := IF(
  @has_secret_hash=1,
  CONCAT('ALTER TABLE api_credentials MODIFY COLUMN secret_hash ', @secret_hash_type, ' NULL'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_secret_hash=1,
  'UPDATE api_credentials SET token_hash=secret_hash WHERE token_hash IS NULL AND secret_hash IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The credential-admin Runtime reads rbac_* tables while the requirement-completion
-- migration seeds roles/role_permissions. Mirror only missing rows; do not overwrite.
INSERT IGNORE INTO rbac_roles (role_key,scope_type,name,system_role,created_at)
SELECT role_key,scope_type,name,system_role,created_at
FROM roles;

INSERT IGNORE INTO rbac_role_permissions (role_key,permission_key,created_at)
SELECT role_key,permission_key,created_at
FROM role_permissions;
