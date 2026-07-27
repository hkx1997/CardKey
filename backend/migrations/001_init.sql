-- CardKey schema v1
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  code_prefix VARCHAR(16) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  icon_kind VARCHAR(16) NOT NULL DEFAULT 'lucide',
  icon_value TEXT NOT NULL DEFAULT 'ticket',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name VARCHAR(128) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  content_enc BYTEA NOT NULL,
  content_nonce BYTEA NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  content_filename TEXT NOT NULL DEFAULT '',
  content_mime TEXT NOT NULL DEFAULT '',
  content_size BIGINT NOT NULL DEFAULT 0,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'unused',
  note TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  used_ip INET,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cards_cat_status_created
  ON cards (category_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_batch ON cards (batch_id);
CREATE INDEX IF NOT EXISTS idx_cards_used_at ON cards (used_at DESC)
  WHERE status = 'used';

CREATE TABLE IF NOT EXISTS redeem_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  card_id UUID NOT NULL UNIQUE REFERENCES cards(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  ip INET,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redeems_created ON redeem_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redeems_code ON redeem_records (code);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash BYTEA NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  is_system_redeem_key BOOLEAN NOT NULL DEFAULT false,
  rate_limit_rpm INT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type VARCHAR(16) NOT NULL,
  actor_label VARCHAR(128) NOT NULL DEFAULT '',
  action VARCHAR(64) NOT NULL,
  resource VARCHAR(128) NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
