-- AI Native 2.1 Cost Ledger
-- Migration: 006_cost_ledger.sql
-- Backward-compatible schema extension. Pricing is versioned metadata; no charging/payment behavior.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS pricing_versions (
  id CHAR(36) PRIMARY KEY,
  provider_key VARCHAR(128) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  input_rate_per_million DECIMAL(20,8) NOT NULL,
  output_rate_per_million DECIMAL(20,8) NOT NULL,
  effective_from TIMESTAMP(6) NOT NULL,
  source_label VARCHAR(255) NOT NULL,
  source_uri VARCHAR(1024) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_price_model FOREIGN KEY (provider_key, model_key)
    REFERENCES model_registry(provider_key, model_key),
  UNIQUE KEY uq_price_effective (provider_key, model_key, effective_from),
  INDEX idx_price_lookup (provider_key, model_key, effective_from, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE usage_ledger
  ADD COLUMN pricing_version_id CHAR(36) NULL AFTER model_key,
  ADD COLUMN cost_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN' AFTER pricing_version_id,
  ADD COLUMN estimated_cost DECIMAL(20,10) NULL AFTER cost_status,
  ADD COLUMN cost_currency CHAR(3) NULL AFTER estimated_cost,
  ADD CONSTRAINT fk_usage_price_version FOREIGN KEY (pricing_version_id) REFERENCES pricing_versions(id),
  ADD INDEX idx_usage_cost_status (cost_status, recorded_at),
  ADD INDEX idx_usage_pricing_version (pricing_version_id, recorded_at);

ALTER TABLE tool_executions
  MODIFY COLUMN cost_amount DECIMAL(18,6) NULL,
  MODIFY COLUMN cost_currency CHAR(3) NULL,
  ADD COLUMN pricing_version_id CHAR(36) NULL AFTER model_key,
  ADD COLUMN cost_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN' AFTER pricing_version_id,
  ADD CONSTRAINT fk_tool_price_version FOREIGN KEY (pricing_version_id) REFERENCES pricing_versions(id),
  ADD INDEX idx_tool_cost_status (cost_status, created_at);

CREATE TABLE IF NOT EXISTS project_budget_policies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  policy_key VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  run_limit_amount DECIMAL(20,8) NULL,
  project_limit_amount DECIMAL(20,8) NULL,
  action_on_exceed VARCHAR(32) NOT NULL DEFAULT 'HOLD',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_budget_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_budget_project_policy (project_id, policy_key),
  INDEX idx_budget_project_enabled (project_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
