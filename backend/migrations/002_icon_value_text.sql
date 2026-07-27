-- 类别图标支持 data URL / 长 URL（原 VARCHAR(128) 过短导致创建失败）
ALTER TABLE categories
  ALTER COLUMN icon_value TYPE TEXT;
