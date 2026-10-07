-- AI Native Runtime V2.8 M28.2 Novel Continuous Update Skill Binding
-- Migration: 046_novel_continuous_update_skill_binding.sql
-- Registers the novel update contract as an AIGC SKILL capability.
-- Execution remains external (ChatGPT Scheduler) until a native adapter/trigger exists.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO capability_registry (
  capability_key,capability_type,display_name,version,status,routable,adapter_key,
  input_contract_json,output_contract_json,capabilities_json,policy_tags_json,metadata_json
) VALUES (
  'SKILL:NOVEL_CONTINUOUS_UPDATE',
  'SKILL',
  '《你好，那年夏天》小说持续更新',
  '1.0',
  'ACTIVE',
  FALSE,
  'external-chatgpt-scheduler',
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('projectKey','checkpointPath','sourceScopes'),
    'properties',JSON_OBJECT(
      'projectKey',JSON_OBJECT('type','string'),
      'checkpointPath',JSON_OBJECT('type','string'),
      'sourceScopes',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'resumePoint',JSON_OBJECT('type',JSON_ARRAY('string','null')),
      'triggerReason',JSON_OBJECT('type',JSON_ARRAY('string','null'))
    )
  ),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('status','checkpointPath','gateStatus'),
    'properties',JSON_OBJECT(
      'status',JSON_OBJECT('type','string'),
      'updatedChapters',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'reusedPassChapters',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
      'gateStatus',JSON_OBJECT('type','string'),
      'checkpointPath',JSON_OBJECT('type','string'),
      'resumePoint',JSON_OBJECT('type',JSON_ARRAY('string','null')),
      'blockingReason',JSON_OBJECT('type',JSON_ARRAY('string','null'))
    )
  ),
  JSON_OBJECT(
    'taskTypes',JSON_ARRAY('NOVEL_CONTINUOUS_UPDATE','NARRATIVE_DERIVATION'),
    'supportsCheckpoint',TRUE,
    'supportsIncrementalExecution',TRUE,
    'supportsQaGate',TRUE
  ),
  JSON_OBJECT(
    'domain','AIGC',
    'subdomain','NARRATIVE_NOVEL',
    'executionMode','EXTERNAL_SCHEDULER',
    'projectType','AIGC_CONTENT',
    'agentRoleHint','OPERATIONS_CONTENT',
    'stageHint','AIGC_11_DERIVATION',
    'humanGate','P0_OR_CREATIVE_CHOICE',
    'sourceOfTruth','CHATGPT_LIBRARY'
  ),
  JSON_OBJECT(
    'contractPath','/AI_Native_Project/AI_NATIVE_2.0/knowledge/Skills/SKILL_NOVEL_CONTINUOUS_UPDATE_V1.0_CURRENT.md',
    'checkpointPath','/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md',
    'projectRoot','/你好那年夏天/',
    'externalScheduler','ChatGPT Scheduled Task',
    'externalSchedule',JSON_OBJECT('cadence','DAILY','hour',9,'timezone','Asia/Shanghai','timingMode','FLEXIBLE'),
    'nativeRuntimeExecution',FALSE,
    'nativeTriggerRegistry',FALSE,
    'bindingStatus','EXTERNAL_BOUND',
    'source','M28.2'
  )
)
ON DUPLICATE KEY UPDATE
  capability_type=VALUES(capability_type),
  display_name=VALUES(display_name),
  version=VALUES(version),
  status='ACTIVE',
  routable=FALSE,
  adapter_key=VALUES(adapter_key),
  input_contract_json=VALUES(input_contract_json),
  output_contract_json=VALUES(output_contract_json),
  capabilities_json=VALUES(capabilities_json),
  policy_tags_json=VALUES(policy_tags_json),
  metadata_json=VALUES(metadata_json);

INSERT INTO project_type_capability_bindings (
  project_type_key,capability_key,binding_mode,priority,constraints_json
) VALUES (
  'AIGC_CONTENT',
  'SKILL:NOVEL_CONTINUOUS_UPDATE',
  'ALLOWED',
  40,
  JSON_OBJECT(
    'executionMode','EXTERNAL_SCHEDULER',
    'stageHint','AIGC_11_DERIVATION',
    'nativeRuntimeExecution',FALSE
  )
)
ON DUPLICATE KEY UPDATE
  binding_mode='ALLOWED',
  priority=40,
  constraints_json=VALUES(constraints_json);

INSERT INTO agent_capability_grants (
  agent_capability_key,child_capability_key,requirement_mode,priority,constraints_json
)
SELECT
  'AGENT:STANDARD:AIGC_CONTENT:OPERATIONS_CONTENT',
  'SKILL:NOVEL_CONTINUOUS_UPDATE',
  'ALLOWED',
  40,
  JSON_OBJECT(
    'executionMode','EXTERNAL_SCHEDULER',
    'stageHint','AIGC_11_DERIVATION',
    'nativeRuntimeExecution',FALSE
  )
FROM capability_registry
WHERE capability_key='AGENT:STANDARD:AIGC_CONTENT:OPERATIONS_CONTENT'
ON DUPLICATE KEY UPDATE
  requirement_mode='ALLOWED',
  priority=40,
  constraints_json=VALUES(constraints_json);
