-- 卡密内容元数据：支持图片/压缩包/PDF/任意文件等；密文仍在 content_enc
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS content_filename TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_mime TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_size BIGINT NOT NULL DEFAULT 0;
