-- AI Native Runtime V2.2 M22.1 Commercial Pricing Catalog
-- Migration: 007_commercial_pricing_catalog.sql
-- Additive extension. Existing V2.1 pricing and usage history remain immutable.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE pricing_versions
  ADD COLUMN service_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD' AFTER model_key,
  ADD COLUMN cached_input_rate_per_million DECIMAL(20,8) NULL AFTER input_rate_per_million,
  ADD COLUMN cache_write_rate_per_million DECIMAL(20,8) NULL AFTER cached_input_rate_per_million,
  ADD COLUMN long_context_threshold_tokens BIGINT UNSIGNED NULL AFTER output_rate_per_million,
  ADD COLUMN long_context_input_rate_per_million DECIMAL(20,8) NULL AFTER long_context_threshold_tokens,
  ADD COLUMN long_context_cached_input_rate_per_million DECIMAL(20,8) NULL AFTER long_context_input_rate_per_million,
  ADD COLUMN long_context_cache_write_rate_per_million DECIMAL(20,8) NULL AFTER long_context_cached_input_rate_per_million,
  ADD COLUMN long_context_output_rate_per_million DECIMAL(20,8) NULL AFTER long_context_cache_write_rate_per_million,
  ADD COLUMN formula_version VARCHAR(64) NOT NULL DEFAULT 'TOKEN_COST_V1' AFTER long_context_output_rate_per_million,
  DROP INDEX uq_price_effective,
  ADD UNIQUE KEY uq_price_effective_tier (provider_key, model_key, service_tier, effective_from),
  ADD INDEX idx_price_lookup_v2 (provider_key, model_key, service_tier, effective_from, status);

ALTER TABLE runs
  MODIFY COLUMN cost_amount DECIMAL(20,10) NOT NULL DEFAULT 0;

ALTER TABLE tool_executions
  MODIFY COLUMN cost_amount DECIMAL(20,10) NULL,
  ADD COLUMN service_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD' AFTER model_key,
  ADD COLUMN context_band VARCHAR(16) NULL AFTER cost_status,
  ADD COLUMN cached_input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER token_input,
  ADD COLUMN cache_write_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER cached_input_tokens,
  ADD COLUMN regional_uplift_bps INT UNSIGNED NOT NULL DEFAULT 0 AFTER cost_currency,
  ADD COLUMN cost_formula_version VARCHAR(64) NULL AFTER regional_uplift_bps,
  ADD INDEX idx_tool_pricing_dimensions (provider_key, model_key, service_tier, created_at);

ALTER TABLE usage_ledger
  ADD COLUMN service_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD' AFTER model_key,
  ADD COLUMN context_band VARCHAR(16) NULL AFTER cost_status,
  ADD COLUMN cached_input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER token_input,
  ADD COLUMN cache_write_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER cached_input_tokens,
  ADD COLUMN regional_uplift_bps INT UNSIGNED NOT NULL DEFAULT 0 AFTER cost_currency,
  ADD COLUMN cost_formula_version VARCHAR(64) NULL AFTER regional_uplift_bps,
  ADD INDEX idx_usage_pricing_dimensions (provider_key, model_key, service_tier, recorded_at);
