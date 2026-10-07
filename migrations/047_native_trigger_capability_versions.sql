-- AI Native Runtime V2.8 M28.3 Native Trigger + Immutable Capability Version + Novel Bridge
-- Migration: 047_native_trigger_capability_versions.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Novel Skill becomes Runtime-routable through a safe bridge adapter.
UPDATE capability_registry
SET
  routable=TRUE,
  adapter_key='novel-continuous-update-bridge',
  policy_tags_json=JSON_SET(
    COALESCE(policy_tags_json,JSON_OBJECT()),
    '$.executionMode','BRIDGE'
  ),
  metadata_json=JSON_SET(
    COALESCE(metadata_json,JSON_OBJECT()),
    '$.nativeRuntimeExecution','BRIDGE_READY',
    '$.nativeTriggerRegistry',TRUE,
    '$.bindingStatus','NATIVE_TRIGGER_SHADOW',
    '$.externalScheduler','ChatGPT Scheduled Task',
    '$.nativeLibraryTransport',FALSE,
    '$.source','M28.3'
  )
WHERE capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE';

UPDATE project_type_capability_bindings
SET constraints_json=JSON_SET(
  COALESCE(constraints_json,JSON_OBJECT()),
  '$.executionMode','BRIDGE',
  '$.nativeRuntimeExecution','BRIDGE_READY'
)
WHERE project_type_key='AIGC_CONTENT'
  AND capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE';

UPDATE agent_capability_grants
SET constraints_json=JSON_SET(
  COALESCE(constraints_json,JSON_OBJECT()),
  '$.executionMode','BRIDGE',
  '$.nativeRuntimeExecution','BRIDGE_READY'
)
WHERE agent_capability_key='AGENT:STANDARD:AIGC_CONTENT:OPERATIONS_CONTENT'
  AND child_capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE';

CREATE TABLE capability_versions (
  capability_version_id CHAR(36) PRIMARY KEY,
  capability_key VARCHAR(320) NOT NULL,
  version VARCHAR(64) NOT NULL,
  definition_sha256 CHAR(64) NOT NULL,
  input_contract_json JSON NULL,
  output_contract_json JSON NULL,
  execution_contract_json JSON NULL,
  verification_contract_json JSON NULL,
  gate_contract_json JSON NULL,
  policy_tags_json JSON NULL,
  metadata_json JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CURRENT',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m283_cap_version_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m283_capability_version (capability_key,version),
  UNIQUE KEY uq_m283_capability_definition (capability_key,definition_sha256),
  INDEX idx_m283_capability_version_status (capability_key,status,frozen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO capability_versions (
  capability_version_id,capability_key,version,definition_sha256,
  input_contract_json,output_contract_json,execution_contract_json,
  verification_contract_json,gate_contract_json,policy_tags_json,metadata_json,
  status,created_at,frozen_at
)
SELECT
  UUID(),c.capability_key,c.version,
  SHA2(CONCAT_WS('|',
    c.capability_key,c.capability_type,c.display_name,c.version,c.status,c.routable,
    COALESCE(c.adapter_key,''),COALESCE(CAST(c.input_contract_json AS CHAR),''),
    COALESCE(CAST(c.output_contract_json AS CHAR),''),
    COALESCE(CAST(c.capabilities_json AS CHAR),''),
    COALESCE(CAST(c.policy_tags_json AS CHAR),''),
    COALESCE(CAST(c.metadata_json AS CHAR),'')
  ),256),
  c.input_contract_json,c.output_contract_json,
  JSON_OBJECT(
    'capabilityType',c.capability_type,
    'adapterKey',c.adapter_key,
    'routable',c.routable,
    'capabilities',c.capabilities_json
  ),
  JSON_EXTRACT(c.metadata_json,'$.verificationContract'),
  JSON_EXTRACT(c.metadata_json,'$.gateContract'),
  c.policy_tags_json,c.metadata_json,
  'CURRENT',CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)
FROM capability_registry c;

CREATE TABLE trigger_registry (
  trigger_id CHAR(36) PRIMARY KEY,
  trigger_key VARCHAR(320) NOT NULL,
  trigger_type VARCHAR(16) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  scope_type VARCHAR(32) NOT NULL,
  scope_id VARCHAR(320) NULL,
  timezone VARCHAR(64) NULL,
  schedule_expr VARCHAR(128) NULL,
  event_type VARCHAR(128) NULL,
  condition_expr TEXT NULL,
  dedupe_window_seconds INT NOT NULL DEFAULT 3600,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_m283_trigger_key (trigger_key),
  INDEX idx_m283_trigger_type_enabled (trigger_type,status,enabled),
  INDEX idx_m283_trigger_scope (scope_type,scope_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE trigger_capability_bindings (
  id CHAR(36) PRIMARY KEY,
  trigger_id CHAR(36) NOT NULL,
  capability_key VARCHAR(320) NOT NULL,
  capability_version_id CHAR(36) NOT NULL,
  workflow_template_id CHAR(36) NULL,
  stage_key VARCHAR(128) NULL,
  priority INT NOT NULL DEFAULT 100,
  policy_json JSON NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m283_trigger_binding_trigger
    FOREIGN KEY (trigger_id) REFERENCES trigger_registry(trigger_id),
  CONSTRAINT fk_m283_trigger_binding_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  CONSTRAINT fk_m283_trigger_binding_version
    FOREIGN KEY (capability_version_id) REFERENCES capability_versions(capability_version_id),
  CONSTRAINT fk_m283_trigger_binding_workflow
    FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  UNIQUE KEY uq_m283_trigger_capability (trigger_id,capability_key,capability_version_id),
  INDEX idx_m283_trigger_binding_enabled (trigger_id,enabled,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE trigger_fires (
  id CHAR(36) PRIMARY KEY,
  trigger_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  event_id VARCHAR(320) NULL,
  scheduled_fire_time DATETIME(6) NULL,
  dedupe_key VARCHAR(640) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  run_id CHAR(36) NULL,
  task_id CHAR(36) NULL,
  capability_invocation_id CHAR(36) NULL,
  result_json JSON NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m283_trigger_fire_trigger
    FOREIGN KEY (trigger_id) REFERENCES trigger_registry(trigger_id),
  CONSTRAINT fk_m283_trigger_fire_project
    FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m283_trigger_fire_run
    FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_m283_trigger_fire_task
    FOREIGN KEY (task_id) REFERENCES tasks(id),
  UNIQUE KEY uq_m283_trigger_fire_dedupe (dedupe_key),
  INDEX idx_m283_trigger_fire_status (trigger_id,status,created_at),
  INDEX idx_m283_trigger_fire_project (project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE trigger_dispatches (
  id CHAR(36) PRIMARY KEY,
  trigger_fire_id CHAR(36) NOT NULL,
  capability_invocation_id CHAR(36) NOT NULL,
  transport_mode VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  request_json JSON NOT NULL,
  response_evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m283_trigger_dispatch_fire
    FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  UNIQUE KEY uq_m283_trigger_dispatch_invocation (capability_invocation_id),
  INDEX idx_m283_trigger_dispatch_status (status,transport_mode,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE capability_invocations
  MODIFY project_stage_instance_id CHAR(36) NULL,
  MODIFY workflow_stage_id CHAR(36) NULL,
  MODIFY requirement_id CHAR(36) NULL,
  ADD COLUMN capability_version_id CHAR(36) NULL AFTER selected_capability_key,
  ADD COLUMN trigger_fire_id CHAR(36) NULL AFTER capability_version_id,
  ADD CONSTRAINT fk_m283_invocation_capability_version
    FOREIGN KEY (capability_version_id) REFERENCES capability_versions(capability_version_id),
  ADD CONSTRAINT fk_m283_invocation_trigger_fire
    FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  ADD INDEX idx_m283_invocation_capability_version (capability_version_id,status,created_at),
  ADD INDEX idx_m283_invocation_trigger_fire (trigger_fire_id,status,created_at);

-- Scheduled trigger seeds. Existing external schedulers remain authoritative, so seeds are shadow-disabled.
INSERT INTO trigger_registry
  (trigger_id,trigger_key,trigger_type,display_name,status,scope_type,scope_id,timezone,schedule_expr,dedupe_window_seconds,enabled,metadata_json)
VALUES
  (UUID(),'TRIGGER_DAILY_PLAN_CLOSEOUT_2100_CN','SCHEDULE','每日计划收口','ACTIVE','USER',NULL,'Asia/Shanghai','0 21 * * *',3600,FALSE,JSON_OBJECT('externalSchedulerActive',TRUE,'source','M28.3')),
  (UUID(),'TRIGGER_LIBRARY_INCREMENTAL_CLEANUP_2130_CN','SCHEDULE','资料库增量清理','ACTIVE','USER',NULL,'Asia/Shanghai','30 21 * * *',3600,FALSE,JSON_OBJECT('externalSchedulerActive',TRUE,'source','M28.3')),
  (UUID(),'TRIGGER_AI_FRONTIER_WEEKLY_FRI_0900_CN','SCHEDULE','AI 前沿观察','ACTIVE','USER',NULL,'Asia/Shanghai','0 9 * * 5',86400,FALSE,JSON_OBJECT('externalSchedulerActive',TRUE,'source','M28.3')),
  (UUID(),'TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN','SCHEDULE','《你好，那年夏天》小说持续更新','ACTIVE','PROJECT_TYPE','AIGC_CONTENT','Asia/Shanghai','0 9 * * *',3600,FALSE,
    JSON_OBJECT(
      'externalSchedulerActive',TRUE,
      'targetProjectName','你好，那年夏天',
      'projectRoot','/你好那年夏天/',
      'nativeMode','SHADOW',
      'source','M28.3'
    )),
  (UUID(),'TRIGGER_JOB_POOL_NEEDS_REFRESH','METRIC','岗位池需要刷新','ACTIVE','USER',NULL,NULL,NULL,3600,FALSE,JSON_OBJECT('source','M28.3')),
  (UUID(),'TRIGGER_JOB_READY_TO_APPLY','EVENT','岗位进入主投状态','ACTIVE','USER',NULL,NULL,NULL,3600,FALSE,JSON_OBJECT('eventType','JOB_READY_TO_APPLY','source','M28.3'));

-- Bind seeds only when the target Skill already exists in Runtime.
INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,NULL,10,
       JSON_OBJECT('executionMode','EXTERNAL_SCHEDULER','shadow',TRUE),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:DAILY_PLAN_CLOSEOUT'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_DAILY_PLAN_CLOSEOUT_2100_CN';

INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,NULL,10,
       JSON_OBJECT('executionMode','EXTERNAL_SCHEDULER','shadow',TRUE),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:LIBRARY_INCREMENTAL_CLEANUP'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_LIBRARY_INCREMENTAL_CLEANUP_2130_CN';

INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,NULL,10,
       JSON_OBJECT('executionMode','EXTERNAL_SCHEDULER','shadow',TRUE),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:AI_FRONTIER_OBSERVATION'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_AI_FRONTIER_WEEKLY_FRI_0900_CN';

INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,'AIGC_11_DERIVATION',10,
       JSON_OBJECT(
         'executionMode','BRIDGE',
         'shadow',TRUE,
         'externalTransport','CHATGPT_LIBRARY',
         'checkpointPath','/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md'
       ),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN';

INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,NULL,10,
       JSON_OBJECT('executionMode','EVENT','shadow',TRUE),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:JOB_OPPORTUNITY_SCREENING'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_JOB_POOL_NEEDS_REFRESH';

INSERT INTO trigger_capability_bindings
  (id,trigger_id,capability_key,capability_version_id,stage_key,priority,policy_json,enabled)
SELECT UUID(),t.trigger_id,c.capability_key,v.capability_version_id,NULL,10,
       JSON_OBJECT('executionMode','EVENT','shadow',TRUE),TRUE
FROM trigger_registry t
JOIN capability_registry c ON c.capability_key='SKILL:RESUME_LIGHT_TAILORING'
JOIN capability_versions v ON v.capability_key=c.capability_key AND v.version=c.version
WHERE t.trigger_key='TRIGGER_JOB_READY_TO_APPLY';
