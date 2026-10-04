-- AI Native Runtime V2.2 Production Rollback Compatibility
-- Migration: 012_v21_rollback_compatibility.sql
-- Purpose: keep the V2.1 write shape operational after M22.2 makes tenant/workspace scope mandatory.
-- Legacy V2.1 writes fall back to the legacy tenant/workspace defaults.
-- V2.2 writes continue to provide explicit tenant/workspace scope.

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
