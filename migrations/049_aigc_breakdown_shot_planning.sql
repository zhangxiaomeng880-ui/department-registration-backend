-- AI Native Runtime V2.8 M28.5 Breakdown / Shot / Production Planning
-- Migration: 049_aigc_breakdown_shot_planning.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_BREAKDOWN_PLAN','制作拆解','AIGC_04_BREAKDOWN',110,'将锁定剧本拆成 Unit / Scene / Shot 的版本化制作计划'),
  ('AIGC_SHOT_PLAN','镜头规划','AIGC_04_BREAKDOWN',120,'镜头目的、表演、声音、摄影、时长、参考、生成策略、连续性、成本与 QA 标准'),
  ('AIGC_ASSET_REQUIREMENT_COVERAGE','资产需求与覆盖','AIGC_04_BREAKDOWN',130,'镜头级资产需求、来源、缺口、阻塞与覆盖矩阵'),
  ('AIGC_SHOT_READINESS','镜头生产就绪','AIGC_04_BREAKDOWN',140,'依据必需资产完整性计算可直接生产与阻塞镜头')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-BREAKDOWN','制作拆解门禁','ACTIVE'),
  ('SHOT_READINESS','READY','可直接生产','ACTIVE'),
  ('SHOT_READINESS','BLOCKED','缺失资产阻塞','ACTIVE'),
  ('ASSET_READINESS','READY','已具备','ACTIVE'),
  ('ASSET_READINESS','MISSING','缺失','ACTIVE'),
  ('ASSET_READINESS','PENDING','待确认','ACTIVE'),
  ('ASSET_READINESS','N_A','不适用','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_breakdown_plans (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  script_version_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  version_no INT NOT NULL,
  scene_start INT NOT NULL,
  scene_end INT NOT NULL,
  scene_count INT NOT NULL,
  unit_count INT NOT NULL,
  shot_count INT NOT NULL,
  asset_requirement_count INT NOT NULL,
  readiness_summary_json JSON NOT NULL,
  coverage_snapshot_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_breakdown_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_breakdown_script FOREIGN KEY (script_version_id) REFERENCES aigc_script_versions(id),
  CONSTRAINT fk_m285_breakdown_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m285_breakdown_key (project_id,plan_key),
  UNIQUE KEY uq_m285_breakdown_version (project_id,version_no),
  INDEX idx_m285_breakdown_current (project_id,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_units (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  unit_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  sequence_no INT NOT NULL,
  scene_start INT NOT NULL,
  scene_end INT NOT NULL,
  purpose_json JSON NOT NULL,
  continuity_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_unit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_unit_plan FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  UNIQUE KEY uq_m285_unit_key (breakdown_plan_id,unit_key),
  UNIQUE KEY uq_m285_unit_seq (breakdown_plan_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_scenes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  unit_id CHAR(36) NOT NULL,
  scene_key VARCHAR(128) NOT NULL,
  scene_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  script_scope_json JSON NOT NULL,
  location_time_json JSON NOT NULL,
  purpose_json JSON NOT NULL,
  continuity_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_scene_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_scene_plan FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m285_scene_unit FOREIGN KEY (unit_id) REFERENCES aigc_units(id),
  UNIQUE KEY uq_m285_scene_key (breakdown_plan_id,scene_key),
  UNIQUE KEY uq_m285_scene_no (breakdown_plan_id,scene_no),
  INDEX idx_m285_scene_unit (unit_id,scene_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_shots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  scene_id CHAR(36) NOT NULL,
  shot_key VARCHAR(160) NOT NULL,
  sequence_no INT NOT NULL,
  shot_purpose_json JSON NOT NULL,
  characters_looks_json JSON NOT NULL,
  scene_prop_ui_json JSON NOT NULL,
  action_expression_performance_json JSON NOT NULL,
  dialogue_voice_ost_sfx_json JSON NOT NULL,
  camera_json JSON NOT NULL,
  timing_json JSON NOT NULL,
  reference_requirements_json JSON NOT NULL,
  generation_strategy_json JSON NOT NULL,
  multi_format_json JSON NOT NULL,
  continuity_dependency_json JSON NOT NULL,
  priority_cost_retry_json JSON NOT NULL,
  qa_criteria_json JSON NOT NULL,
  readiness_status VARCHAR(16) NOT NULL,
  blocking_reasons_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_shot_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_shot_plan FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m285_shot_scene FOREIGN KEY (scene_id) REFERENCES aigc_scenes(id),
  UNIQUE KEY uq_m285_shot_key (breakdown_plan_id,shot_key),
  UNIQUE KEY uq_m285_shot_seq (scene_id,sequence_no),
  INDEX idx_m285_shot_ready (breakdown_plan_id,readiness_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_shot_asset_requirements (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  requirement_key VARCHAR(180) NOT NULL,
  requirement_type VARCHAR(48) NOT NULL,
  criticality VARCHAR(16) NOT NULL,
  readiness_status VARCHAR(16) NOT NULL,
  requirement_json JSON NOT NULL,
  source_ref_json JSON NULL,
  missing_reason TEXT NULL,
  revalidation_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_req_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_req_plan FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m285_req_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  UNIQUE KEY uq_m285_req_key (breakdown_plan_id,requirement_key),
  INDEX idx_m285_req_ready (shot_id,criticality,readiness_status),
  INDEX idx_m285_req_type (breakdown_plan_id,requirement_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m285_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m285_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m285_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m285_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
