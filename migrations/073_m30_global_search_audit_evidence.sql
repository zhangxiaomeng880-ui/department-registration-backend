-- AI Native Runtime V3.0 M30.5 Global Search / Audit Evidence
-- Migration: 073_m30_global_search_audit_evidence.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_GLOBAL_SEARCH','全局搜索','M30_OPERATIONS',1060,'Workspace 范围内统一检索 Project / Milestone / Work Item / Knowledge / Capability / Environment / Connection / Incident / Release / Backup'),
  ('M30_AUDIT_EVIDENCE','审计 / 证据中心','M30_OPERATIONS',1070,'标准化索引既有授权、审批、Runtime Audit、Gate/QA、Health、Incident、Release、Backup/Restore 事实；原表仍是 Source-of-Truth'),
  ('M30_SEARCH_AUDIT_GATE','搜索 / 审计证据门禁','M30_OPERATIONS',1080,'验证搜索覆盖、Workspace 隔离、审计来源覆盖与证据哈希完整性')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-SEARCH-AUDIT','全局搜索 / 审计证据门禁','ACTIVE'),
  ('M30_SEARCH_TYPE','PROJECT','项目','ACTIVE'),
  ('M30_SEARCH_TYPE','MILESTONE','里程碑','ACTIVE'),
  ('M30_SEARCH_TYPE','WORK_ITEM','工作项','ACTIVE'),
  ('M30_SEARCH_TYPE','KNOWLEDGE','知识来源','ACTIVE'),
  ('M30_SEARCH_TYPE','CAPABILITY','能力','ACTIVE'),
  ('M30_SEARCH_TYPE','ENVIRONMENT','环境','ACTIVE'),
  ('M30_SEARCH_TYPE','CONNECTION','连接','ACTIVE'),
  ('M30_SEARCH_TYPE','INCIDENT','事故','ACTIVE'),
  ('M30_SEARCH_TYPE','RELEASE_CANDIDATE','发布候选','ACTIVE'),
  ('M30_SEARCH_TYPE','BACKUP','备份','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS platform_search_documents (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(320) NOT NULL,
  object_key VARCHAR(320) NULL,
  title VARCHAR(512) NOT NULL,
  subtitle TEXT NULL,
  search_text TEXT NOT NULL,
  status VARCHAR(32) NULL,
  metadata_json JSON NOT NULL,
  source_updated_at DATETIME(6) NULL,
  indexed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m305_search_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m305_search_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m305_search_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m305_search_object (workspace_id,object_type,object_id),
  INDEX idx_m305_search_type (workspace_id,object_type,status,indexed_at),
  INDEX idx_m305_search_project (workspace_id,project_id,object_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_audit_evidence_index (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(320) NOT NULL,
  category VARCHAR(64) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  actor_ref VARCHAR(320) NULL,
  object_type VARCHAR(64) NULL,
  object_id VARCHAR(320) NULL,
  status VARCHAR(32) NULL,
  occurred_at DATETIME(6) NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL,
  evidence_json JSON NOT NULL,
  indexed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m305_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m305_audit_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m305_audit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m305_audit_source (workspace_id,source_type,source_id),
  INDEX idx_m305_audit_category (workspace_id,category,occurred_at),
  INDEX idx_m305_audit_project (workspace_id,project_id,occurred_at),
  INDEX idx_m305_audit_status (workspace_id,status,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m30_search_audit_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m305_gate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m305_gate_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
