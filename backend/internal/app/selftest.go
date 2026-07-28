package app

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// RunBinarySelfTest 在替换前用 CARDKEY_SELFTEST=1 试跑新二进制（不连库、不监听）。
// 拒绝配置校验失败或明显空壳 SPA 的包，避免一键更新后 502。
func RunBinarySelfTest(binPath string) error {
	binPath = strings.TrimSpace(binPath)
	if binPath == "" {
		return fmt.Errorf("empty binary path")
	}
	if err := assertLinuxBinaryOK(binPath); err != nil {
		// Windows 开发机可能测不到 ELF；仅当文件头像 Linux 包时强制
		// assertLinuxBinaryOK 已覆盖生产更新路径
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binPath)
	env := os.Environ()
	// 清理可能干扰的 re-exec
	filtered := make([]string, 0, len(env)+2)
	for _, e := range env {
		if strings.HasPrefix(e, "CARDKEY_SELFTEST=") || strings.HasPrefix(e, "CARDKEY_NO_AUTO_ROLLBACK=") {
			continue
		}
		filtered = append(filtered, e)
	}
	filtered = append(filtered, "CARDKEY_SELFTEST=1", "CARDKEY_NO_AUTO_ROLLBACK=1")
	cmd.Env = filtered
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String() + " " + stdout.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("新二进制自检失败: %s", msg)
	}
	out := stdout.String() + stderr.String()
	if !strings.Contains(out, "SELFTEST_OK") {
		return fmt.Errorf("新二进制自检无 SELFTEST_OK 输出（可能过旧或不完整）")
	}
	return nil
}
