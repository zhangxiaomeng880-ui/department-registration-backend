-- AI Native Runtime V2.7 M27.5 Product Acceptance / QA / Defect / Retest / Regression
-- Migration: 038_product_acceptance_qa.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_ACCEPTANCE_RUN','产品验收','PD_11_ACCEPTANCE',230,'对精确 Preview 执行功能、业务、流程、交互、状态、视觉、权限与范围验收'),
  ('PRODUCT_ACCEPTANCE_GAP','验收差距','PD_11_ACCEPTANCE',240,'验收失败项的需求、证据、返回阶段与恢复点'),
  ('PRODUCT_QA_PLAN','质量验证计划','PD_12_QA',250,'非功能、安全、兼容性、恢复与 AI 专项质量矩阵'),
  ('PRODUCT_QA_CASE','质量验证用例','PD_12_QA',260,'版本化质量验证用例与断言'),
  ('PRODUCT_QA_EXECUTION','质量验证执行','PD_12_QA',270,'针对精确 Preview 的用例执行与证据'),
  ('PRODUCT_QA_DEFECT','缺陷','PD_12_QA',280,'失败用例对应的正式缺陷与修复事实'),
  ('PRODUCT_QA_RETEST','缺陷复测','PD_12_QA',290,'缺陷修复后的精确版本复测'),
  ('PRODUCT_QA_REGRESSION','回归验证','PD_12_QA',300,'修复版本的回归范围与结果')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_acceptance_runs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  acceptance_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
  evidence_json JSON NOT NULL,
  accepted_by_identity_id CHAR(36) NULL,
  completed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_accept_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_accept_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m275_accept_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  CONSTRAINT fk_m275_accept_identity FOREIGN KEY (accepted_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m275_accept_key (project_id,acceptance_key),
  INDEX idx_m275_accept_preview (project_id,preview_deployment_id,completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_acceptance_checks (
  id CHAR(36) PRIMARY KEY,
  acceptance_run_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  check_key VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  requirement_version_id CHAR(36) NULL,
  status VARCHAR(16) NOT NULL,
  rationale TEXT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_accept_check_run FOREIGN KEY (acceptance_run_id) REFERENCES product_acceptance_runs(id),
  CONSTRAINT fk_m275_accept_check_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_accept_check_requirement FOREIGN KEY (requirement_version_id) REFERENCES product_requirement_versions(id),
  UNIQUE KEY uq_m275_accept_check (acceptance_run_id,check_key),
  INDEX idx_m275_accept_check_status (acceptance_run_id,category,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_acceptance_gaps (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  acceptance_run_id CHAR(36) NOT NULL,
  acceptance_check_id CHAR(36) NOT NULL,
  requirement_version_id CHAR(36) NOT NULL,
  gap_key VARCHAR(128) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  return_stage_key VARCHAR(128) NOT NULL,
  resume_point_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m275_gap_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_gap_run FOREIGN KEY (acceptance_run_id) REFERENCES product_acceptance_runs(id),
  CONSTRAINT fk_m275_gap_check FOREIGN KEY (acceptance_check_id) REFERENCES product_acceptance_checks(id),
  CONSTRAINT fk_m275_gap_requirement FOREIGN KEY (requirement_version_id) REFERENCES product_requirement_versions(id),
  UNIQUE KEY uq_m275_gap_key (project_id,gap_key),
  INDEX idx_m275_gap_status (acceptance_run_id,status,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_plans (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CURRENT',
  matrix_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_qa_plan_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_qa_plan_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m275_qa_plan_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m275_qa_plan_key (project_id,plan_key),
  INDEX idx_m275_qa_plan_status (project_id,status,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_cases (
  id CHAR(36) PRIMARY KEY,
  qa_plan_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  case_key VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  requirement_version_id CHAR(36) NULL,
  title VARCHAR(512) NOT NULL,
  assertions_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_qa_case_plan FOREIGN KEY (qa_plan_id) REFERENCES product_qa_plans(id),
  CONSTRAINT fk_m275_qa_case_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_qa_case_requirement FOREIGN KEY (requirement_version_id) REFERENCES product_requirement_versions(id),
  UNIQUE KEY uq_m275_qa_case_key (qa_plan_id,case_key),
  INDEX idx_m275_qa_case_category (qa_plan_id,category,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_executions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  qa_plan_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  execution_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
  evidence_json JSON NOT NULL,
  executed_by_identity_id CHAR(36) NULL,
  executed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_qa_exec_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_qa_exec_plan FOREIGN KEY (qa_plan_id) REFERENCES product_qa_plans(id),
  CONSTRAINT fk_m275_qa_exec_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  CONSTRAINT fk_m275_qa_exec_identity FOREIGN KEY (executed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m275_qa_exec_key (project_id,execution_key),
  INDEX idx_m275_qa_exec_preview (project_id,preview_deployment_id,executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_case_results (
  id CHAR(36) PRIMARY KEY,
  qa_execution_id CHAR(36) NOT NULL,
  qa_case_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  status VARCHAR(16) NOT NULL,
  rationale TEXT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_qa_result_exec FOREIGN KEY (qa_execution_id) REFERENCES product_qa_executions(id),
  CONSTRAINT fk_m275_qa_result_case FOREIGN KEY (qa_case_id) REFERENCES product_qa_cases(id),
  CONSTRAINT fk_m275_qa_result_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m275_qa_result_case (qa_execution_id,qa_case_id),
  INDEX idx_m275_qa_result_status (qa_execution_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_defects (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  qa_execution_id CHAR(36) NOT NULL,
  qa_case_result_id CHAR(36) NOT NULL,
  requirement_version_id CHAR(36) NULL,
  defect_key VARCHAR(128) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  return_stage_key VARCHAR(128) NOT NULL,
  evidence_json JSON NOT NULL,
  fix_changeset_id CHAR(36) NULL,
  fix_commit_sha CHAR(40) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m275_defect_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_defect_exec FOREIGN KEY (qa_execution_id) REFERENCES product_qa_executions(id),
  CONSTRAINT fk_m275_defect_result FOREIGN KEY (qa_case_result_id) REFERENCES product_qa_case_results(id),
  CONSTRAINT fk_m275_defect_requirement FOREIGN KEY (requirement_version_id) REFERENCES product_requirement_versions(id),
  CONSTRAINT fk_m275_defect_changeset FOREIGN KEY (fix_changeset_id) REFERENCES product_engineering_changesets(id),
  UNIQUE KEY uq_m275_defect_key (project_id,defect_key),
  INDEX idx_m275_defect_status (project_id,status,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_retests (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  defect_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  fix_changeset_id CHAR(36) NOT NULL,
  fix_commit_sha CHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL,
  evidence_json JSON NOT NULL,
  tested_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_retest_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_retest_defect FOREIGN KEY (defect_id) REFERENCES product_qa_defects(id),
  CONSTRAINT fk_m275_retest_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  CONSTRAINT fk_m275_retest_changeset FOREIGN KEY (fix_changeset_id) REFERENCES product_engineering_changesets(id),
  INDEX idx_m275_retest_defect (defect_id,tested_at,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_qa_regression_runs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  qa_plan_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  regression_key VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  scope_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  tested_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_reg_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_reg_plan FOREIGN KEY (qa_plan_id) REFERENCES product_qa_plans(id),
  CONSTRAINT fk_m275_reg_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  UNIQUE KEY uq_m275_reg_key (project_id,regression_key),
  INDEX idx_m275_reg_status (project_id,preview_deployment_id,status,tested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m275_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m275_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m275_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m275_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
