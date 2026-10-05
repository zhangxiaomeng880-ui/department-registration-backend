-- AI Native Runtime V2.4 M24.4 Staging compatibility
-- Migration: 022_shadow_eval_schema_compatibility.sql
-- Converges the short-lived 021 draft that persisted source_input_sha256
-- to the final metadata-only Shadow Eval control-plane schema.
-- Fresh environments created by the final 021 are already compatible.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @has_legacy_source_input_sha := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'eval_shadow_replays'
    AND column_name = 'source_input_sha256'
);
SET @sql := IF(
  @has_legacy_source_input_sha > 0,
  'ALTER TABLE eval_shadow_replays DROP COLUMN source_input_sha256',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_billing_class := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'usage_ledger'
    AND column_name = 'billing_class'
);
SET @sql := IF(
  @has_billing_class = 0,
  'ALTER TABLE usage_ledger ADD COLUMN billing_class VARCHAR(32) NOT NULL DEFAULT ''CUSTOMER'' AFTER cost_currency',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_billing_class_index := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'usage_ledger'
    AND index_name = 'idx_usage_billing_class_period'
);
SET @sql := IF(
  @has_billing_class_index = 0,
  'ALTER TABLE usage_ledger ADD INDEX idx_usage_billing_class_period (billing_class,recorded_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE usage_ledger u
JOIN runs r ON r.id=u.run_id
SET u.billing_class='INTERNAL_EVAL'
WHERE r.run_type IN ('EVAL_REPLAY','SHADOW_REPLAY')
   OR r.trigger_source IN ('EVAL_RUNNER','SHADOW_EVAL');
