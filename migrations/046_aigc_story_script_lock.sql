-- AI Native Runtime V2.8 M28.2 Story / Script / Structure Lock
-- Migration: 046_aigc_story_script_lock.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_STORY_KNOWLEDGE','故事知识库','AIGC_03_SCRIPT',80,'人物、关系、时间线、事实、规则、场景、对白、主题与自然单元的正式知识对象'),
  ('AIGC_SCRIPT_VERSION','剧本版本','AIGC_03_SCRIPT',90,'不可覆盖的剧本版本、来源定位、场景范围与内容哈希'),
  ('AIGC_SCRIPT_LOCK_CHANGE','剧本锁定与变更','AIGC_03_SCRIPT',100,'Script Lock、通用 Change Request 绑定与 Scene/Shot/Asset/Audio/Distribution 影响分析')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-SCRIPT','剧本锁定门禁','ACTIVE'),
  ('STATUS','LOCKED','已锁定','ACTIVE'),
  ('STATUS','HISTORICAL','历史版本','ACTIVE'),
  ('STATUS','APPROVED','已批准','ACTIVE'),
  ('STATUS','APPLIED','已应用','ACTIVE'),
  ('STATUS','PENDING','待确认','ACTIVE'),
  ('KNOWLEDGE_STATUS','FACT','事实','ACTIVE'),
  ('KNOWLEDGE_STATUS','RULE','规则','ACTIVE'),
  ('KNOWLEDGE_STATUS','CURRENT','当前知识','ACTIVE'),
  ('KNOWLEDGE_STATUS','PENDING','待确认','ACTIVE'),
  ('KNOWLEDGE_STATUS','EXPERIMENT','实验','ACTIVE'),
  ('KNOWLEDGE_STATUS','HISTORICAL','历史知识','ACTIVE'),
  ('KNOWLEDGE_STATUS','DEPRECATED','已废弃','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_story_knowledge_entries (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  knowledge_key VARCHAR(160) NOT NULL,
  category VARCHAR(48) NOT NULL,
  knowledge_status VARCHAR(24) NOT NULL,
  title VARCHAR(512) NOT NULL,
  content_json JSON NOT NULL,
  scope_json JSON NOT NULL,
  source_ref_json JSON NOT NULL,
  effective_script_version_key VARCHAR(128) NULL,
  gate_critical BOOLEAN NOT NULL DEFAULT FALSE,
  immutable BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m282_story_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_story_supersedes FOREIGN KEY (supersedes_id) REFERENCES aigc_story_knowledge_entries(id),
  CONSTRAINT fk_m282_story_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m282_story_key (project_id,knowledge_key),
  INDEX idx_m282_story_category_status (project_id,category,knowledge_status),
  INDEX idx_m282_story_gate (project_id,gate_critical,knowledge_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_script_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  version_key VARCHAR(128) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  script_format VARCHAR(64) NOT NULL,
  source_locator_json JSON NOT NULL,
  scene_start INT NOT NULL,
  scene_end INT NOT NULL,
  scene_count INT NOT NULL,
  natural_unit_json JSON NOT NULL,
  structure_json JSON NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  parent_script_version_id CHAR(36) NULL,
  change_request_id CHAR(36) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m282_script_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_script_parent FOREIGN KEY (parent_script_version_id) REFERENCES aigc_script_versions(id),
  CONSTRAINT fk_m282_script_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m282_script_key (project_id,version_key),
  UNIQUE KEY uq_m282_script_no (project_id,version_no),
  INDEX idx_m282_script_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_script_locks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  script_version_id CHAR(36) NOT NULL,
  lock_key VARCHAR(128) NOT NULL,
  story_knowledge_ids_json JSON NOT NULL,
  continuity_qa_json JSON NOT NULL,
  lock_snapshot_sha256 CHAR(64) NOT NULL,
  approval_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'LOCKED',
  locked_by_identity_id CHAR(36) NULL,
  locked_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m282_lock_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_lock_script FOREIGN KEY (script_version_id) REFERENCES aigc_script_versions(id),
  CONSTRAINT fk_m282_lock_identity FOREIGN KEY (locked_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m282_lock_script (script_version_id),
  UNIQUE KEY uq_m282_lock_key (project_id,lock_key),
  INDEX idx_m282_lock_status (project_id,status,locked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_script_change_requests (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  change_key VARCHAR(128) NOT NULL,
  project_change_id CHAR(36) NOT NULL,
  from_script_version_id CHAR(36) NOT NULL,
  proposed_version_key VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  approval_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'APPROVED',
  applied_script_version_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  applied_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m282_change_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_change_generic FOREIGN KEY (project_change_id) REFERENCES project_changes(id),
  CONSTRAINT fk_m282_change_from_script FOREIGN KEY (from_script_version_id) REFERENCES aigc_script_versions(id),
  CONSTRAINT fk_m282_change_applied_script FOREIGN KEY (applied_script_version_id) REFERENCES aigc_script_versions(id),
  CONSTRAINT fk_m282_change_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m282_change_key (project_id,change_key),
  UNIQUE KEY uq_m282_change_generic (project_change_id),
  UNIQUE KEY uq_m282_change_proposed_version (project_id,proposed_version_key),
  INDEX idx_m282_change_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE aigc_script_versions
  ADD CONSTRAINT fk_m282_script_change_request
    FOREIGN KEY (change_request_id) REFERENCES aigc_script_change_requests(id);

CREATE TABLE IF NOT EXISTS aigc_script_change_impacts (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  script_change_request_id CHAR(36) NOT NULL,
  impact_type VARCHAR(24) NOT NULL,
  affected_objects_json JSON NOT NULL,
  disposition VARCHAR(16) NOT NULL,
  rationale TEXT NOT NULL,
  revalidation_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m282_impact_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_impact_change FOREIGN KEY (script_change_request_id) REFERENCES aigc_script_change_requests(id),
  UNIQUE KEY uq_m282_impact_type (script_change_request_id,impact_type),
  INDEX idx_m282_impact_status (project_id,status,impact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m282_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m282_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m282_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m282_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
