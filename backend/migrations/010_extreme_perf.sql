-- 极致性能：物化 used/card 计数、过期扫描索引

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS used_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_count INT NOT NULL DEFAULT 0;

-- 回填
UPDATE categories c SET
  card_count = COALESCE((SELECT COUNT(*)::int FROM cards WHERE category_id = c.id), 0),
  used_count = COALESCE((SELECT COUNT(*)::int FROM cards WHERE category_id = c.id AND status = 'used'), 0),
  unused_count = COALESCE((
    SELECT COUNT(*)::int FROM cards
    WHERE category_id = c.id AND status = 'unused'
      AND (expires_at IS NULL OR expires_at > now())
  ), 0);

-- 未使用且设了过期时间：过期任务 / 懒过期扫描
CREATE INDEX IF NOT EXISTS idx_cards_expire_unused
  ON cards (expires_at)
  WHERE status = 'unused' AND expires_at IS NOT NULL;
