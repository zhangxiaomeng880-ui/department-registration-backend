-- AI Native Runtime V2.8 M28.1 AIGC Foundation / Chinese Frontend Labels
-- Migration: 045_aigc_foundation.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Frontend display names are Chinese; stable keys remain unchanged.
UPDATE project_type_registry
SET display_name=CASE project_type_key
  WHEN 'PRODUCT_DEVELOPMENT' THEN '产品研发'
  WHEN 'AIGC_CONTENT' THEN 'AIGC 内容生产'
  ELSE display_name END
WHERE project_type_key IN ('PRODUCT_DEVELOPMENT','AIGC_CONTENT');

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
  WHEN 'NARRATIVE_FILM' THEN '叙事电影 / 长片 / 限定剧'
  WHEN 'SHORT_DRAMA' THEN '短剧 / 连载故事'
  WHEN 'SHORT_VIDEO' THEN '短视频 / 创作者内容'
  WHEN 'MUSIC' THEN '音乐 / 歌曲 / OST'
  WHEN 'MV' THEN '音乐视频 / MV'
  WHEN 'AD_CAMPAIGN' THEN '广告 / 营销创意'
  WHEN 'MULTIMODAL_CONTENT' THEN '多模态内容'
  ELSE display_name END
WHERE project_type_key IN ('PRODUCT_DEVELOPMENT','AIGC_CONTENT');

UPDATE domain_workflow_presets
SET display_name='AIGC 内容生产标准工作流'
WHERE preset_key='AIGC_CONTENT_STANDARD';

UPDATE workflow_templates
SET display_name='AIGC 内容生产标准工作流'
WHERE project_type_key='AIGC_CONTENT';

UPDATE workflow_template_milestones wm
JOIN workflow_templates wt ON wt.id=wm.workflow_template_id
SET wm.display_name=CASE wm.milestone_key
  WHEN 'AG-M0' THEN '项目 / 权利 / 环境就绪'
  WHEN 'AG-M1' THEN '创意方向 / 市场假设已批准'
  WHEN 'AG-M2' THEN '故事 / 剧本 / 结构已锁定'
  WHEN 'AG-M3' THEN '母版资产系统就绪'
  WHEN 'AG-M4' THEN '分镜 / 镜头 / 制作计划就绪'
  WHEN 'AG-M5' THEN '核心内容生产完成'
  WHEN 'AG-M6' THEN '剪辑 / 画面 / 音频母版已锁定'
  WHEN 'AG-M7' THEN '分发 / 本地化交付包就绪'
  WHEN 'AG-M8' THEN '已发布 / 已分发'
  WHEN 'AG-M9' THEN '表现复盘 / 知识回写完成'
  ELSE wm.display_name END
WHERE wt.project_type_key='AIGC_CONTENT';

UPDATE workflow_template_stages ws
JOIN workflow_templates wt ON wt.id=ws.workflow_template_id
SET ws.display_name=CASE ws.stage_key
  WHEN 'AIGC_00_INIT' THEN '项目初始化 / 权利 / 环境'
  WHEN 'AIGC_01_DISCOVERY' THEN '创意发现 / 市场 / 创意基准'
  WHEN 'AIGC_02_PLAN' THEN '制作规划 / 里程碑 / 预算 / 制作策略'
  WHEN 'AIGC_03_SCRIPT' THEN '故事 / 剧本 / 结构'
  WHEN 'AIGC_04_BREAKDOWN' THEN '拆解 / 镜头 / 制作规划'
  WHEN 'AIGC_05_FORMAT' THEN '视觉格式 / 音频 / 分发策略'
  WHEN 'AIGC_06_ASSET' THEN '资产系统 / 母版制作'
  WHEN 'AIGC_07_IMAGE' THEN '图像 / 关键帧 / 分镜生产'
  WHEN 'AIGC_08_VIDEO_AUDIO' THEN '视频 / 动作 / 对白 / 音乐 / 音效生产'
  WHEN 'AIGC_09_EDIT' THEN '剪辑 / 时间线 / 合成 / 后期'
  WHEN 'AIGC_10_MASTER' THEN '母版 / 验收 / QA / 合规'
  WHEN 'AIGC_11_DERIVATION' THEN '内容派生 / 本地化 / 平台适配'
  WHEN 'AIGC_12_PUBLISH' THEN '发布 / 分发 / 上线'
  WHEN 'AIGC_13_PERFORMANCE' THEN '表现 / 实验 / 反馈'
  WHEN 'AIGC_14_REVIEW' THEN '复盘 / 知识 / 下一版本'
  ELSE ws.display_name END
WHERE wt.project_type_key='AIGC_CONTENT';

UPDATE project_milestones pm
JOIN projects p ON p.id=pm.project_id
SET pm.display_name=CASE pm.milestone_key
  WHEN 'AG-M0' THEN '项目 / 权利 / 环境就绪'
  WHEN 'AG-M1' THEN '创意方向 / 市场假设已批准'
  WHEN 'AG-M2' THEN '故事 / 剧本 / 结构已锁定'
  WHEN 'AG-M3' THEN '母版资产系统就绪'
  WHEN 'AG-M4' THEN '分镜 / 镜头 / 制作计划就绪'
  WHEN 'AG-M5' THEN '核心内容生产完成'
  WHEN 'AG-M6' THEN '剪辑 / 画面 / 音频母版已锁定'
  WHEN 'AG-M7' THEN '分发 / 本地化交付包就绪'
  WHEN 'AG-M8' THEN '已发布 / 已分发'
  WHEN 'AG-M9' THEN '表现复盘 / 知识回写完成'
  ELSE pm.display_name END
WHERE p.project_type='AIGC_CONTENT';

UPDATE project_stage_instances ps
JOIN projects p ON p.id=ps.project_id
SET ps.display_name=CASE ps.stage_key
  WHEN 'AIGC_00_INIT' THEN '项目初始化 / 权利 / 环境'
  WHEN 'AIGC_01_DISCOVERY' THEN '创意发现 / 市场 / 创意基准'
  WHEN 'AIGC_02_PLAN' THEN '制作规划 / 里程碑 / 预算 / 制作策略'
  WHEN 'AIGC_03_SCRIPT' THEN '故事 / 剧本 / 结构'
  WHEN 'AIGC_04_BREAKDOWN' THEN '拆解 / 镜头 / 制作规划'
  WHEN 'AIGC_05_FORMAT' THEN '视觉格式 / 音频 / 分发策略'
  WHEN 'AIGC_06_ASSET' THEN '资产系统 / 母版制作'
  WHEN 'AIGC_07_IMAGE' THEN '图像 / 关键帧 / 分镜生产'
  WHEN 'AIGC_08_VIDEO_AUDIO' THEN '视频 / 动作 / 对白 / 音乐 / 音效生产'
  WHEN 'AIGC_09_EDIT' THEN '剪辑 / 时间线 / 合成 / 后期'
  WHEN 'AIGC_10_MASTER' THEN '母版 / 验收 / QA / 合规'
  WHEN 'AIGC_11_DERIVATION' THEN '内容派生 / 本地化 / 平台适配'
  WHEN 'AIGC_12_PUBLISH' THEN '发布 / 分发 / 上线'
  WHEN 'AIGC_13_PERFORMANCE' THEN '表现 / 实验 / 反馈'
  WHEN 'AIGC_14_REVIEW' THEN '复盘 / 知识 / 下一版本'
  ELSE ps.display_name END
WHERE p.project_type='AIGC_CONTENT';

CREATE TABLE IF NOT EXISTS aigc_module_registry (
  module_key VARCHAR(128) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  stage_key VARCHAR(128) NOT NULL,
  sort_order INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  description TEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_m281_module_stage (stage_key,status,sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_PROJECT_INITIALIZATION','项目初始化','AIGC_00_INIT',10,'项目、版本、角色、知识源、资产存储、能力环境、预算、权利与交付边界'),
  ('AIGC_RIGHTS_ENVIRONMENT','权利与环境','AIGC_00_INIT',20,'版权、肖像、音乐、字体、品牌、AI 披露、模型工具与凭据边界'),
  ('AIGC_MARKET_BENCHMARK','市场与平台基准','AIGC_01_DISCOVERY',30,'市场、平台、创作者、竞品与表现事实快照'),
  ('AIGC_CREATIVE_REFERENCE','创意参考','AIGC_01_DISCOVERY',40,'风格、构图、角色、动作、镜头、声音、表演与剪辑节奏参考'),
  ('AIGC_MODEL_TOOL_BENCHMARK','模型与工具基准','AIGC_01_DISCOVERY',50,'模型工具能力、成本、延迟、可靠性、权利与适配范围'),
  ('AIGC_CREATIVE_HYPOTHESIS','创作假设','AIGC_01_DISCOVERY',60,'由市场与参考证据形成、不得改写 Story Fact 的创作与分发假设'),
  ('AIGC_PRODUCTION_PLAN','制作计划','AIGC_02_PLAN',70,'层级、里程碑、依赖、资产覆盖、模型工具、预算、队列、审核与版本策略')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

CREATE TABLE IF NOT EXISTS aigc_ui_labels (
  label_type VARCHAR(32) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (label_type,stable_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-INIT','项目初始化门禁','ACTIVE'),
  ('GATE','G-AIGC-DISCOVERY','创意发现门禁','ACTIVE'),
  ('GATE','G-AIGC-PLAN','制作规划门禁','ACTIVE'),
  ('STATUS','PASS','通过','ACTIVE'),
  ('STATUS','HOLD','待处理','ACTIVE'),
  ('STATUS','BLOCKED','已阻塞','ACTIVE'),
  ('STATUS','DRAFT','草稿','ACTIVE'),
  ('STATUS','FROZEN','已冻结','ACTIVE'),
  ('STATUS','CURRENT','当前版本','ACTIVE'),
  ('STATUS','READY','就绪','ACTIVE'),
  ('STATUS','ACTIVE','进行中','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_project_initializations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  initialization_key VARCHAR(128) NOT NULL,
  work_title VARCHAR(512) NOT NULL,
  target_audience_json JSON NOT NULL,
  roles_json JSON NOT NULL,
  knowledge_sources_json JSON NOT NULL,
  asset_storage_json JSON NOT NULL,
  capability_environment_json JSON NOT NULL,
  budget_guardrail_json JSON NOT NULL,
  timeline_strategy_json JSON NOT NULL,
  rights_boundary_json JSON NOT NULL,
  format_delivery_json JSON NOT NULL,
  backup_archive_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  initialized_by_identity_id CHAR(36) NULL,
  initialized_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_init_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m281_init_identity FOREIGN KEY (initialized_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m281_init_key (project_id,initialization_key),
  INDEX idx_m281_init_status (project_id,status,initialized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_market_benchmarks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  benchmark_key VARCHAR(128) NOT NULL,
  platform VARCHAR(128) NOT NULL,
  market_region VARCHAR(128) NOT NULL,
  category_format VARCHAR(255) NOT NULL,
  work_creator_account_json JSON NOT NULL,
  publish_date DATE NULL,
  snapshot_date DATE NOT NULL,
  fresh_until DATE NOT NULL,
  observable_performance_json JSON NOT NULL,
  release_cadence_json JSON NOT NULL,
  audience_positioning_json JSON NOT NULL,
  structure_hook_json JSON NOT NULL,
  source_evidence_json JSON NOT NULL,
  insight_json JSON NOT NULL,
  limitation_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CURRENT',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_market_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m281_market_key (project_id,benchmark_key),
  INDEX idx_m281_market_freshness (project_id,status,fresh_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_creative_references (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  reference_key VARCHAR(128) NOT NULL,
  source_json JSON NOT NULL,
  rights_status VARCHAR(24) NOT NULL,
  reference_roles_json JSON NOT NULL,
  allowed_usage_json JSON NOT NULL,
  forbidden_copying_json JSON NOT NULL,
  attribution_provenance_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CURRENT',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_reference_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m281_reference_key (project_id,reference_key),
  INDEX idx_m281_reference_rights (project_id,status,rights_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_model_tool_benchmarks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  benchmark_key VARCHAR(128) NOT NULL,
  provider VARCHAR(128) NOT NULL,
  model_tool VARCHAR(255) NOT NULL,
  model_tool_version VARCHAR(128) NOT NULL,
  capability_json JSON NOT NULL,
  supported_reference_types_json JSON NOT NULL,
  output_limits_json JSON NOT NULL,
  controllability_json JSON NOT NULL,
  api_batch_queue_json JSON NOT NULL,
  cost_latency_reliability_json JSON NOT NULL,
  rights_terms_disclosure_json JSON NOT NULL,
  eval_date DATE NOT NULL,
  fresh_until DATE NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CURRENT',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_model_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m281_model_key (project_id,benchmark_key),
  INDEX idx_m281_model_freshness (project_id,status,fresh_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_creative_hypotheses (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  hypothesis_key VARCHAR(128) NOT NULL,
  hypothesis_type VARCHAR(32) NOT NULL,
  statement TEXT NOT NULL,
  benchmark_ids_json JSON NOT NULL,
  creative_reference_ids_json JSON NOT NULL,
  model_tool_benchmark_ids_json JSON NOT NULL,
  unknowns_json JSON NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  story_fact_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  decision_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_hypothesis_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m281_hypothesis_key (project_id,hypothesis_key),
  INDEX idx_m281_hypothesis_status (project_id,status,hypothesis_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_production_plans (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  project_hierarchy_json JSON NOT NULL,
  milestone_keys_json JSON NOT NULL,
  work_breakdown_json JSON NOT NULL,
  production_order_json JSON NOT NULL,
  dependency_json JSON NOT NULL,
  asset_coverage_plan_json JSON NOT NULL,
  model_tool_strategy_json JSON NOT NULL,
  budget_allocation_json JSON NOT NULL,
  batch_queue_concurrency_json JSON NOT NULL,
  human_review_points_json JSON NOT NULL,
  version_strategy_json JSON NOT NULL,
  localization_candidates_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'FROZEN',
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_plan_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m281_plan_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m281_plan_key (project_id,plan_key),
  INDEX idx_m281_plan_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_trace_links (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id CHAR(36) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id CHAR(36) NOT NULL,
  link_type VARCHAR(64) NOT NULL,
  evidence_json JSON NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_trace_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m281_trace_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m281_trace (project_id,source_type,source_id,target_type,target_id,link_type),
  INDEX idx_m281_trace_source (project_id,source_type,source_id),
  INDEX idx_m281_trace_target (project_id,target_type,target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m281_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m281_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m281_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m281_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
