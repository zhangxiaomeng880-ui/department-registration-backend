-- AI Native Runtime V2.8 M28.13 Content Derivation / Localization / Platform Adaptation
-- Migration: 059_aigc_distribution_package.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_DERIVATION_VERSION','内容衍生版本','AIGC_11_DERIVATION',400,'从当前锁定母版派生的独立内容版本；绑定母内容、目标、平台、格式、剧透风险、本地化、CTA 与 QA'),
  ('AIGC_LOCALIZATION_VARIANT','本地化版本','AIGC_11_DERIVATION',410,'Subtitle / Copy Localization / Dub / Re-edit / Re-compose 等本地化派生，不反向修改母版'),
  ('AIGC_DISTRIBUTION_PACKAGE','发行素材包','AIGC_11_DERIVATION',420,'把已通过 QA 的衍生版本冻结为可交接 Stage 12 的发行素材包')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-DISTRIBUTION-PACKAGE','发行素材包门禁','ACTIVE'),
  ('DERIVATION_TYPE','FULL_MASTER','完整母版','ACTIVE'),
  ('DERIVATION_TYPE','TRAILER','预告片','ACTIVE'),
  ('DERIVATION_TYPE','HOOK','钩子切片','ACTIVE'),
  ('DERIVATION_TYPE','SCENE_CLIP','场景 / 剧情切片','ACTIVE'),
  ('DERIVATION_TYPE','CHARACTER_POV','角色 POV','ACTIVE'),
  ('DERIVATION_TYPE','TOPIC','话题 / 讨论内容','ACTIVE'),
  ('DERIVATION_TYPE','OST_MV','OST / MV','ACTIVE'),
  ('DERIVATION_TYPE','STILL','静帧','ACTIVE'),
  ('DERIVATION_TYPE','GRAPHIC','图文','ACTIVE'),
  ('DERIVATION_TYPE','BTS_AI_PROCESS','幕后 / AI 制作过程','ACTIVE'),
  ('LOCALIZATION_LEVEL','NONE','不本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','SUBTITLE','字幕本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','COPY_LOCALIZATION','文案本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','DUB','配音本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','RE_EDIT','重新剪辑','ACTIVE'),
  ('LOCALIZATION_LEVEL','RE_COMPOSE','重新编曲 / 重构','ACTIVE'),
  ('DISTRIBUTION_PACKAGE_STATUS','CANDIDATE','候选素材包','ACTIVE'),
  ('DISTRIBUTION_PACKAGE_STATUS','FROZEN','已冻结素材包','ACTIVE'),
  ('DISTRIBUTION_PACKAGE_STATUS','HISTORICAL','历史素材包','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_distribution_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  master_version_id CHAR(36) NOT NULL,
  parent_distribution_version_id CHAR(36) NULL,
  distribution_key VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  derivation_type VARCHAR(32) NOT NULL,
  mother_asset_json JSON NOT NULL,
  spoiler_risk VARCHAR(16) NOT NULL,
  target_json JSON NOT NULL,
  platform_json JSON NOT NULL,
  format_json JSON NOT NULL,
  localization_level VARCHAR(32) NOT NULL,
  localization_json JSON NOT NULL,
  cta_json JSON NOT NULL,
  qa_json JSON NOT NULL,
  rights_json JSON NOT NULL,
  content_locator_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL,
  change_ref_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2813_distribution_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2813_distribution_master FOREIGN KEY (master_version_id) REFERENCES aigc_master_versions(id),
  CONSTRAINT fk_m2813_distribution_parent FOREIGN KEY (parent_distribution_version_id) REFERENCES aigc_distribution_versions(id),
  CONSTRAINT fk_m2813_distribution_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2813_distribution_key_version (project_id,distribution_key,version_no),
  INDEX idx_m2813_distribution_master (master_version_id,status,derivation_type),
  INDEX idx_m2813_distribution_platform (project_id,localization_level,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_distribution_packages (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  master_version_id CHAR(36) NOT NULL,
  parent_package_id CHAR(36) NULL,
  package_key VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  package_intent_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  approval_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2813_package_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2813_package_master FOREIGN KEY (master_version_id) REFERENCES aigc_master_versions(id),
  CONSTRAINT fk_m2813_package_parent FOREIGN KEY (parent_package_id) REFERENCES aigc_distribution_packages(id),
  CONSTRAINT fk_m2813_package_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2813_package_key_version (project_id,package_key,version_no),
  INDEX idx_m2813_package_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_distribution_package_items (
  id CHAR(36) PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  distribution_version_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2813_package_item_package FOREIGN KEY (package_id) REFERENCES aigc_distribution_packages(id),
  CONSTRAINT fk_m2813_package_item_version FOREIGN KEY (distribution_version_id) REFERENCES aigc_distribution_versions(id),
  UNIQUE KEY uq_m2813_package_item (package_id,distribution_version_id),
  UNIQUE KEY uq_m2813_package_sequence (package_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2813_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  package_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2813_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2813_gate_package FOREIGN KEY (package_id) REFERENCES aigc_distribution_packages(id),
  CONSTRAINT fk_m2813_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2813_gate_latest (package_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
