-- AI Native Runtime V2.8 M28.17 AIGC Domain FINAL Gate
-- Migration: 063_aigc_domain_final_gate.sql
-- Criteria 1-13 are runtime-verifiable; criterion 14 requires real HUMAN non-synthetic E2E attestation.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_DOMAIN_FINAL_GATE','AIGC 领域最终验收','AIGC_FINAL',600,'AIGC Domain 14 条产品化条件的最终聚合门禁；真实项目 E2E 不得由 CI 或自动化伪造'),
  ('AIGC_REAL_PROJECT_E2E','真实项目 E2E 实证','AIGC_FINAL',610,'至少一个真实 AIGC 项目从 Discovery 到 Performance Review 的人工确认、非合成实证')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-DOMAIN-FINAL','AIGC 领域最终门禁','ACTIVE'),
  ('FINAL_CRITERION','01','全链路层级可运行','ACTIVE'),
  ('FINAL_CRITERION','02','里程碑智能可运行','ACTIVE'),
  ('FINAL_CRITERION','03','市场 / 竞品 / 创意 / 模型工具对象化','ACTIVE'),
  ('FINAL_CRITERION','04','故事 / 剧本锁定与变更影响','ACTIVE'),
  ('FINAL_CRITERION','05','镜头 / 资产覆盖可判定','ACTIVE'),
  ('FINAL_CRITERION','06','调用单 / 预检 / Reference Runtime 执行','ACTIVE'),
  ('FINAL_CRITERION','07','生成候选历史恢复锁定可追溯','ACTIVE'),
  ('FINAL_CRITERION','08','生成调用血缘完整','ACTIVE'),
  ('FINAL_CRITERION','09','多媒体 / 剪辑 / 母版 QA 完整','ACTIVE'),
  ('FINAL_CRITERION','10','时间线 / Track / Clip / timecode 可管理','ACTIVE'),
  ('FINAL_CRITERION','11','权利 / 披露 / Provenance 可门禁','ACTIVE'),
  ('FINAL_CRITERION','12','本地化 / 发行 / 发布核验可运行','ACTIVE'),
  ('FINAL_CRITERION','13','生产与表现回流复盘知识','ACTIVE'),
  ('FINAL_CRITERION','14','真实 AIGC 项目 E2E PASS','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_real_project_e2e_attestations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  archive_package_id CHAR(36) NOT NULL,
  attestation_mode VARCHAR(24) NOT NULL,
  decision VARCHAR(24) NOT NULL,
  attested_by_ref VARCHAR(255) NOT NULL,
  attested_at TIMESTAMP(6) NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  scope_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2817_attestation_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2817_attestation_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2817_attestation_archive FOREIGN KEY (archive_package_id) REFERENCES aigc_archive_packages(id),
  CONSTRAINT fk_m2817_attestation_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2817_attestation_review (project_id,review_cycle_id),
  INDEX idx_m2817_attestation_real (project_id,decision,is_synthetic,attested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_domain_final_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  criteria_json JSON NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2817_final_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2817_final_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2817_final_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
