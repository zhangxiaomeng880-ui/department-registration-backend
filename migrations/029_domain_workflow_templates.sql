-- AI Native Runtime V2.5 M25.6 Domain Workflow Templates
-- Migration: 029_domain_workflow_templates.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS project_subtype_registry (
  project_type_key VARCHAR(128) NOT NULL,
  subtype_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  overlay_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (project_type_key,subtype_key),
  CONSTRAINT fk_m256_subtype_project_type
    FOREIGN KEY (project_type_key) REFERENCES project_type_registry(project_type_key),
  INDEX idx_m256_subtype_status (project_type_key,status,subtype_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE projects
  ADD COLUMN project_subtype_key VARCHAR(128) NULL AFTER project_type,
  ADD CONSTRAINT fk_m256_project_subtype
    FOREIGN KEY (project_type,project_subtype_key)
    REFERENCES project_subtype_registry(project_type_key,subtype_key),
  ADD INDEX idx_m256_project_subtype (project_type,project_subtype_key,status);

CREATE TABLE IF NOT EXISTS domain_workflow_presets (
  preset_key VARCHAR(128) PRIMARY KEY,
  project_type_key VARCHAR(128) NOT NULL,
  version VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  spec_json JSON NOT NULL,
  spec_sha256 CHAR(64) NOT NULL,
  source_refs_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m256_preset_project_type
    FOREIGN KEY (project_type_key) REFERENCES project_type_registry(project_type_key),
  UNIQUE KEY uq_m256_preset_project_version (project_type_key,version),
  INDEX idx_m256_preset_status (project_type_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS domain_workflow_releases (
  id CHAR(36) PRIMARY KEY,
  preset_key VARCHAR(128) NOT NULL,
  workflow_template_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'BLOCKED',
  readiness_json JSON NOT NULL,
  preset_spec_sha256 CHAR(64) NOT NULL,
  workflow_definition_sha256 CHAR(64) NULL,
  activated_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m256_release_preset
    FOREIGN KEY (preset_key) REFERENCES domain_workflow_presets(preset_key),
  CONSTRAINT fk_m256_release_workflow
    FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id),
  UNIQUE KEY uq_m256_release_preset_spec (preset_key,preset_spec_sha256),
  INDEX idx_m256_release_status (preset_key,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO project_subtype_registry
  (project_type_key,subtype_key,display_name,status,overlay_json)
VALUES
  ('PRODUCT_DEVELOPMENT','FRONTEND_PROTOTYPE','Frontend Prototype','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','FULL_STACK_WEB','Full Stack Web','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','MOBILE_APP','Mobile App','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','BACKEND_API_SERVICE','Backend API Service','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','SAAS_PLATFORM','SaaS Platform','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','AI_APPLICATION','AI Application','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND','aiGateRequired',TRUE)),
  ('PRODUCT_DEVELOPMENT','DATA_PRODUCT','Data Product','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','INTEGRATION_SDK','Integration SDK','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('PRODUCT_DEVELOPMENT','INTERNAL_TOOL','Internal Tool','ACTIVE',JSON_OBJECT('domain','PRODUCT_RND')),
  ('AIGC_CONTENT','NARRATIVE_FILM','Narrative Film / Feature / Limited Series','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','SHORT_DRAMA','Short Drama / Serial Story','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','SHORT_VIDEO','Short Video / Creator Content','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','MUSIC','Music / Song / OST','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','MV','MV / Music Video','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','AD_CAMPAIGN','Ad / Campaign Creative','ACTIVE',JSON_OBJECT('domain','AIGC')),
  ('AIGC_CONTENT','MULTIMODAL_CONTENT','Multimodal Content','ACTIVE',JSON_OBJECT('domain','AIGC'));


CREATE TABLE IF NOT EXISTS project_knowledge_bindings (
  project_id CHAR(36) NOT NULL,
  binding_key VARCHAR(128) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (project_id,binding_key),
  CONSTRAINT fk_m256_project_knowledge_project
    FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m256_project_knowledge_source
    FOREIGN KEY (source_key) REFERENCES knowledge_sources(source_key),
  INDEX idx_m256_project_knowledge_source (source_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
