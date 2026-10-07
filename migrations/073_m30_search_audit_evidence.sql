-- AI Native Runtime V3.0 M30.5 Global Search / Audit Evidence Aggregate
-- Migration: 073_m30_search_audit_evidence.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_GLOBAL_SEARCH','全局搜索','M30_OPERATIONS',1060,'在 Workspace 权限边界内跨 Project / Governance / AIGC Asset / Environment / Connection / Release / Incident / Backup 搜索；不复制事实源'),
  ('M30_AUDIT_EVIDENCE_VIEW','审计 / 证据聚合','M30_OPERATIONS',1070,'只读聚合 Runtime Audit、Authorization、Activity、Approval、Gate、QA、Health、Incident 与 Operations Gate 证据'),
  ('M30_SEARCH_AUDIT_GATE','全局搜索 / 审计证据门禁','M30_OPERATIONS',1080,'验证 Workspace 隔离、跨对象搜索与多事实源审计证据可追溯')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-SEARCH-AUDIT','全局搜索 / 审计证据门禁','ACTIVE'),
  ('M30_SEARCH_TYPE','PROJECT','项目','ACTIVE'),
  ('M30_SEARCH_TYPE','MILESTONE','里程碑','ACTIVE'),
  ('M30_SEARCH_TYPE','WORK_ITEM','工作项','ACTIVE'),
  ('M30_SEARCH_TYPE','ASSET','AIGC 资产','ACTIVE'),
  ('M30_SEARCH_TYPE','ENVIRONMENT','环境','ACTIVE'),
  ('M30_SEARCH_TYPE','CONNECTION','连接','ACTIVE'),
  ('M30_SEARCH_TYPE','RELEASE','发布候选','ACTIVE'),
  ('M30_SEARCH_TYPE','INCIDENT','事故','ACTIVE'),
  ('M30_SEARCH_TYPE','BACKUP','备份','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

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
