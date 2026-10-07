-- AI Native Runtime V2.8 M28.8 Asset System / Master Creation
-- Migration: 053_aigc_asset_system.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_ASSET_LIBRARY','资产库','AIGC_06_ASSET',190,'项目资产库与工作区可复用资产库，包含权限、Rights、Usage Scope 与版本边界'),
  ('AIGC_ASSET_MASTER','正式资产与版本','AIGC_06_ASSET',200,'Identity、Look、Scene、Prop、UI、Action、Expression、Voice、Music、SFX、Style 等正式资产及不可覆盖版本'),
  ('AIGC_ASSET_CALL_SHEET','资产调用单','AIGC_06_ASSET',210,'正式资产生产前的 Source of Truth、Only Variable、Output Spec、Reference Role、QA、Fail Action、预算与目标路径'),
  ('AIGC_REFERENCE_INHERITANCE','参考继承','AIGC_06_ASSET',220,'结构化 Identity / Look / Scene / Style / Composition / Motion / First/Last Frame / Audio / Performance 参考继承'),
  ('AIGC_ASSET_REQUIREMENT_BINDING','资产需求绑定','AIGC_06_ASSET',230,'将 Shot Asset Requirement 绑定到正式资产版本或已通过 Preflight 的 Call Sheet')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-ASSET','资产系统门禁','ACTIVE'),
  ('ASSET_LIBRARY_SCOPE','PROJECT','项目资产库','ACTIVE'),
  ('ASSET_LIBRARY_SCOPE','WORKSPACE','工作区可复用资产库','ACTIVE'),
  ('ASSET_STATE','DRAFT','草稿','ACTIVE'),
  ('ASSET_STATE','READY','就绪','ACTIVE'),
  ('ASSET_STATE','GENERATING','生成中','ACTIVE'),
  ('ASSET_STATE','CANDIDATE','候选','ACTIVE'),
  ('ASSET_STATE','SELECTED','已选择','ACTIVE'),
  ('ASSET_STATE','PASS','质量通过','ACTIVE'),
  ('ASSET_STATE','CURRENT','当前版本','ACTIVE'),
  ('ASSET_STATE','LOCKED','已锁定','ACTIVE'),
  ('ASSET_STATE','FROZEN','已冻结','ACTIVE'),
  ('ASSET_STATE','BLOCKED','已阻塞','ACTIVE'),
  ('ASSET_STATE','REJECTED','已拒绝','ACTIVE'),
  ('ASSET_STATE','DEPRECATED','已废弃','ACTIVE'),
  ('REFERENCE_ROLE','IDENTITY','人物身份','ACTIVE'),
  ('REFERENCE_ROLE','LOOK','造型','ACTIVE'),
  ('REFERENCE_ROLE','SCENE','场景','ACTIVE'),
  ('REFERENCE_ROLE','STYLE','风格','ACTIVE'),
  ('REFERENCE_ROLE','COMPOSITION','构图','ACTIVE'),
  ('REFERENCE_ROLE','MOTION','动作','ACTIVE'),
  ('REFERENCE_ROLE','FIRST_FRAME','首帧','ACTIVE'),
  ('REFERENCE_ROLE','LAST_FRAME','尾帧','ACTIVE'),
  ('REFERENCE_ROLE','AUDIO','音频','ACTIVE'),
  ('REFERENCE_ROLE','PERFORMANCE','表演','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_asset_libraries (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  owner_project_id CHAR(36) NOT NULL,
  library_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  library_scope VARCHAR(24) NOT NULL,
  permission_policy_json JSON NOT NULL,
  rights_policy_json JSON NOT NULL,
  usage_scope_json JSON NOT NULL,
  version_policy_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_library_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m288_library_project FOREIGN KEY (owner_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_library_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m288_library_key (workspace_id,library_key),
  INDEX idx_m288_library_scope (workspace_id,library_scope,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_assets (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  owner_project_id CHAR(36) NOT NULL,
  library_id CHAR(36) NOT NULL,
  asset_key VARCHAR(160) NOT NULL,
  asset_type VARCHAR(48) NOT NULL,
  display_name VARCHAR(512) NOT NULL,
  purpose_json JSON NOT NULL,
  source_of_truth_json JSON NOT NULL,
  upstream_source_json JSON NOT NULL,
  immutable BOOLEAN NOT NULL DEFAULT FALSE,
  only_variable_json JSON NOT NULL,
  rights_json JSON NOT NULL,
  usage_scope_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_asset_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m288_asset_project FOREIGN KEY (owner_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_asset_library FOREIGN KEY (library_id) REFERENCES aigc_asset_libraries(id),
  CONSTRAINT fk_m288_asset_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m288_asset_key (workspace_id,asset_key),
  INDEX idx_m288_asset_type (workspace_id,asset_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_asset_versions (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  owner_project_id CHAR(36) NOT NULL,
  asset_id CHAR(36) NOT NULL,
  version_key VARCHAR(160) NOT NULL,
  version_no INT NOT NULL,
  content_locator_json JSON NOT NULL,
  output_spec_json JSON NOT NULL,
  required_views_json JSON NOT NULL,
  fingerprint_sha256 CHAR(64) NOT NULL,
  state VARCHAR(24) NOT NULL,
  qa_result_json JSON NOT NULL,
  parent_asset_version_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_version_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m288_version_project FOREIGN KEY (owner_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_version_asset FOREIGN KEY (asset_id) REFERENCES aigc_assets(id),
  CONSTRAINT fk_m288_version_parent FOREIGN KEY (parent_asset_version_id) REFERENCES aigc_asset_versions(id),
  CONSTRAINT fk_m288_version_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m288_asset_version_key (asset_id,version_key),
  UNIQUE KEY uq_m288_asset_version_no (asset_id,version_no),
  INDEX idx_m288_asset_version_state (asset_id,state,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_asset_call_sheets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  asset_requirement_id CHAR(36) NOT NULL,
  asset_id CHAR(36) NULL,
  call_sheet_key VARCHAR(180) NOT NULL,
  asset_type VARCHAR(48) NOT NULL,
  purpose_json JSON NOT NULL,
  source_of_truth_json JSON NOT NULL,
  upstream_source_json JSON NOT NULL,
  immutable BOOLEAN NOT NULL DEFAULT FALSE,
  only_variable_json JSON NOT NULL,
  output_spec_json JSON NOT NULL,
  required_views_json JSON NOT NULL,
  reference_roles_json JSON NOT NULL,
  forbidden_json JSON NOT NULL,
  qa_gate_json JSON NOT NULL,
  fail_action_json JSON NOT NULL,
  target_path VARCHAR(1024) NOT NULL,
  budget_guardrail_json JSON NOT NULL,
  preflight_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'READY',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_callsheet_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_callsheet_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m288_callsheet_req FOREIGN KEY (asset_requirement_id) REFERENCES aigc_shot_asset_requirements(id),
  CONSTRAINT fk_m288_callsheet_asset FOREIGN KEY (asset_id) REFERENCES aigc_assets(id),
  CONSTRAINT fk_m288_callsheet_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m288_callsheet_key (project_id,call_sheet_key),
  INDEX idx_m288_callsheet_req (asset_requirement_id,status,created_at),
  INDEX idx_m288_callsheet_status (project_id,status,asset_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_call_sheet_reference_bindings (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  call_sheet_id CHAR(36) NOT NULL,
  reference_asset_version_id CHAR(36) NOT NULL,
  reference_role VARCHAR(32) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  compatibility_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'READY',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_ref_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_ref_callsheet FOREIGN KEY (call_sheet_id) REFERENCES aigc_asset_call_sheets(id),
  CONSTRAINT fk_m288_ref_version FOREIGN KEY (reference_asset_version_id) REFERENCES aigc_asset_versions(id),
  UNIQUE KEY uq_m288_ref_role_version (call_sheet_id,reference_role,reference_asset_version_id),
  INDEX idx_m288_ref_role (call_sheet_id,reference_role,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_asset_requirement_bindings (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  asset_requirement_id CHAR(36) NOT NULL,
  resolution_type VARCHAR(24) NOT NULL,
  asset_version_id CHAR(36) NULL,
  call_sheet_id CHAR(36) NULL,
  binding_status VARCHAR(24) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  rights_approval_json JSON NOT NULL,
  usage_scope_json JSON NOT NULL,
  version_binding_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_binding_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_binding_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m288_binding_req FOREIGN KEY (asset_requirement_id) REFERENCES aigc_shot_asset_requirements(id),
  CONSTRAINT fk_m288_binding_version FOREIGN KEY (asset_version_id) REFERENCES aigc_asset_versions(id),
  CONSTRAINT fk_m288_binding_callsheet FOREIGN KEY (call_sheet_id) REFERENCES aigc_asset_call_sheets(id),
  CONSTRAINT fk_m288_binding_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  INDEX idx_m288_binding_req (asset_requirement_id,is_current,created_at),
  INDEX idx_m288_binding_status (project_id,binding_status,resolution_type,is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m288_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m288_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m288_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m288_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
