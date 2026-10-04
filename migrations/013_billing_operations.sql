-- AI Native Runtime V2.3 M23.1 Billing Operations / Accounts Receivable
-- Migration: 013_billing_operations.sql
-- Adds operational payment receipts and invoice collection state without coupling to a payment processor.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE invoices
  ADD COLUMN amount_paid DECIMAL(30,10) NOT NULL DEFAULT 0 AFTER total_due,
  ADD COLUMN paid_at TIMESTAMP(6) NULL AFTER amount_paid,
  ADD INDEX idx_m231_invoice_receivable (tenant_id,status,due_at);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  currency CHAR(3) NOT NULL,
  payment_reference VARCHAR(191) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  received_at TIMESTAMP(6) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m231_payment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m231_payment_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m231_payment_invoice_received (invoice_id,received_at),
  INDEX idx_m231_payment_tenant_received (tenant_id,received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
