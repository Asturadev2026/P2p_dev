-- Migration 004: add product catalog data to vendor onboarding
ALTER TABLE vendor_onboarding
    ADD COLUMN IF NOT EXISTS products_data JSONB DEFAULT '[]';
