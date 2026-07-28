-- 若早期 005 把 payload 建成了 JSONB，改为 TEXT 保留精确字节（HMAC 签名依赖）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_outbox' AND column_name = 'payload' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE webhook_outbox
      ALTER COLUMN payload TYPE TEXT USING payload::text;
  END IF;
END $$;
