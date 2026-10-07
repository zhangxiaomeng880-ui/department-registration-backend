-- AI Native Runtime V3.0 M30.3 Platform Alert / Incident
-- Migration: 071_m30_alert_incident.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M30_ALERT_RULE','告警规则','M30_OPERATIONS',980,'复用 Runtime / Provider / Environment / Connection 事实源生成可去重告警'),
  ('M30_ALERT_EVENT','告警事件','M30_OPERATIONS',990,'告警必须绑定真实来源事实与时间，不以主观状态替代'),
  ('M30_INCIDENT','事故管理','M30_OPERATIONS',1000,'从告警创建 Incident，记录确认、恢复与解决证据'),
  ('M30_ALERT_INCIDENT_GATE','告警 / 事故门禁','M30_OPERATIONS',1010,'验证检测→告警→事故→恢复→解决闭环')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M30-ALERT-INCIDENT','告警 / 事故管理门禁','ACTIVE'),
  ('M30_ALERT_SEVERITY','INFO','提示','ACTIVE'),
  ('M30_ALERT_SEVERITY','WARNING','警告','ACTIVE'),
  ('M30_ALERT_SEVERITY','CRITICAL','严重','ACTIVE'),
  ('M30_INCIDENT_STATUS','OPEN','处理中','ACTIVE'),
  ('M30_INCIDENT_STATUS','ACKNOWLEDGED','已确认','ACTIVE'),
  ('M30_INCIDENT_STATUS','RESOLVED','已解决','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS platform_alert_rules (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  rule_key VARCHAR(180) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  condition_json JSON NOT NULL,
  dedupe_window_seconds INT NOT NULL DEFAULT 3600,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m303_rule_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m303_rule_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m303_rule_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m303_rule_key (workspace_id,rule_key),
  INDEX idx_m303_rule_source (workspace_id,source_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_alert_events (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  alert_rule_id CHAR(36) NOT NULL,
  alert_key VARCHAR(320) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_fact_type VARCHAR(64) NOT NULL,
  source_fact_id VARCHAR(191) NOT NULL,
  subject_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  title VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  detected_at TIMESTAMP(6) NOT NULL,
  resolved_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m303_alert_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m303_alert_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m303_alert_rule FOREIGN KEY (alert_rule_id) REFERENCES platform_alert_rules(id),
  UNIQUE KEY uq_m303_alert_source (alert_rule_id,source_fact_type,source_fact_id),
  UNIQUE KEY uq_m303_alert_key (workspace_id,alert_key),
  INDEX idx_m303_alert_status (workspace_id,status,severity,detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_incidents (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  incident_key VARCHAR(180) NOT NULL,
  primary_alert_id CHAR(36) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  owner_identity_id CHAR(36) NULL,
  root_cause_json JSON NULL,
  resolution_json JSON NULL,
  evidence_json JSON NOT NULL,
  opened_at TIMESTAMP(6) NOT NULL,
  acknowledged_at TIMESTAMP(6) NULL,
  resolved_at TIMESTAMP(6) NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m303_incident_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m303_incident_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m303_incident_alert FOREIGN KEY (primary_alert_id) REFERENCES platform_alert_events(id),
  CONSTRAINT fk_m303_incident_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m303_incident_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m303_incident_key (workspace_id,incident_key),
  UNIQUE KEY uq_m303_incident_primary_alert (primary_alert_id),
  INDEX idx_m303_incident_status (workspace_id,status,severity,opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_incident_events (
  id CHAR(36) PRIMARY KEY,
  incident_id CHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NULL,
  payload_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  actor_identity_id CHAR(36) NULL,
  occurred_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m303_incident_event_incident FOREIGN KEY (incident_id) REFERENCES platform_incidents(id),
  CONSTRAINT fk_m303_incident_event_actor FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  INDEX idx_m303_incident_event_time (incident_id,occurred_at,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m30_alert_incident_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m303_gate_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  INDEX idx_m303_gate_latest (workspace_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
