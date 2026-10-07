-- AI Native Runtime V2.8 M28.14 Release / Distribution / Publishing
-- Migration: 060_aigc_release_publishing.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_CHANNEL_CONNECTION','渠道 / 账号连接','AIGC_12_PUBLISH',430,'受治理的渠道与账号连接元数据；凭证不落业务表'),
  ('AIGC_RELEASE_PLAN','发布计划 / 内容日历','AIGC_12_PUBLISH',440,'从当前冻结发行素材包生成渠道、地区、语言与发布时间计划'),
  ('AIGC_PUBLICATION_RECORD','发布记录','AIGC_12_PUBLISH',450,'记录外部发布执行回执、外部 ID / URL 与状态，不在本模块伪造真实外发'),
  ('AIGC_POST_PUBLISH_VERIFY','发布后核验','AIGC_12_PUBLISH',460,'发布后对可访问性、版本、地区语言、披露与内容完整性做核验')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-PUBLISH','发布门禁','ACTIVE'),
  ('CHANNEL_RISK','LOW','低风险','ACTIVE'),
  ('CHANNEL_RISK','HIGH','高风险','ACTIVE'),
  ('CHANNEL_STATUS','CONNECTED','已连接','ACTIVE'),
  ('CHANNEL_STATUS','DISCONNECTED','未连接','ACTIVE'),
  ('RELEASE_PLAN_STATUS','CANDIDATE','候选发布计划','ACTIVE'),
  ('RELEASE_PLAN_STATUS','FROZEN','已冻结发布计划','ACTIVE'),
  ('RELEASE_PLAN_STATUS','HISTORICAL','历史发布计划','ACTIVE'),
  ('RELEASE_ITEM_STATUS','PLANNED','已规划','ACTIVE'),
  ('RELEASE_ITEM_STATUS','APPROVAL_REQUIRED','待人工批准','ACTIVE'),
  ('RELEASE_ITEM_STATUS','APPROVED','已批准','ACTIVE'),
  ('PUBLICATION_STATUS','PUBLISHED','已发布','ACTIVE'),
  ('PUBLICATION_STATUS','FAILED','发布失败','ACTIVE'),
  ('PUBLICATION_VERIFY','PASS','核验通过','ACTIVE'),
  ('PUBLICATION_VERIFY','FAIL','核验失败','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_channel_connections (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  connection_key VARCHAR(160) NOT NULL,
  platform_key VARCHAR(80) NOT NULL,
  account_ref VARCHAR(255) NOT NULL,
  connection_ref_json JSON NOT NULL,
  regions_json JSON NOT NULL,
  languages_json JSON NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  rights_boundary_json JSON NOT NULL,
  disclosure_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CONNECTED',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2814_channel_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2814_channel_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2814_channel_key (project_id,connection_key),
  INDEX idx_m2814_channel_status (project_id,status,risk_level,platform_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_release_plans (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  distribution_package_id CHAR(36) NOT NULL,
  parent_release_plan_id CHAR(36) NULL,
  plan_key VARCHAR(160) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  release_window_json JSON NOT NULL,
  calendar_json JSON NOT NULL,
  rights_json JSON NOT NULL,
  disclosure_json JSON NOT NULL,
  change_ref_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  approval_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2814_plan_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2814_plan_package FOREIGN KEY (distribution_package_id) REFERENCES aigc_distribution_packages(id),
  CONSTRAINT fk_m2814_plan_parent FOREIGN KEY (parent_release_plan_id) REFERENCES aigc_release_plans(id),
  CONSTRAINT fk_m2814_plan_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2814_plan_version (project_id,plan_key,version_no),
  INDEX idx_m2814_plan_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_release_plan_items (
  id CHAR(36) PRIMARY KEY,
  release_plan_id CHAR(36) NOT NULL,
  distribution_version_id CHAR(36) NOT NULL,
  channel_connection_id CHAR(36) NOT NULL,
  item_key VARCHAR(200) NOT NULL,
  platform_key VARCHAR(80) NOT NULL,
  region VARCHAR(80) NOT NULL,
  language VARCHAR(80) NOT NULL,
  scheduled_publish_at TIMESTAMP(6) NOT NULL,
  rights_json JSON NOT NULL,
  disclosure_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  human_approval_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2814_item_plan FOREIGN KEY (release_plan_id) REFERENCES aigc_release_plans(id),
  CONSTRAINT fk_m2814_item_version FOREIGN KEY (distribution_version_id) REFERENCES aigc_content_derivation_versions(id),
  CONSTRAINT fk_m2814_item_channel FOREIGN KEY (channel_connection_id) REFERENCES aigc_channel_connections(id),
  UNIQUE KEY uq_m2814_item_key (release_plan_id,item_key),
  UNIQUE KEY uq_m2814_item_tuple (release_plan_id,distribution_version_id,channel_connection_id,region,language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_publication_records (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_plan_item_id CHAR(36) NOT NULL,
  attempt_no INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  external_id VARCHAR(512) NULL,
  published_url TEXT NULL,
  published_at TIMESTAMP(6) NULL,
  provider_receipt_json JSON NOT NULL,
  error_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2814_pub_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2814_pub_item FOREIGN KEY (release_plan_item_id) REFERENCES aigc_release_plan_items(id),
  CONSTRAINT fk_m2814_pub_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2814_pub_attempt (release_plan_item_id,attempt_no),
  INDEX idx_m2814_pub_status (project_id,status,published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_post_publish_verifications (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  publication_record_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL,
  checks_json JSON NOT NULL,
  observed_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  verified_by_identity_id CHAR(36) NULL,
  verified_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2814_verify_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2814_verify_publication FOREIGN KEY (publication_record_id) REFERENCES aigc_publication_records(id),
  CONSTRAINT fk_m2814_verify_identity FOREIGN KEY (verified_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2814_verify_pub (publication_record_id,status,verified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2814_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_plan_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2814_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2814_gate_plan FOREIGN KEY (release_plan_id) REFERENCES aigc_release_plans(id),
  CONSTRAINT fk_m2814_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2814_gate_latest (release_plan_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
