-- AI Native Runtime V2.3 M23.4 Financial Adjustments / Revenue Assurance
-- Migration: 015_financial_adjustments.sql
-- Adds immutable invoice adjustments, payment refunds, billing disputes and dispute action history.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  adjustment_type VARCHAR(32) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  currency CHAR(3) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  source_dispute_id CHAR(36) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  effective_at TIMESTAMP(6) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m234_adjustment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m234_adjustment_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m234_adjustment_invoice_time (invoice_id,effective_at),
  INDEX idx_m234_adjustment_tenant_time (tenant_id,effective_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id CHAR(36) PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  currency CHAR(3) NOT NULL,
  refund_reference VARCHAR(191) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  refunded_at TIMESTAMP(6) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m234_refund_payment FOREIGN KEY (payment_id) REFERENCES invoice_payments(id),
  CONSTRAINT fk_m234_refund_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m234_refund_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m234_refund_payment_time (payment_id,refunded_at),
  INDEX idx_m234_refund_invoice_time (invoice_id,refunded_at),
  INDEX idx_m234_refund_tenant_time (tenant_id,refunded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS billing_disputes (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  disputed_amount DECIMAL(30,10) NOT NULL,
  accepted_amount DECIMAL(30,10) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  opened_at TIMESTAMP(6) NOT NULL,
  resolved_at TIMESTAMP(6) NULL,
  resolution_note VARCHAR(1000) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m234_dispute_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m234_dispute_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m234_dispute_invoice_status (invoice_id,status,opened_at),
  INDEX idx_m234_dispute_tenant_status (tenant_id,status,opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS billing_dispute_actions (
  id CHAR(36) PRIMARY KEY,
  dispute_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  amount DECIMAL(30,10) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  occurred_at TIMESTAMP(6) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m234_dispute_action_dispute FOREIGN KEY (dispute_id) REFERENCES billing_disputes(id),
  CONSTRAINT fk_m234_dispute_action_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m234_dispute_action_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m234_dispute_action_time (dispute_id,occurred_at),
  INDEX idx_m234_dispute_action_tenant_time (tenant_id,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
