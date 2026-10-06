-- AI Native Runtime V2.5 M25.1 Core Meta Registry Foundation
-- Migration: 024_core_meta_registry.sql
-- Adds durable Project Type / Workflow / Milestone / Stage / Capability / Agent meta-model.
-- Additive and backward compatible: legacy projects remain valid until explicitly bound to a frozen workflow template.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS project_type_registry (
  project_type_key VARCHAR(128) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  domain_key VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m251_project_type_status (status,domain_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO project_type_registry
  (project_type_key,display_name,domain_key,status,metadata_json)
VALUES
  ('AIGC_CONTENT','AIGC Content Production','AIGC','ACTIVE',JSON_OBJECT('system',TRUE,'source','M25.1')),
  ('PRODUCT_DEVELOPMENT','Product Development','PRODUCT_RND','ACTIVE',JSON_OBJECT('system',TRUE,'source','M25.1'));

INSERT IGNORE INTO project_type_registry
  (project_type_key,display_name,status,metadata_json)
SELECT DISTINCT project_type,project_type,'ACTIVE',
       JSON_OBJECT('system',TRUE,'backfilledFrom','projects.project_type')
FROM projects
WHERE project_type IS NOT NULL AND project_type<>'';

CREATE TABLE IF NOT EXISTS capability_registry (
  capability_key VARCHAR(320) PRIMARY KEY,
  capability_type VARCHAR(16) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL DEFAULT '1',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  routable BOOLEAN NOT NULL DEFAULT TRUE,
  adapter_key VARCHAR(128) NULL,
  input_contract_json JSON NULL,
  output_contract_json JSON NULL,
  capabilities_json JSON NULL,
  policy_tags_json JSON NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m251_capability_type_status (capability_type,status,routable),
  INDEX idx_m251_capability_adapter (adapter_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS model_capability_bindings (
  capability_key VARCHAR(320) PRIMARY KEY,
  provider_key VARCHAR(128) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_model_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  CONSTRAINT fk_m251_model_binding_registry
    FOREIGN KEY (provider_key,model_key) REFERENCES model_registry(provider_key,model_key),
  UNIQUE KEY uq_m251_provider_model_capability (provider_key,model_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO capability_registry (
  capability_key,capability_type,display_name,version,status,routable,adapter_key,
  capabilities_json,metadata_json
)
SELECT
  CONCAT('MODEL:',m.provider_key,':',m.model_key),
  'MODEL',
  m.display_name,
  'model-registry-v1',
  IF(m.enabled=TRUE AND p.enabled=TRUE,'ACTIVE','DISABLED'),
  TRUE,
  p.adapter_key,
  m.capabilities_json,
  JSON_OBJECT('system',TRUE,'source','model_registry','providerKey',m.provider_key,'modelKey',m.model_key)
FROM model_registry m
JOIN provider_registry p ON p.provider_key=m.provider_key;

INSERT IGNORE INTO model_capability_bindings (capability_key,provider_key,model_key)
SELECT CONCAT('MODEL:',provider_key,':',model_key),provider_key,model_key
FROM model_registry;

CREATE TABLE IF NOT EXISTS agent_profiles (
  capability_key VARCHAR(320) PRIMARY KEY,
  role_key VARCHAR(128) NOT NULL,
  policy_mode VARCHAR(32) NULL,
  knowledge_scope_json JSON NULL,
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_agent_profile_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  INDEX idx_m251_agent_role (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_capability_grants (
  agent_capability_key VARCHAR(320) NOT NULL,
  child_capability_key VARCHAR(320) NOT NULL,
  requirement_mode VARCHAR(16) NOT NULL DEFAULT 'ALLOWED',
  priority INT NOT NULL DEFAULT 100,
  constraints_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (agent_capability_key,child_capability_key),
  CONSTRAINT fk_m251_agent_grant_agent
    FOREIGN KEY (agent_capability_key) REFERENCES capability_registry(capability_key),
  CONSTRAINT fk_m251_agent_grant_child
    FOREIGN KEY (child_capability_key) REFERENCES capability_registry(capability_key),
  INDEX idx_m251_agent_grant_child (child_capability_key,requirement_mode,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_type_capability_bindings (
  project_type_key VARCHAR(128) NOT NULL,
  capability_key VARCHAR(320) NOT NULL,
  binding_mode VARCHAR(16) NOT NULL DEFAULT 'ALLOWED',
  priority INT NOT NULL DEFAULT 100,
  constraints_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (project_type_key,capability_key),
  CONSTRAINT fk_m251_project_type_capability_type
    FOREIGN KEY (project_type_key) REFERENCES project_type_registry(project_type_key),
  CONSTRAINT fk_m251_project_type_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  INDEX idx_m251_project_type_capability_mode (project_type_key,binding_mode,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_templates (
  id CHAR(36) PRIMARY KEY,
  project_type_key VARCHAR(128) NOT NULL,
  template_key VARCHAR(128) NOT NULL,
  version VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  definition_sha256 CHAR(64) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_workflow_project_type
    FOREIGN KEY (project_type_key) REFERENCES project_type_registry(project_type_key),
  UNIQUE KEY uq_m251_workflow_template (project_type_key,template_key,version),
  INDEX idx_m251_workflow_status (project_type_key,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_template_milestones (
  id CHAR(36) PRIMARY KEY,
  workflow_template_id CHAR(36) NOT NULL,
  milestone_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  sequence_no INT NOT NULL,
  acceptance_json JSON NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_workflow_milestone_template
    FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  UNIQUE KEY uq_m251_workflow_milestone_key (workflow_template_id,milestone_key),
  UNIQUE KEY uq_m251_workflow_milestone_seq (workflow_template_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_template_stages (
  id CHAR(36) PRIMARY KEY,
  workflow_template_id CHAR(36) NOT NULL,
  milestone_template_id CHAR(36) NULL,
  stage_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  stage_type VARCHAR(64) NOT NULL DEFAULT 'EXECUTION',
  sequence_no INT NOT NULL,
  default_agent_capability_key VARCHAR(320) NULL,
  gate_policy_key VARCHAR(128) NULL,
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_workflow_stage_template
    FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  CONSTRAINT fk_m251_workflow_stage_milestone
    FOREIGN KEY (milestone_template_id) REFERENCES workflow_template_milestones(id),
  CONSTRAINT fk_m251_workflow_stage_agent
    FOREIGN KEY (default_agent_capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m251_workflow_stage_key (workflow_template_id,stage_key),
  UNIQUE KEY uq_m251_workflow_stage_seq (workflow_template_id,sequence_no),
  INDEX idx_m251_workflow_stage_milestone (workflow_template_id,milestone_template_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stage_capability_requirements (
  id CHAR(36) PRIMARY KEY,
  workflow_stage_id CHAR(36) NOT NULL,
  requirement_key VARCHAR(128) NOT NULL,
  capability_type VARCHAR(16) NOT NULL,
  capability_key VARCHAR(320) NULL,
  routing_mode VARCHAR(16) NOT NULL DEFAULT 'POLICY',
  requirement_mode VARCHAR(16) NOT NULL DEFAULT 'REQUIRED',
  priority INT NOT NULL DEFAULT 100,
  constraints_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_stage_requirement_stage
    FOREIGN KEY (workflow_stage_id) REFERENCES workflow_template_stages(id),
  CONSTRAINT fk_m251_stage_requirement_capability
    FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m251_stage_requirement (workflow_stage_id,requirement_key),
  INDEX idx_m251_stage_requirement_type (workflow_stage_id,capability_type,routing_mode,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE projects
  ADD COLUMN workflow_template_id CHAR(36) NULL AFTER current_workflow_version,
  ADD COLUMN current_stage_key VARCHAR(128) NULL AFTER workflow_template_id,
  ADD COLUMN meta_model_version VARCHAR(64) NULL AFTER current_stage_key,
  ADD CONSTRAINT fk_m251_project_workflow_template
    FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  ADD INDEX idx_m251_project_workflow (workflow_template_id,current_stage_key,status);

CREATE TABLE IF NOT EXISTS project_milestones (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  workflow_template_milestone_id CHAR(36) NULL,
  milestone_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  sequence_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  acceptance_json JSON NULL,
  state_json JSON NULL,
  started_at TIMESTAMP(6) NULL,
  completed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_project_milestone_project
    FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m251_project_milestone_template
    FOREIGN KEY (workflow_template_milestone_id) REFERENCES workflow_template_milestones(id),
  UNIQUE KEY uq_m251_project_milestone_key (project_id,milestone_key),
  UNIQUE KEY uq_m251_project_milestone_seq (project_id,sequence_no),
  INDEX idx_m251_project_milestone_status (project_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_stage_instances (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  workflow_template_stage_id CHAR(36) NOT NULL,
  milestone_id CHAR(36) NULL,
  stage_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  sequence_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  agent_capability_key VARCHAR(320) NULL,
  gate_policy_key VARCHAR(128) NULL,
  state_json JSON NULL,
  started_at TIMESTAMP(6) NULL,
  completed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m251_project_stage_project
    FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m251_project_stage_template
    FOREIGN KEY (workflow_template_stage_id) REFERENCES workflow_template_stages(id),
  CONSTRAINT fk_m251_project_stage_milestone
    FOREIGN KEY (milestone_id) REFERENCES project_milestones(id),
  CONSTRAINT fk_m251_project_stage_agent
    FOREIGN KEY (agent_capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m251_project_stage_key (project_id,stage_key),
  UNIQUE KEY uq_m251_project_stage_seq (project_id,sequence_no),
  INDEX idx_m251_project_stage_status (project_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
