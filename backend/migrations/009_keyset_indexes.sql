-- keyset 分页：created_at + id 复合序

CREATE INDEX IF NOT EXISTS idx_cards_created_id
  ON cards (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_redeems_created_id_desc
  ON redeem_records (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_created_id
  ON audit_logs (created_at DESC, id DESC);
