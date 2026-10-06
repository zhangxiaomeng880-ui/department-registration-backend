-- AI Native Runtime V2.7 M27.4 Engineering / Build / Preview
-- Migration: 037_product_engineering_build_preview.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS product_module_registry (
  module_key VARCHAR(128) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  stage_key VARCHAR(128) NULL,
  sort_order INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  description VARCHAR(512) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m274_module_stage (stage_key,sort_order,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_RESEARCH_STUDY','用户研究','PD_01_DISCOVERY',10,'研究目标、问题、方法、样本与原始证据定位'),
  ('PRODUCT_EVIDENCE','用户证据','PD_01_DISCOVERY',20,'可追溯的用户、业务、数据与市场证据'),
  ('PRODUCT_INSIGHT','用户洞察','PD_01_DISCOVERY',30,'由证据支持的洞察'),
  ('PRODUCT_OPPORTUNITY','问题与机会','PD_02_OPPORTUNITY',40,'问题、机会与用户价值'),
  ('PRODUCT_SOLUTION_CANDIDATE','方案候选','PD_02_OPPORTUNITY',50,'待验证的解决方案候选'),
  ('PRODUCT_HYPOTHESIS','产品假设','PD_02_OPPORTUNITY',60,'可验证的产品假设'),
  ('PRODUCT_PRIORITIZATION','优先级决策','PD_02_OPPORTUNITY',70,'九维优先级评估与正式决策'),
  ('PRODUCT_GOAL','产品目标','PD_03_GOAL',80,'业务目标、产品目标与成功指标'),
  ('PRODUCT_BET','产品下注','PD_03_GOAL',90,'围绕目标选择的产品下注'),
  ('PRODUCT_REQUIREMENT','产品需求','PD_04_PRODUCT',100,'版本化、可验收、可追溯的产品需求'),
  ('PRODUCT_REQUIREMENT_BASELINE','需求基线','PD_04_PRODUCT',110,'冻结需求版本与产品范围'),
  ('PRODUCT_FEASIBILITY_REVIEW','可行性评审','PD_05_FEASIBILITY',120,'架构、数据、安全、性能、成本与回滚评审'),
  ('PRODUCT_ARCHITECTURE_DECISION','架构决策','PD_05_FEASIBILITY',130,'ADR 与正式项目决策绑定'),
  ('PRODUCT_DELIVERY_PLAN','交付计划','PD_06_PLAN',140,'里程碑、迭代、工作项、依赖、容量与发布计划'),
  ('PRODUCT_DESIGN_CONTRACT','设计契约','PD_07_DESIGN',150,'设计源、状态矩阵、交互与验收矩阵'),
  ('PRODUCT_TECHNICAL_CONTRACT','技术契约','PD_08_CONTRACT',160,'技术、API、数据、集成与埋点契约'),
  ('PRODUCT_AI_PROMPT_VERSION','AI 提示词版本','PD_08_CONTRACT',170,'AI 提示词不可变版本与结构化输出契约'),
  ('PRODUCT_AI_CONTRACT','AI 应用专项契约','PD_08_CONTRACT',180,'模型、RAG、权限、安全、评测、阈值与可复现性'),
  ('PRODUCT_ENGINEERING_CHANGESET','工程变更集','PD_09_ENGINEERING',190,'工作项到 Repo / Branch / Commit / PR 的工程变更事实'),
  ('PRODUCT_BUILD_RECORD','构建记录','PD_10_BUILD',200,'精确 Commit 对应的 Build 与 Artifact'),
  ('PRODUCT_PREVIEW_DEPLOYMENT','预览部署','PD_10_BUILD',210,'精确 Build 对应的预览环境与部署'),
  ('PRODUCT_SMOKE_EVIDENCE','冒烟验证证据','PD_10_BUILD',220,'预览版本的健康、就绪与冒烟验证')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_engineering_changesets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  work_item_id CHAR(36) NOT NULL,
  design_contract_version_id CHAR(36) NOT NULL,
  technical_contract_version_id CHAR(36) NOT NULL,
  ai_contract_version_id CHAR(36) NULL,
  changeset_key VARCHAR(128) NOT NULL,
  source_provider VARCHAR(32) NOT NULL DEFAULT 'GITHUB',
  repository_full_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  base_commit_sha CHAR(40) NULL,
  commit_sha CHAR(40) NOT NULL,
  pull_request_json JSON NOT NULL,
  source_verification_json JSON NOT NULL,
  requirement_version_ids_json JSON NOT NULL,
  dependency_change_json JSON NOT NULL,
  migration_json JSON NOT NULL,
  static_check_json JSON NOT NULL,
  automated_test_json JSON NOT NULL,
  known_issue_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CURRENT',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_changeset_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_changeset_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m274_changeset_plan FOREIGN KEY (delivery_plan_id) REFERENCES product_delivery_plans(id),
  CONSTRAINT fk_m274_changeset_work FOREIGN KEY (work_item_id) REFERENCES project_work_items(id),
  CONSTRAINT fk_m274_changeset_design FOREIGN KEY (design_contract_version_id) REFERENCES product_design_contract_versions(id),
  CONSTRAINT fk_m274_changeset_technical FOREIGN KEY (technical_contract_version_id) REFERENCES product_technical_contract_versions(id),
  CONSTRAINT fk_m274_changeset_ai FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m274_changeset_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m274_changeset_key (project_id,changeset_key),
  UNIQUE KEY uq_m274_changeset_commit (project_id,repository_full_name,commit_sha),
  INDEX idx_m274_changeset_work (project_id,work_item_id,status),
  INDEX idx_m274_changeset_commit_sha (repository_full_name,commit_sha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_build_records (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  changeset_id CHAR(36) NOT NULL,
  target_release_version_id CHAR(36) NOT NULL,
  build_key VARCHAR(128) NOT NULL,
  build_id VARCHAR(255) NOT NULL,
  commit_sha CHAR(40) NOT NULL,
  artifact_locator_json JSON NOT NULL,
  artifact_sha256 CHAR(64) NULL,
  build_status VARCHAR(32) NOT NULL,
  build_system VARCHAR(64) NOT NULL,
  config_version_json JSON NOT NULL,
  migration_version_json JSON NOT NULL,
  ai_runtime_snapshot_json JSON NULL,
  test_summary_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_build_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_build_changeset FOREIGN KEY (changeset_id) REFERENCES product_engineering_changesets(id),
  CONSTRAINT fk_m274_build_release FOREIGN KEY (target_release_version_id) REFERENCES project_versions(id),
  UNIQUE KEY uq_m274_build_key (project_id,build_key),
  UNIQUE KEY uq_m274_build_external (project_id,build_system,build_id),
  INDEX idx_m274_build_status (project_id,build_status,finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_preview_deployments (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  build_record_id CHAR(36) NOT NULL,
  target_release_version_id CHAR(36) NOT NULL,
  preview_key VARCHAR(128) NOT NULL,
  environment VARCHAR(64) NOT NULL,
  deployment_id VARCHAR(255) NOT NULL,
  deployment_status VARCHAR(32) NOT NULL,
  commit_sha CHAR(40) NOT NULL,
  preview_locator_json JSON NOT NULL,
  config_snapshot_json JSON NOT NULL,
  health_json JSON NOT NULL,
  readiness_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  deployed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_preview_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_preview_build FOREIGN KEY (build_record_id) REFERENCES product_build_records(id),
  CONSTRAINT fk_m274_preview_release FOREIGN KEY (target_release_version_id) REFERENCES project_versions(id),
  UNIQUE KEY uq_m274_preview_key (project_id,preview_key),
  UNIQUE KEY uq_m274_preview_deployment (project_id,environment,deployment_id),
  INDEX idx_m274_preview_status (project_id,deployment_status,deployed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_smoke_evidence (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  smoke_key VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  checks_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  verified_by VARCHAR(128) NOT NULL DEFAULT 'RUNTIME',
  tested_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_smoke_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_smoke_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  UNIQUE KEY uq_m274_smoke_key (project_id,smoke_key),
  INDEX idx_m274_smoke_status (project_id,status,tested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m274_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m274_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
