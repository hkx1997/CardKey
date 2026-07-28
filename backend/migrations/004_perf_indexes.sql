-- 性能索引：兑换/审计分页、卡密 ILIKE 搜索（pg_trgm）
-- 嵌入二进制，一键更新后启动自动应用

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 兑换记录：按类别分页 / 时间范围
CREATE INDEX IF NOT EXISTS idx_redeems_cat_created
  ON redeem_records (category_id, created_at DESC);

-- 审计：按动作筛选 + 时间
CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON audit_logs (action, created_at DESC);

-- 卡密搜索 code / note（ILIKE %x% 走 GIN trgm）
CREATE INDEX IF NOT EXISTS idx_cards_code_trgm
  ON cards USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_note_trgm
  ON cards USING gin (note gin_trgm_ops);

-- 库存统计：status + category 高频过滤
CREATE INDEX IF NOT EXISTS idx_cards_status_cat
  ON cards (status, category_id)
  WHERE status = 'unused';
