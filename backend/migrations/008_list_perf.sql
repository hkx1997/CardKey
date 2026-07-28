-- 列表 / 看板分页性能索引（大表 OFFSET+ORDER BY created_at）

CREATE INDEX IF NOT EXISTS idx_cards_created
  ON cards (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_cat_created
  ON cards (category_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_batch_created
  ON cards (batch_id, created_at DESC)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batches_created
  ON batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_redeems_created_id
  ON redeem_records (created_at DESC, id);
