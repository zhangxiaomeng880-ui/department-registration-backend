-- AI Native Runtime V2.2 Production Rollback Compatibility
-- Migration: 012_v21_rollback_compatibility.sql
-- Purpose: keep the V2.1 write shape operational after M22.2 makes tenant/workspace scope mandatory.
-- New V2.2 writes remain scoped explicitly; legacy project writes default to the legacy scope.
-- Run/usage scope is always derived from the referenced project to prevent cross-scope drift.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE projects
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000101',
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000102';

ALTER TABLE runs
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000101',
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000102';

ALTER TABLE usage_ledger
  MODIFY COLUMN tenant_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000101',
  MODIFY COLUMN workspace_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000102';

DROP TRIGGER IF EXISTS trg_runs_scope_from_project;
CREATE TRIGGER trg_runs_scope_from_project
BEFORE INSERT ON runs
FOR EACH ROW
SET
  NEW.tenant_id = (SELECT tenant_id FROM projects WHERE id = NEW.project_id),
  NEW.workspace_id = (SELECT workspace_id FROM projects WHERE id = NEW.project_id);

DROP TRIGGER IF EXISTS trg_usage_scope_from_project;
CREATE TRIGGER trg_usage_scope_from_project
BEFORE INSERT ON usage_ledger
FOR EACH ROW
SET
  NEW.tenant_id = (SELECT tenant_id FROM projects WHERE id = NEW.project_id),
  NEW.workspace_id = (SELECT workspace_id FROM projects WHERE id = NEW.project_id);
