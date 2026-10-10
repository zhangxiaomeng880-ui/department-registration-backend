-- Preserve legacy membership foreign keys while supplying current role definitions.
-- Add missing definitions only; do not change member assignments or permissions.
SET @has_legacy_roles := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema=DATABASE() AND table_name='roles'
);
SET @sql := IF(@has_legacy_roles=1,
  'INSERT IGNORE INTO roles (role_key,scope_type,name,system_role,created_at) SELECT role_key,scope_type,name,system_role,created_at FROM rbac_roles',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
