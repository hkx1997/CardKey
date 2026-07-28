package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// ObjectStorage 可选本地对象存储（大文件卡密落盘，DB 仅 meta）。
// 配置：OBJECT_STORAGE_DIR 非空则启用（相对 DATA_DIR 或绝对路径）。
func (a *App) objectStorageDir() string {
	d := strings.TrimSpace(os.Getenv("OBJECT_STORAGE_DIR"))
	if d == "" {
		return ""
	}
	if filepath.IsAbs(d) {
		return d
	}
	base := a.DataDir
	if base == "" {
		base = "./data"
	}
	return filepath.Join(base, d)
}

// StoreObject 写入对象，返回 storage_key（相对 key）。
func (a *App) StoreObject(categoryID string, data []byte, filename string) (key string, err error) {
	dir := a.objectStorageDir()
	if dir == "" {
		return "", fmt.Errorf("object storage disabled")
	}
	key = filepath.ToSlash(filepath.Join(categoryID, uuid.NewString()+"_"+filepath.Base(filename)))
	full := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(full, data, 0o600); err != nil {
		return "", err
	}
	return key, nil
}

// LoadObject 读取对象字节。
func (a *App) LoadObject(key string) ([]byte, error) {
	dir := a.objectStorageDir()
	if dir == "" || key == "" {
		return nil, fmt.Errorf("object storage disabled")
	}
	// 防路径穿越
	key = filepath.ToSlash(key)
	if strings.Contains(key, "..") {
		return nil, fmt.Errorf("invalid key")
	}
	full := filepath.Join(dir, filepath.FromSlash(key))
	return os.ReadFile(full)
}

// ObjectStorageEnabled 是否启用。
func (a *App) ObjectStorageEnabled() bool {
	return a.objectStorageDir() != ""
}
