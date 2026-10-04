-- AI Native Runtime V2.4 M24.2 Staging compatibility
-- Migration: 019_eval_runner_runtime_replay_compatibility.sql
-- Converges the short-lived synthetic M24.2 draft schema to the final Runtime Replay schema.
-- Fresh environments created by 018_eval_runner.sql already satisfy these checks, so this is a no-op there.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @has_execution_project_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'eval_runs' AND column_name = 'execution_project_id'
);
SET @sql := IF(
  @has_execution_project_id = 0,
  'ALTER TABLE eval_runs ADD COLUMN execution_project_id CHAR(36) NULL AFTER replay_manifest_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_runtime_run_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'eval_case_results' AND column_name = 'runtime_run_id'
);
SET @sql := IF(
  @has_runtime_run_id = 0,
  'ALTER TABLE eval_case_results ADD COLUMN runtime_run_id CHAR(36) NULL AFTER sequence_no',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_error_code := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'eval_case_results' AND column_name = 'error_code'
);
SET @sql := IF(
  @has_error_code = 0,
  'ALTER TABLE eval_case_results ADD COLUMN error_code VARCHAR(128) NULL AFTER assertion_summary_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @route_nullable := (
  SELECT IS_NULLABLE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'eval_case_results' AND column_name = 'route_json'
  LIMIT 1
);
SET @sql := IF(
  @route_nullable = 'NO',
  'ALTER TABLE eval_case_results MODIFY COLUMN route_json JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_eval_run_project_index := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'eval_runs' AND index_name = 'idx_m242_eval_run_project'
);
SET @sql := IF(
  @has_eval_run_project_index = 0,
  'ALTER TABLE eval_runs ADD INDEX idx_m242_eval_run_project (execution_project_id,created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_eval_run_project_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'eval_runs'
    AND constraint_name = 'fk_m242_eval_run_project' AND constraint_type = 'FOREIGN KEY'
);
SET @sql := IF(
  @has_eval_run_project_fk = 0,
  'ALTER TABLE eval_runs ADD CONSTRAINT fk_m242_eval_run_project FOREIGN KEY (execution_project_id) REFERENCES projects(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_runtime_run_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'eval_case_results'
    AND constraint_name = 'fk_m242_case_result_runtime_run' AND constraint_type = 'FOREIGN KEY'
);
SET @sql := IF(
  @has_runtime_run_fk = 0,
  'ALTER TABLE eval_case_results ADD CONSTRAINT fk_m242_case_result_runtime_run FOREIGN KEY (runtime_run_id) REFERENCES runs(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
