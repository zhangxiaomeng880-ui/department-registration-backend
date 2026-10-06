-- AI Native Runtime V2.5 M25.6 Domain Workflow Template Specs
-- Migration: 029_domain_workflow_template_specs.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE workflow_templates
  ADD COLUMN template_class VARCHAR(32) NOT NULL DEFAULT 'CUSTOM' AFTER description,
  ADD COLUMN execution_readiness VARCHAR(32) NOT NULL DEFAULT 'BUILDING' AFTER status,
  ADD COLUMN source_spec_key VARCHAR(255) NULL AFTER execution_readiness,
  ADD COLUMN source_spec_version VARCHAR(64) NULL AFTER source_spec_key,
  ADD INDEX idx_m256_workflow_class_readiness (template_class,status,execution_readiness,project_type_key);

UPDATE workflow_templates
SET execution_readiness='EXECUTION_READY'
WHERE status='FROZEN' AND execution_readiness='BUILDING';

CREATE TABLE IF NOT EXISTS stage_agent_assignments (
  id CHAR(36) PRIMARY KEY,
  workflow_stage_id CHAR(36) NOT NULL,
  agent_capability_key VARCHAR(320) NOT NULL,
  assignment_role VARCHAR(16) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  conditional_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m256_stage_agent_stage
    FOREIGN KEY (workflow_stage_id) REFERENCES workflow_template_stages(id),
  CONSTRAINT fk_m256_stage_agent_capability
    FOREIGN KEY (agent_capability_key) REFERENCES capability_registry(capability_key),
  UNIQUE KEY uq_m256_stage_agent (workflow_stage_id,agent_capability_key,assignment_role),
  INDEX idx_m256_stage_agent_role (workflow_stage_id,assignment_role,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stage_gate_contracts (
  id CHAR(36) PRIMARY KEY,
  workflow_stage_id CHAR(36) NOT NULL,
  gate_key VARCHAR(128) NOT NULL,
  gate_role VARCHAR(32) NOT NULL DEFAULT 'PRIMARY',
  required BOOLEAN NOT NULL DEFAULT TRUE,
  aggregation_mode VARCHAR(32) NOT NULL DEFAULT 'ALL_REQUIRED_PASS',
  sequence_no INT NOT NULL DEFAULT 1,
  applies_when_json JSON NULL,
  contract_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m256_stage_gate_stage
    FOREIGN KEY (workflow_stage_id) REFERENCES workflow_template_stages(id),
  UNIQUE KEY uq_m256_stage_gate_key (workflow_stage_id,gate_key),
  UNIQUE KEY uq_m256_stage_gate_seq (workflow_stage_id,sequence_no),
  INDEX idx_m256_stage_gate_required (workflow_stage_id,required,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
