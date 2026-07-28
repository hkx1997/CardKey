-- 2FA / 物化库存 / 异步导入 / 可选对象存储元数据

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS unused_count INT NOT NULL DEFAULT 0;

-- 回填可兑库存
UPDATE categories c SET unused_count = (
  SELECT COUNT(*)::int FROM cards
  WHERE category_id = c.id
    AND status = 'unused'
    AND (expires_at IS NULL OR expires_at > now())
);

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS storage_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT ''; -- ''=db, s3

CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  batch_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  card_type VARCHAR(32) NOT NULL DEFAULT 'text',
  raw_text TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|running|success|failed
  total_lines INT NOT NULL DEFAULT 0,
  done_lines INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  error_report TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs (status, created_at DESC);
