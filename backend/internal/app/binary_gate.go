package app

import (
	"fmt"
	"io"
	"os"
)

// MinLinuxSPABinaryBytes 含嵌入 SPA 的发布包下限（空壳约 11–12MB）。
const MinLinuxSPABinaryBytes int64 = 13_000_000

// assertLinuxBinaryOK 拒绝过小包与非 ELF（常见：下载失败得到 HTML 或空壳）。
func assertLinuxBinaryOK(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法读取下载文件: %w", err)
	}
	if st.Size() < MinLinuxSPABinaryBytes {
		return fmt.Errorf("更新包过小 (%d bytes)，疑似空壳或下载不完整（需要 ≥13MB 且含前端）", st.Size())
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var magic [4]byte
	if _, err := io.ReadFull(f, magic[:]); err != nil {
		return fmt.Errorf("无法读取文件头: %w", err)
	}
	// ELF: 0x7f 'E' 'L' 'F'
	if magic[0] != 0x7f || magic[1] != 'E' || magic[2] != 'L' || magic[3] != 'F' {
		return fmt.Errorf("更新包不是 Linux 可执行文件（文件头异常，可能下到了错误页）")
	}
	return nil
}
