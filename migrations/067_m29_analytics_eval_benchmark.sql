-- AI Native Runtime V2.9 M29.4 Analytics / Eval / Benchmark Integration
-- Migration: 067_m29_analytics_eval_benchmark.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('M29_ANALYTICS_SNAPSHOT','统一分析快照','M29_ANALYTICS_EVAL',800,'复用 Portfolio / Project / Production / M29 数据形成可审计分析快照'),
  ('M29_EVAL_BENCHMARK_BINDING','评测与能力基准绑定','M29_ANALYTICS_EVAL',810,'将 Model / Tool Benchmark 绑定到真实 Eval Run、可靠性快照与精确版本'),
  ('M29_ANALYTICS_EVAL_GATE','分析与评测门禁','M29_ANALYTICS_EVAL',820,'验证跨域分析、精确版本评测与 Benchmark 血缘完整性')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-M29-ANALYTICS-EVAL','分析 / 评测 / 能力基准门禁','ACTIVE'),
  ('M29_ANALYTICS_SCOPE','PROJECT','项目分析','ACTIVE'),
  ('M29_ANALYTICS_SCOPE','PORTFOLIO','项目组合分析','ACTIVE'),
  ('M29_ANALYTICS_SCOPE','PRODUCTION','生产分析','ACTIVE'),
  ('M29_BENCHMARK_TYPE','MODEL','模型基准','ACTIVE'),
  ('M29_BENCHMARK_TYPE','TOOL','工具基准','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS m29_analytics_snapshots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  snapshot_key VARCHAR(220) NOT NULL,
  window_start TIMESTAMP(6) NOT NULL,
  window_end TIMESTAMP(6) NOT NULL,
  project_analytics_json JSON NOT NULL,
  portfolio_analytics_json JSON NOT NULL,
  production_analytics_json JSON NOT NULL,
  data_analytics_json JSON NOT NULL,
  source_watermark_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PASS',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m294_analytics_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m294_snapshot_key (project_id,snapshot_key),
  INDEX idx_m294_snapshot_window (project_id,window_end,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_eval_benchmark_bindings (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  binding_key VARCHAR(220) NOT NULL,
  benchmark_run_id CHAR(36) NOT NULL,
  eval_run_id CHAR(36) NOT NULL,
  reliability_snapshot_id CHAR(36) NOT NULL,
  capability_key VARCHAR(320) NOT NULL,
  capability_type VARCHAR(32) NOT NULL,
  model_tool_version VARCHAR(160) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  exact_version_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'VERIFIED',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m294_binding_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m294_binding_benchmark FOREIGN KEY (benchmark_run_id) REFERENCES capability_benchmark_runs(id),
  CONSTRAINT fk_m294_binding_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m294_binding_reliability FOREIGN KEY (reliability_snapshot_id) REFERENCES eval_reliability_snapshots(id),
  UNIQUE KEY uq_m294_binding_key (project_id,binding_key),
  UNIQUE KEY uq_m294_binding_run (project_id,benchmark_run_id),
  INDEX idx_m294_binding_type (project_id,capability_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m29_analytics_eval_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m294_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m294_gate_latest (project_id,gate_key,as_of,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
