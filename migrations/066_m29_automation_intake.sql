-- AI Native Runtime V2.9 M29.3 Automation Intake / Scheduler / Event / Webhook
-- Migration: 066_m29_automation_intake.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_AUTOMATION_INTAKE','自动化入口','M29_AUTOMATION',770,'将 Scheduler / Event / Webhook 统一归一化为可审计 Intake，再复用 Trigger Runtime'),
  ('M29_SCHEDULER_TICK','调度扫描','M29_AUTOMATION',780,'按 Trigger Registry 的时区与 Cron 合同扫描到期计划，不复制 Trigger 执行能力'),
  ('M29_WEBHOOK_INTAKE','Webhook 入口','M29_AUTOMATION',790,'只接收上游已验证的结构化 Webhook 事件，不保存密钥、令牌或原始签名')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-AUTOMATION','自动化入口 / 调度 / Webhook 门禁','ACTIVE'),
  ('M29_INTAKE_TYPE','SCHEDULE','定时调度','ACTIVE'),
  ('M29_INTAKE_TYPE','EVENT','事件触发','ACTIVE'),
  ('M29_INTAKE_TYPE','WEBHOOK','Webhook 触发','ACTIVE'),
  ('M29_INTAKE_STATUS','RECEIVED','已接收','ACTIVE'),
  ('M29_INTAKE_STATUS','FIRED','已触发','ACTIVE'),
  ('M29_INTAKE_STATUS','FAILED','触发失败','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_automation_intakes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  trigger_id CHAR(36) NOT NULL,
  intake_key VARCHAR(512) NOT NULL,
  intake_type VARCHAR(24) NOT NULL,
  source_ref_json JSON NOT NULL,
  event_id VARCHAR(320) NULL,
  scheduled_fire_time TIMESTAMP(6) NULL,
  occurred_at TIMESTAMP(6) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  payload_meta_json JSON NOT NULL,
  verification_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'RECEIVED',
  trigger_fire_id CHAR(36) NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m293_intake_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m293_intake_trigger FOREIGN KEY (trigger_id) REFERENCES trigger_registry(trigger_id),
  CONSTRAINT fk_m293_intake_fire FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  CONSTRAINT fk_m293_intake_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m293_intake_key (project_id,trigger_id,intake_key),
  INDEX idx_m293_intake_status (project_id,intake_type,status,occurred_at),
  INDEX idx_m293_intake_fire (trigger_fire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_automation_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m293_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m293_gate_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
