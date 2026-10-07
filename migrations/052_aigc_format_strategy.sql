-- AI Native Runtime V2.8 M28.7 AIGC Format / Audio / Distribution Strategy
-- Migration: 052_aigc_format_strategy.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_VISUAL_FORMAT','视觉格式','AIGC_05_FORMAT',150,'母版画幅、分辨率、帧率、安全区、裁切/重构、字幕安全区与首尾帧要求'),
  ('AIGC_AUDIO_STRATEGY','音频策略','AIGC_05_FORMAT',160,'对白、Voice Master、音乐/OST、音效/环境声、轨道分离、响度/导出与权利策略'),
  ('AIGC_DISTRIBUTION_STRATEGY','分发策略','AIGC_05_FORMAT',170,'候选渠道、市场、语言、本地化级别、平台规格、AI 披露与权利边界')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-FORMAT','格式与分发策略门禁','ACTIVE'),
  ('LOCALIZATION_LEVEL','NONE','不本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','SUBTITLE','字幕本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','COPY_LOCALIZATION','文案本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','DUB','配音本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','RE_EDIT','重新剪辑','ACTIVE'),
  ('LOCALIZATION_LEVEL','RE_COMPOSE','重新构图','ACTIVE'),
  ('LOCALIZATION_LEVEL','MULTI','组合本地化','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_format_strategies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  strategy_key VARCHAR(160) NOT NULL,
  version_no INT NOT NULL,
  visual_format_json JSON NOT NULL,
  audio_strategy_json JSON NOT NULL,
  distribution_summary_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_format_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_format_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m287_format_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m287_format_key (project_id,strategy_key),
  UNIQUE KEY uq_m287_format_version (project_id,version_no),
  INDEX idx_m287_format_current (project_id,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_distribution_targets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  format_strategy_id CHAR(36) NOT NULL,
  target_key VARCHAR(160) NOT NULL,
  channel VARCHAR(128) NOT NULL,
  market_region VARCHAR(128) NOT NULL,
  language VARCHAR(64) NOT NULL,
  localization_level VARCHAR(32) NOT NULL,
  platform_spec_json JSON NOT NULL,
  ai_disclosure_json JSON NOT NULL,
  rights_boundary_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_target_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_target_strategy FOREIGN KEY (format_strategy_id) REFERENCES aigc_format_strategies(id),
  UNIQUE KEY uq_m287_target_key (format_strategy_id,target_key),
  INDEX idx_m287_target_scope (project_id,status,channel,market_region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m287_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m287_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
