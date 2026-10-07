-- AI Native Runtime V3.0 M30.4 Platform Retention / Backup / Restore
-- Migration: 072_m30_retention_backup_restore.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_RETENTION_POLICY','平台保留策略','M30_OPERATIONS',1020,'定义 Runtime / Evidence / Config 等平台数据的保留、归档与删除边界'),
  ('M30_BACKUP_SNAPSHOT','备份快照','M30_OPERATIONS',1030,'记录外部备份事实、精确 Runtime、Manifest 校验和与验证状态，不在数据库内保存备份数据'),
  ('M30_RESTORE_REHEARSAL','恢复演练','M30_OPERATIONS',1040,'将已验证 Backup Snapshot 恢复到非生产环境并记录健康/Smoke 回执'),
  ('M30_RETENTION_BACKUP_GATE','保留 / 备份 / 恢复门禁','M30_OPERATIONS',1050,'验证保留策略、可校验备份与非生产恢复演练；生产恢复禁止 CI 合成执行')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-RETENTION-BACKUP','保留 / 备份 / 恢复门禁','ACTIVE'),
  ('M30_BACKUP_STATUS','VERIFIED','备份已验证','ACTIVE'),
  ('M30_RESTORE_STATUS','PASS','恢复演练通过','ACTIVE'),
  ('M30_RETENTION_SCOPE','RUNTIME_DATA','运行数据','ACTIVE'),
  ('M30_RETENTION_SCOPE','EVIDENCE','证据数据','ACTIVE'),
  ('M30_RETENTION_SCOPE','CONFIG','配置数据','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS platform_retention_policies (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  policy_key VARCHAR(180) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  retention_days INT NOT NULL,
  backup_retention_days INT NOT NULL,
  legal_hold_supported BOOLEAN NOT NULL DEFAULT TRUE,
  deletion_mode VARCHAR(32) NOT NULL DEFAULT 'POLICY_CONTROLLED',
  policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m304_retention_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m304_retention_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m304_retention_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m304_retention_key (workspace_id,policy_key),
  INDEX idx_m304_retention_scope (workspace_id,scope_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_backup_snapshots (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  retention_policy_id CHAR(36) NOT NULL,
  environment_id CHAR(36) NOT NULL,
  backup_key VARCHAR(200) NOT NULL,
  backup_type VARCHAR(32) NOT NULL,
  exact_runtime_sha CHAR(40) NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  storage_ref VARCHAR(1024) NOT NULL,
  backup_scope_json JSON NOT NULL,
  verification_json JSON NOT NULL,
  verification_status VARCHAR(16) NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m304_backup_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m304_backup_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m304_backup_policy FOREIGN KEY (retention_policy_id) REFERENCES platform_retention_policies(id),
  CONSTRAINT fk_m304_backup_environment FOREIGN KEY (environment_id) REFERENCES platform_environments(id),
  CONSTRAINT fk_m304_backup_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m304_backup_key (workspace_id,backup_key),
  INDEX idx_m304_backup_verified (workspace_id,verification_status,captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_restore_rehearsals (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  backup_snapshot_id CHAR(36) NOT NULL,
  target_environment_id CHAR(36) NOT NULL,
  rehearsal_key VARCHAR(200) NOT NULL,
  execution_mode VARCHAR(24) NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  restore_receipt_json JSON NOT NULL,
  verification_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  started_at TIMESTAMP(6) NOT NULL,
  completed_at TIMESTAMP(6) NOT NULL,
  evidence_json JSON NOT NULL,
  executed_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m304_restore_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m304_restore_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m304_restore_backup FOREIGN KEY (backup_snapshot_id) REFERENCES platform_backup_snapshots(id),
  CONSTRAINT fk_m304_restore_environment FOREIGN KEY (target_environment_id) REFERENCES platform_environments(id),
  CONSTRAINT fk_m304_restore_identity FOREIGN KEY (executed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m304_restore_key (workspace_id,rehearsal_key),
  INDEX idx_m304_restore_status (workspace_id,status,completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m30_retention_backup_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m304_gate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m304_gate_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
