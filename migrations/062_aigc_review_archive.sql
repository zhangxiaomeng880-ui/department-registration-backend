-- AI Native Runtime V2.8 M28.16 Review / Knowledge / Next Version / Archive
-- Migration: 062_aigc_review_archive.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_REVIEW_CYCLE','复盘周期','AIGC_14_REVIEW',510,'计划与实际、资产复用、生成失败、模型工具质量成本时延、QA、剪辑返工、发行表现、本地化 ROI、权利合规与工作流改进的正式复盘'),
  ('AIGC_KNOWLEDGE_RECORD','知识沉淀','AIGC_14_REVIEW',520,'Story / Visual / Audio / Production / Distribution / Performance 六类知识及 Pattern / Anti-pattern'),
  ('AIGC_IMPROVEMENT_BACKLOG','改进待办','AIGC_14_REVIEW',530,'资产、模型工具、Agent、Skill、Prompt、Workflow、生产与分发改进项'),
  ('AIGC_NEXT_VERSION_PROPOSAL','下一版本候选','AIGC_14_REVIEW',540,'下一内容版本、分发/生产/创意实验或 Story Rule 变更候选；Story Rule 必须人工门禁'),
  ('AIGC_DELIVERY_ARCHIVE','交付 / 归档包','AIGC_14_REVIEW',550,'Final/Distribution Masters、可重构源、清单、Selected Asset Provenance、QA/Eval、权利、发布表现与恢复验证')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-REVIEW','复盘 / 知识 / 下一版本门禁','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','STORY','故事','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','VISUAL','视觉','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','AUDIO','音频','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','PRODUCTION','生产','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','DISTRIBUTION','分发','ACTIVE'),
  ('KNOWLEDGE_DOMAIN','PERFORMANCE','表现','ACTIVE'),
  ('KNOWLEDGE_TYPE','KNOWLEDGE','知识','ACTIVE'),
  ('KNOWLEDGE_TYPE','PATTERN','模式','ACTIVE'),
  ('KNOWLEDGE_TYPE','ANTI_PATTERN','反模式','ACTIVE'),
  ('PROPOSAL_TYPE','CONTENT_VERSION','下一内容版本','ACTIVE'),
  ('PROPOSAL_TYPE','DISTRIBUTION_EXPERIMENT','分发实验','ACTIVE'),
  ('PROPOSAL_TYPE','PRODUCTION_EXPERIMENT','生产实验','ACTIVE'),
  ('PROPOSAL_TYPE','CREATIVE_EXPERIMENT','创意实验','ACTIVE'),
  ('PROPOSAL_TYPE','STORY_RULE_CHANGE','故事规则变更','ACTIVE'),
  ('REVIEW_DECISION','APPROVED','已批准','ACTIVE'),
  ('REVIEW_DECISION','REJECTED','已拒绝','ACTIVE'),
  ('ARCHIVE_STATUS','CANDIDATE','候选归档包','ACTIVE'),
  ('ARCHIVE_STATUS','FROZEN','已冻结归档包','ACTIVE'),
  ('ARCHIVE_STATUS','HISTORICAL','历史归档包','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_review_cycles (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  performance_gate_evaluation_id CHAR(36) NOT NULL,
  review_key VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  review_window_json JSON NOT NULL,
  planned_actual_json JSON NOT NULL,
  review_dimensions_json JSON NOT NULL,
  findings_json JSON NOT NULL,
  improvement_summary_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  approval_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2816_review_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_review_perf_gate FOREIGN KEY (performance_gate_evaluation_id) REFERENCES aigc_m2815_gate_evaluations(id),
  CONSTRAINT fk_m2816_review_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2816_review_version (project_id,review_key,version_no),
  INDEX idx_m2816_review_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_knowledge_records (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  knowledge_key VARCHAR(200) NOT NULL,
  domain_key VARCHAR(32) NOT NULL,
  knowledge_type VARCHAR(24) NOT NULL,
  statement_text TEXT NOT NULL,
  applicability_json JSON NOT NULL,
  evidence_refs_json JSON NOT NULL,
  confidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'APPROVED',
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2816_knowledge_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_knowledge_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2816_knowledge_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2816_knowledge_key (review_cycle_id,knowledge_key),
  INDEX idx_m2816_knowledge_domain (project_id,domain_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_improvement_backlog (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  item_key VARCHAR(200) NOT NULL,
  improvement_type VARCHAR(32) NOT NULL,
  title VARCHAR(512) NOT NULL,
  problem_json JSON NOT NULL,
  recommendation_json JSON NOT NULL,
  priority VARCHAR(16) NOT NULL,
  acceptance_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PLANNED',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2816_backlog_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_backlog_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2816_backlog_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2816_backlog_key (review_cycle_id,item_key),
  INDEX idx_m2816_backlog_priority (project_id,status,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_next_version_proposals (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  proposal_key VARCHAR(200) NOT NULL,
  proposal_type VARCHAR(40) NOT NULL,
  source_refs_json JSON NOT NULL,
  title VARCHAR(512) NOT NULL,
  hypothesis_json JSON NOT NULL,
  proposed_change_json JSON NOT NULL,
  guardrails_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  human_decision_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  decided_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2816_proposal_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_proposal_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2816_proposal_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2816_proposal_key (review_cycle_id,proposal_key),
  INDEX idx_m2816_proposal_type (project_id,proposal_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_archive_packages (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  master_version_id CHAR(36) NOT NULL,
  distribution_package_id CHAR(36) NOT NULL,
  release_plan_id CHAR(36) NULL,
  archive_key VARCHAR(200) NOT NULL,
  version_no INT NOT NULL,
  final_assets_json JSON NOT NULL,
  reconstructable_sources_json JSON NOT NULL,
  manifests_json JSON NOT NULL,
  selected_asset_provenance_json JSON NOT NULL,
  qa_eval_evidence_json JSON NOT NULL,
  rights_evidence_json JSON NOT NULL,
  publication_performance_snapshot_json JSON NOT NULL,
  retention_policy_json JSON NOT NULL,
  restore_verification_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  frozen_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2816_archive_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_archive_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2816_archive_master FOREIGN KEY (master_version_id) REFERENCES aigc_master_versions(id),
  CONSTRAINT fk_m2816_archive_package FOREIGN KEY (distribution_package_id) REFERENCES aigc_distribution_packages(id),
  CONSTRAINT fk_m2816_archive_release FOREIGN KEY (release_plan_id) REFERENCES aigc_release_plans(id),
  CONSTRAINT fk_m2816_archive_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2816_archive_version (project_id,archive_key,version_no),
  INDEX idx_m2816_archive_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2816_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_cycle_id CHAR(36) NOT NULL,
  archive_package_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2816_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2816_gate_review FOREIGN KEY (review_cycle_id) REFERENCES aigc_review_cycles(id),
  CONSTRAINT fk_m2816_gate_archive FOREIGN KEY (archive_package_id) REFERENCES aigc_archive_packages(id),
  CONSTRAINT fk_m2816_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2816_gate_latest (review_cycle_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
