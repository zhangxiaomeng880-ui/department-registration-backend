-- AI Native 2.1 Policy Router v2
-- Migration: 005_policy_router_v2.sql
-- Additive only. Provider/model registry stores routing metadata only, never credentials.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS provider_registry (
  provider_key VARCHAR(128) PRIMARY KEY,
  provider_type VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  adapter_key VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(32) NOT NULL DEFAULT 'HEALTHY',
  priority INT NOT NULL DEFAULT 100,
  supports_structured_output BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_provider_enabled_health (enabled, health_status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS model_registry (
  provider_key VARCHAR(128) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quality_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
  latency_tier VARCHAR(32) NOT NULL DEFAULT 'BALANCED',
  cost_tier VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
  priority INT NOT NULL DEFAULT 100,
  capabilities_json JSON NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (provider_key, model_key),
  CONSTRAINT fk_model_provider FOREIGN KEY (provider_key) REFERENCES provider_registry(provider_key),
  INDEX idx_model_enabled_tiers (enabled, quality_tier, latency_tier, cost_tier, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS provider_health_events (
  id CHAR(36) PRIMARY KEY,
  provider_key VARCHAR(128) NOT NULL,
  previous_status VARCHAR(32) NULL,
  health_status VARCHAR(32) NOT NULL,
  reason_code VARCHAR(128) NULL,
  evidence_json JSON NULL,
  recorded_by VARCHAR(128) NOT NULL DEFAULT 'RUNTIME',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_health_provider FOREIGN KEY (provider_key) REFERENCES provider_registry(provider_key),
  INDEX idx_health_provider_created (provider_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE route_executions
  ADD COLUMN policy_mode VARCHAR(32) NULL AFTER policy_result,
  ADD COLUMN selected_provider_key VARCHAR(128) NULL AFTER policy_mode,
  ADD COLUMN selected_model_key VARCHAR(128) NULL AFTER selected_provider_key,
  ADD COLUMN selected_adapter_key VARCHAR(128) NULL AFTER selected_model_key,
  ADD COLUMN provider_health_status VARCHAR(32) NULL AFTER selected_adapter_key,
  ADD COLUMN fallback_chain_json JSON NULL AFTER provider_health_status,
  ADD INDEX idx_route_provider_model (selected_provider_key, selected_model_key, created_at),
  ADD INDEX idx_route_policy_mode (policy_mode, created_at);
