-- AI Native Runtime V3.0 M30.2 Platform Release Promotion / Rollback
-- Migration: 070_m30_release_promotion_rollback.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_RELEASE_CANDIDATE','平台发布候选','M30_OPERATIONS',940,'冻结 exact Runtime / Artifact / Migration fingerprint，作为环境晋级唯一候选事实'),
  ('M30_RELEASE_PROMOTION','环境晋级','M30_OPERATIONS',950,'以精确候选版本在 Environment 之间晋级并保存外部部署回执'),
  ('M30_RELEASE_ROLLBACK','环境回滚','M30_OPERATIONS',960,'绑定已晋级版本、明确回滚目标版本并保存恢复回执'),
  ('M30_RELEASE_ROLLBACK_GATE','发布晋级 / 回滚门禁','M30_OPERATIONS',970,'验证非生产晋级与回滚可执行，生产晋级/回滚必须 Human Gate')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-RELEASE-ROLLBACK','环境 / 发布晋级 / 回滚门禁','ACTIVE'),
  ('M30_RELEASE_STATUS','FROZEN','候选已冻结','ACTIVE'),
  ('M30_RELEASE_STATUS','PENDING_APPROVAL','等待人工批准','ACTIVE'),
  ('M30_RELEASE_STATUS','PROMOTED','已晋级','ACTIVE'),
  ('M30_RELEASE_STATUS','ROLLED_BACK','已回滚','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS platform_release_candidates (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  candidate_key VARCHAR(160) NOT NULL,
  source_environment_id CHAR(36) NOT NULL,
  release_type VARCHAR(32) NOT NULL DEFAULT 'RUNTIME',
  version_label VARCHAR(160) NOT NULL,
  exact_runtime_sha CHAR(40) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  migration_fingerprint VARCHAR(255) NOT NULL,
  source_evidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  frozen_at TIMESTAMP(6) NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m302_candidate_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m302_candidate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m302_candidate_source_env FOREIGN KEY (source_environment_id) REFERENCES platform_environments(id),
  CONSTRAINT fk_m302_candidate_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m302_candidate_key (workspace_id,candidate_key),
  INDEX idx_m302_candidate_sha (workspace_id,exact_runtime_sha,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_release_promotions (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  source_environment_id CHAR(36) NOT NULL,
  target_environment_id CHAR(36) NOT NULL,
  promotion_key VARCHAR(180) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  approval_request_id CHAR(36) NULL,
  rollback_runtime_sha CHAR(40) NOT NULL,
  status VARCHAR(24) NOT NULL,
  execution_mode VARCHAR(24) NULL,
  execution_receipt_json JSON NULL,
  requested_by_identity_id CHAR(36) NULL,
  promoted_by_identity_id CHAR(36) NULL,
  requested_at TIMESTAMP(6) NOT NULL,
  promoted_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m302_promotion_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m302_promotion_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m302_promotion_candidate FOREIGN KEY (candidate_id) REFERENCES platform_release_candidates(id),
  CONSTRAINT fk_m302_promotion_source_env FOREIGN KEY (source_environment_id) REFERENCES platform_environments(id),
  CONSTRAINT fk_m302_promotion_target_env FOREIGN KEY (target_environment_id) REFERENCES platform_environments(id),
  CONSTRAINT fk_m302_promotion_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  CONSTRAINT fk_m302_promotion_requested_by FOREIGN KEY (requested_by_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m302_promotion_promoted_by FOREIGN KEY (promoted_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m302_promotion_key (workspace_id,promotion_key),
  INDEX idx_m302_promotion_status (workspace_id,target_environment_id,status,requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_rollback_requests (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  promotion_id CHAR(36) NOT NULL,
  rollback_key VARCHAR(180) NOT NULL,
  rollback_runtime_sha CHAR(40) NOT NULL,
  approval_request_id CHAR(36) NULL,
  risk_level VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL,
  execution_mode VARCHAR(24) NULL,
  execution_receipt_json JSON NULL,
  requested_by_identity_id CHAR(36) NULL,
  completed_by_identity_id CHAR(36) NULL,
  requested_at TIMESTAMP(6) NOT NULL,
  completed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m302_rollback_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m302_rollback_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m302_rollback_promotion FOREIGN KEY (promotion_id) REFERENCES platform_release_promotions(id),
  CONSTRAINT fk_m302_rollback_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  CONSTRAINT fk_m302_rollback_requested_by FOREIGN KEY (requested_by_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m302_rollback_completed_by FOREIGN KEY (completed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m302_rollback_key (workspace_id,rollback_key),
  UNIQUE KEY uq_m302_rollback_promotion (promotion_id),
  INDEX idx_m302_rollback_status (workspace_id,status,requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m30_release_rollback_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m302_gate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m302_gate_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
