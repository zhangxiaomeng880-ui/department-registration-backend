-- AI Native Runtime V2.3 M23.5 Finance Close / Reconciliation Export
-- Migration: 016_finance_close.sql
-- Adds immutable period close snapshots and deterministic export manifests.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS finance_close_periods (
  id CHAR(36) PRIMARY KEY,
  period_start TIMESTAMP(6) NOT NULL,
  period_end TIMESTAMP(6) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CLOSED',
  currency_count INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  source_label VARCHAR(255) NULL,
  metadata_json JSON NULL,
  closed_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_m235_close_period (period_start,period_end),
  INDEX idx_m235_close_end (status,period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS finance_close_currency_snapshots (
  close_id CHAR(36) NOT NULL,
  currency CHAR(3) NOT NULL,
  invoice_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  opening_ar DECIMAL(30,10) NOT NULL DEFAULT 0,
  opening_overpayment DECIMAL(30,10) NOT NULL DEFAULT 0,
  original_billed DECIMAL(30,10) NOT NULL DEFAULT 0,
  credit_notes DECIMAL(30,10) NOT NULL DEFAULT 0,
  debit_adjustments DECIMAL(30,10) NOT NULL DEFAULT 0,
  adjusted_billed_revenue DECIMAL(30,10) NOT NULL DEFAULT 0,
  write_offs DECIMAL(30,10) NOT NULL DEFAULT 0,
  gross_cash_collected DECIMAL(30,10) NOT NULL DEFAULT 0,
  refunds DECIMAL(30,10) NOT NULL DEFAULT 0,
  net_cash_collected DECIMAL(30,10) NOT NULL DEFAULT 0,
  ending_ar DECIMAL(30,10) NOT NULL DEFAULT 0,
  ending_overpayment DECIMAL(30,10) NOT NULL DEFAULT 0,
  provider_cost DECIMAL(30,10) NOT NULL DEFAULT 0,
  gross_margin DECIMAL(30,10) NOT NULL DEFAULT 0,
  reconciliation_delta DECIMAL(30,10) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (close_id,currency),
  CONSTRAINT fk_m235_snapshot_close FOREIGN KEY (close_id) REFERENCES finance_close_periods(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS finance_close_exports (
  id CHAR(36) PRIMARY KEY,
  close_id CHAR(36) NOT NULL,
  format VARCHAR(16) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  generated_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m235_export_close FOREIGN KEY (close_id) REFERENCES finance_close_periods(id),
  UNIQUE KEY uq_m235_export_format (close_id,format),
  INDEX idx_m235_export_close (close_id,generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
