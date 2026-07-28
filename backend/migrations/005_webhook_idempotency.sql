-- 可靠 Webhook 投递 + 兑换幂等键（嵌入二进制，启动自动迁移）
-- payload 必须为 TEXT（精确字节），禁止 JSONB（会重排 key/空格导致 HMAC 与 body 不一致）

CREATE TABLE IF NOT EXISTS webhook_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event VARCHAR(64) NOT NULL DEFAULT 'redeem.success',
  target_url TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | success | failed | dead
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT NOT NULL DEFAULT '',
  last_status_code INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_outbox_due
  ON webhook_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- 兑换幂等：同一 client_key 在 TTL 内返回同一逻辑结果，不重复消耗
CREATE TABLE IF NOT EXISTS redeem_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key VARCHAR(128) NOT NULL,
  category_slug VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_key)
);

CREATE INDEX IF NOT EXISTS idx_redeem_idempotency_created
  ON redeem_idempotency (created_at);
