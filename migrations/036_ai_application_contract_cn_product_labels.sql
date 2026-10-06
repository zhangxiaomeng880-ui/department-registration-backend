-- AI Native Runtime V2.7 M27.3 AI Application Contract + Chinese Product Labels
-- Migration: 036_ai_application_contract_cn_product_labels.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- User-facing product labels are Chinese; stable machine keys remain unchanged.
UPDATE project_type_registry
SET display_name='产品研发'
WHERE project_type_key='PRODUCT_DEVELOPMENT';

UPDATE project_subtype_registry
SET display_name=CASE subtype_key
  WHEN 'FRONTEND_PROTOTYPE' THEN '前端原型'
  WHEN 'FULL_STACK_WEB' THEN '全栈 Web 应用'
  WHEN 'MOBILE_APP' THEN '移动应用'
  WHEN 'BACKEND_API_SERVICE' THEN '后端 API 服务'
  WHEN 'SAAS_PLATFORM' THEN 'SaaS 平台'
  WHEN 'AI_APPLICATION' THEN 'AI 应用'
  WHEN 'DATA_PRODUCT' THEN '数据产品'
  WHEN 'INTEGRATION_SDK' THEN '集成 / SDK'
  WHEN 'INTERNAL_TOOL' THEN '内部工具'
  ELSE display_name END
WHERE project_type_key='PRODUCT_DEVELOPMENT';

UPDATE domain_workflow_presets
SET display_name='产品研发标准工作流'
WHERE preset_key='PRODUCT_DEVELOPMENT_STANDARD';

UPDATE workflow_templates
SET display_name='产品研发标准工作流'
WHERE project_type_key='PRODUCT_DEVELOPMENT';

UPDATE workflow_template_milestones m
JOIN workflow_templates w ON w.id=m.workflow_template_id
SET m.display_name=CASE m.milestone_key
  WHEN 'PD-M0' THEN '项目就绪完成'
  WHEN 'PD-M1' THEN '问题 / 机会已验证'
  WHEN 'PD-M2' THEN '产品基线已批准'
  WHEN 'PD-M3' THEN '设计与技术契约已锁定'
  WHEN 'PD-M4' THEN '功能开发完成 / 预览就绪'
  WHEN 'PD-M5' THEN '产品验收与质量验证通过'
  WHEN 'PD-M6' THEN '发布候选版本就绪'
  WHEN 'PD-M7' THEN '生产环境已验证'
  WHEN 'PD-M8' THEN '结果复盘完成 / 版本关闭'
  ELSE m.display_name END
WHERE w.project_type_key='PRODUCT_DEVELOPMENT';

UPDATE workflow_template_stages s
JOIN workflow_templates w ON w.id=s.workflow_template_id
SET s.display_name=CASE s.stage_key
  WHEN 'PD_00_INIT' THEN '项目初始化 / 系统就绪'
  WHEN 'PD_01_DISCOVERY' THEN '用户发现 / 证据 / 洞察 / 竞品情报'
  WHEN 'PD_02_OPPORTUNITY' THEN '机会 / 假设 / 优先级'
  WHEN 'PD_03_GOAL' THEN '目标 / 成功标准 / 产品下注'
  WHEN 'PD_04_PRODUCT' THEN '产品定义 / 需求基线'
  WHEN 'PD_05_FEASIBILITY' THEN '可行性 / 风险 / 架构'
  WHEN 'PD_06_PLAN' THEN '交付规划 / 里程碑 / 发布计划'
  WHEN 'PD_07_DESIGN' THEN '产品设计 / 原型 / 设计契约'
  WHEN 'PD_08_CONTRACT' THEN '技术 / API / 数据 / 集成 / 埋点契约'
  WHEN 'PD_09_ENGINEERING' THEN '工程实现'
  WHEN 'PD_10_BUILD' THEN '构建 / 集成 / 预览'
  WHEN 'PD_11_ACCEPTANCE' THEN '产品验收'
  WHEN 'PD_12_QA' THEN '质量验证 / 非功能 / 安全验证'
  WHEN 'PD_13_RELEASE_READY' THEN '发布准备 / 版本冻结'
  WHEN 'PD_14_RELEASE' THEN '发布 / 灰度'
  WHEN 'PD_15_POST_RELEASE' THEN '发布后验证 / 事故运营'
  WHEN 'PD_16_OUTCOME' THEN '数据 / 实验 / 反馈'
  WHEN 'PD_17_REVIEW' THEN '决策 / 复盘'
  WHEN 'PD_18_KNOWLEDGE' THEN '知识沉淀 / 待办 / 下一版本'
  ELSE s.display_name END
WHERE w.project_type_key='PRODUCT_DEVELOPMENT';

UPDATE project_milestones m
JOIN projects p ON p.id=m.project_id
SET m.display_name=CASE m.milestone_key
  WHEN 'PD-M0' THEN '项目就绪完成'
  WHEN 'PD-M1' THEN '问题 / 机会已验证'
  WHEN 'PD-M2' THEN '产品基线已批准'
  WHEN 'PD-M3' THEN '设计与技术契约已锁定'
  WHEN 'PD-M4' THEN '功能开发完成 / 预览就绪'
  WHEN 'PD-M5' THEN '产品验收与质量验证通过'
  WHEN 'PD-M6' THEN '发布候选版本就绪'
  WHEN 'PD-M7' THEN '生产环境已验证'
  WHEN 'PD-M8' THEN '结果复盘完成 / 版本关闭'
  ELSE m.display_name END
WHERE p.project_type='PRODUCT_DEVELOPMENT';

UPDATE project_stage_instances s
JOIN projects p ON p.id=s.project_id
SET s.display_name=CASE s.stage_key
  WHEN 'PD_00_INIT' THEN '项目初始化 / 系统就绪'
  WHEN 'PD_01_DISCOVERY' THEN '用户发现 / 证据 / 洞察 / 竞品情报'
  WHEN 'PD_02_OPPORTUNITY' THEN '机会 / 假设 / 优先级'
  WHEN 'PD_03_GOAL' THEN '目标 / 成功标准 / 产品下注'
  WHEN 'PD_04_PRODUCT' THEN '产品定义 / 需求基线'
  WHEN 'PD_05_FEASIBILITY' THEN '可行性 / 风险 / 架构'
  WHEN 'PD_06_PLAN' THEN '交付规划 / 里程碑 / 发布计划'
  WHEN 'PD_07_DESIGN' THEN '产品设计 / 原型 / 设计契约'
  WHEN 'PD_08_CONTRACT' THEN '技术 / API / 数据 / 集成 / 埋点契约'
  WHEN 'PD_09_ENGINEERING' THEN '工程实现'
  WHEN 'PD_10_BUILD' THEN '构建 / 集成 / 预览'
  WHEN 'PD_11_ACCEPTANCE' THEN '产品验收'
  WHEN 'PD_12_QA' THEN '质量验证 / 非功能 / 安全验证'
  WHEN 'PD_13_RELEASE_READY' THEN '发布准备 / 版本冻结'
  WHEN 'PD_14_RELEASE' THEN '发布 / 灰度'
  WHEN 'PD_15_POST_RELEASE' THEN '发布后验证 / 事故运营'
  WHEN 'PD_16_OUTCOME' THEN '数据 / 实验 / 反馈'
  WHEN 'PD_17_REVIEW' THEN '决策 / 复盘'
  WHEN 'PD_18_KNOWLEDGE' THEN '知识沉淀 / 待办 / 下一版本'
  ELSE s.display_name END
WHERE p.project_type='PRODUCT_DEVELOPMENT';

UPDATE capability_registry
SET display_name=CASE capability_key
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:PROJECT_INITIALIZATION' THEN '项目初始化智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:PRODUCT_RESEARCH' THEN '产品研究智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:PRODUCT' THEN '产品经理智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:FEASIBILITY' THEN '可行性评审智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:PRODUCT_PROJECT' THEN '产品项目管理智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:DESIGN' THEN '产品设计智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:ENGINEERING_DATA' THEN '工程与数据契约智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:ENGINEERING' THEN '工程实现智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:PREVIEW_RELEASE_ENGINEERING' THEN '构建与预览智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:ACCEPTANCE' THEN '产品验收智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:QA' THEN '质量验证智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:RELEASE' THEN '发布管理智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:OPERATIONS_RELEASE' THEN '发布运营智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:DATA_EXPERIMENT' THEN '数据实验智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:REVIEW' THEN '项目复盘智能体'
  WHEN 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:KNOWLEDGE_UPDATE' THEN '知识沉淀智能体'
  ELSE display_name END
WHERE capability_key LIKE 'AGENT:STANDARD:PRODUCT_DEVELOPMENT:%';

CREATE TABLE IF NOT EXISTS product_ai_prompt_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  prompt_key VARCHAR(128) NOT NULL,
  version_no INT NOT NULL,
  instruction_sha256 CHAR(64) NOT NULL,
  instruction_contract_json JSON NOT NULL,
  structured_output_schema_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CURRENT',
  change_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m273_prompt_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m273_prompt_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m273_prompt_change FOREIGN KEY (change_id) REFERENCES project_changes(id),
  CONSTRAINT fk_m273_prompt_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m273_prompt_version (project_id,prompt_key,version_no),
  INDEX idx_m273_prompt_status (project_id,prompt_key,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_contracts (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  contract_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  current_version_no INT NOT NULL DEFAULT 1,
  owner_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m273_ai_contract_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m273_ai_contract_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m273_ai_contract_key (project_id,contract_key),
  INDEX idx_m273_ai_contract_status (project_id,status,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_contract_versions (
  id CHAR(36) PRIMARY KEY,
  ai_contract_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  technical_contract_version_id CHAR(36) NOT NULL,
  prompt_version_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  model_provider_requirements_json JSON NOT NULL,
  rag_contract_json JSON NOT NULL,
  capability_permission_contract_json JSON NOT NULL,
  structured_output_contract_json JSON NOT NULL,
  safety_policy_pii_contract_json JSON NOT NULL,
  adversarial_test_contract_json JSON NOT NULL,
  fallback_fail_closed_contract_json JSON NOT NULL,
  human_escalation_contract_json JSON NOT NULL,
  quality_threshold_json JSON NOT NULL,
  latency_threshold_json JSON NOT NULL,
  cost_threshold_json JSON NOT NULL,
  online_feedback_drift_json JSON NOT NULL,
  reproducibility_json JSON NOT NULL,
  section_status_json JSON NOT NULL,
  change_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m273_ai_version_contract FOREIGN KEY (ai_contract_id) REFERENCES product_ai_contracts(id),
  CONSTRAINT fk_m273_ai_version_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m273_ai_version_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m273_ai_version_technical FOREIGN KEY (technical_contract_version_id) REFERENCES product_technical_contract_versions(id),
  CONSTRAINT fk_m273_ai_version_prompt FOREIGN KEY (prompt_version_id) REFERENCES product_ai_prompt_versions(id),
  CONSTRAINT fk_m273_ai_version_change FOREIGN KEY (change_id) REFERENCES project_changes(id),
  CONSTRAINT fk_m273_ai_version_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m273_ai_contract_version (ai_contract_id,version_no),
  INDEX idx_m273_ai_version_project (project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_model_bindings (
  ai_contract_version_id CHAR(36) NOT NULL,
  provider_key VARCHAR(128) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  binding_role VARCHAR(32) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  fallback_order INT NULL,
  constraints_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ai_contract_version_id,provider_key,model_key,binding_role),
  CONSTRAINT fk_m273_ai_model_contract FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m273_ai_model_registry FOREIGN KEY (provider_key,model_key) REFERENCES model_registry(provider_key,model_key),
  INDEX idx_m273_ai_model_role (ai_contract_version_id,binding_role,fallback_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_knowledge_bindings (
  ai_contract_version_id CHAR(36) NOT NULL,
  source_id CHAR(36) NOT NULL,
  binding_role VARCHAR(32) NOT NULL DEFAULT 'RAG_SOURCE',
  retrieval_policy_json JSON NOT NULL,
  freshness_policy_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ai_contract_version_id,source_id,binding_role),
  CONSTRAINT fk_m273_ai_knowledge_contract FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m273_ai_knowledge_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_capability_bindings (
  ai_contract_version_id CHAR(36) NOT NULL,
  capability_key VARCHAR(320) NOT NULL,
  permission_mode VARCHAR(16) NOT NULL DEFAULT 'ALLOWED',
  capability_role VARCHAR(32) NOT NULL,
  purpose VARCHAR(512) NOT NULL,
  data_scope_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ai_contract_version_id,capability_key,capability_role),
  CONSTRAINT fk_m273_ai_capability_contract FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m273_ai_capability_registry FOREIGN KEY (capability_key) REFERENCES capability_registry(capability_key),
  INDEX idx_m273_ai_capability_permission (ai_contract_version_id,permission_mode,capability_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_ai_eval_bindings (
  ai_contract_version_id CHAR(36) NOT NULL,
  suite_version_id CHAR(36) NOT NULL,
  binding_role VARCHAR(32) NOT NULL DEFAULT 'OFFLINE_BASELINE',
  threshold_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (ai_contract_version_id,suite_version_id,binding_role),
  CONSTRAINT fk_m273_ai_eval_contract FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m273_ai_eval_version FOREIGN KEY (suite_version_id) REFERENCES eval_suite_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m273_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m273_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m273_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m273_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
