-- AI Native Runtime V2.8 M28.12 Mastering / Acceptance / QA / Compliance
-- Migration: 058_aigc_master_acceptance.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_MASTER_VERSION','母版版本','AIGC_10_MASTER',360,'由当前锁定 Timeline + PASS Edit Master Export 派生的正式 Master Version；版本不可覆盖'),
  ('AIGC_CREATIVE_ACCEPTANCE','创作验收','AIGC_10_MASTER',370,'冻结 Story / Script / Creative Intent / Performance / Edit Intent 的独立验收'),
  ('AIGC_MASTER_QA','生产与技术质量验收','AIGC_10_MASTER',380,'Production QA 与 Technical QA 分离留证，不允许以整体感觉互相替代'),
  ('AIGC_COMPLIANCE_ACCEPTANCE','权利、合规与本地化验收','AIGC_10_MASTER',390,'Rights / License / Likeness / Brand / Font / Music / AI Disclosure / Platform / Regional / Localization QA')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-CREATIVE-ACCEPTANCE','创作验收门禁','ACTIVE'),
  ('GATE','G-AIGC-PRODUCTION-QA','生产质量门禁','ACTIVE'),
  ('GATE','G-AIGC-TECHNICAL-QA','技术质量门禁','ACTIVE'),
  ('GATE','G-AIGC-COMPLIANCE','权利与合规门禁','ACTIVE'),
  ('GATE','G-AIGC-LOCALIZATION-QA','本地化质量门禁','ACTIVE'),
  ('GATE','G-AIGC-MASTER','母版综合门禁','ACTIVE'),
  ('MASTER_STATUS','CANDIDATE','候选母版','ACTIVE'),
  ('MASTER_STATUS','LOCKED','已锁定母版','ACTIVE'),
  ('MASTER_STATUS','HISTORICAL','历史母版','ACTIVE'),
  ('MASTER_GATE_STATUS','PASS','通过','ACTIVE'),
  ('MASTER_GATE_STATUS','CONDITIONAL_PASS','有条件通过','ACTIVE'),
  ('MASTER_GATE_STATUS','BLOCKED','阻塞','ACTIVE'),
  ('MASTER_GATE_STATUS','FAIL','失败','ACTIVE'),
  ('MASTER_GATE_STATUS','N_A','不适用','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_master_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  timeline_version_id CHAR(36) NOT NULL,
  source_export_id CHAR(36) NOT NULL,
  parent_master_version_id CHAR(36) NULL,
  master_key VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  content_locator_json JSON NOT NULL,
  source_fingerprint_sha256 CHAR(64) NOT NULL,
  master_spec_json JSON NOT NULL,
  localization_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  localization_scope_json JSON NOT NULL,
  change_ref_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  lock_approval_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  locked_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2812_master_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2812_master_timeline FOREIGN KEY (timeline_version_id) REFERENCES aigc_timeline_versions(id),
  CONSTRAINT fk_m2812_master_export FOREIGN KEY (source_export_id) REFERENCES aigc_render_exports(id),
  CONSTRAINT fk_m2812_master_parent FOREIGN KEY (parent_master_version_id) REFERENCES aigc_master_versions(id),
  CONSTRAINT fk_m2812_master_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2812_master_key (project_id,master_key),
  UNIQUE KEY uq_m2812_master_version (project_id,version_no),
  INDEX idx_m2812_master_current (project_id,is_current,status,version_no),
  INDEX idx_m2812_master_source (timeline_version_id,source_export_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_master_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  master_version_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  checks_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  conditions_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2812_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2812_gate_master FOREIGN KEY (master_version_id) REFERENCES aigc_master_versions(id),
  CONSTRAINT fk_m2812_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2812_gate_latest (master_version_id,gate_key,as_of,created_at),
  INDEX idx_m2812_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
