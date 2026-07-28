package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/cardkey/cardkey/internal/version"
)

type UpdateCheckResult struct {
	Current     string `json:"current"`
	Latest      string `json:"latest,omitempty"`
	HasUpdate   bool   `json:"hasUpdate"`
	ReleaseURL  string `json:"releaseUrl,omitempty"`
	Body        string `json:"body,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
	Mode        string `json:"mode"`
	Message     string `json:"message,omitempty"`
	// FromCache 为 true 表示命中进程内缓存（避免反复打 GitHub）
	FromCache bool `json:"fromCache,omitempty"`
	// Authenticated 是否使用了 UPDATE_GITHUB_TOKEN（可选，检测默认不依赖）
	Authenticated bool `json:"authenticated,omitempty"`
	// TokenRecommended 仅在限流/需 API 失败时为 true，前端再提示配置 Token
	TokenRecommended bool `json:"tokenRecommended,omitempty"`
}

// 检测结果缓存（对齐 sub2api：长缓存 + 失败用缓存降级，避免反复打 api.github.com）
const updateCheckCacheTTL = 20 * time.Minute
const updateRedisCacheKey = "cardkey:update_check_cache"

type updateCheckCache struct {
	at     time.Time
	result UpdateCheckResult
}

type UpdateHistoryItem struct {
	Version   string `json:"version"`
	Path      string `json:"path,omitempty"`
	ModTime   string `json:"modTime,omitempty"`
	IsCurrent bool   `json:"isCurrent"`
}

type UpdateStatus struct {
	State   string `json:"state"` // idle|checking|downloading|verifying|applying|restarting|failed
	Message string `json:"message,omitempty"`
	Progress int   `json:"progress"`
	Error   string `json:"error,omitempty"`
}

type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func (a *App) GetUpdateStatus() UpdateStatus {
	a.updateMu.RLock()
	defer a.updateMu.RUnlock()
	return a.updateStatus
}

func (a *App) setUpdateStatus(s UpdateStatus) {
	a.updateMu.Lock()
	a.updateStatus = s
	a.updateMu.Unlock()
}

func (a *App) CheckUpdates(ctx context.Context) (UpdateCheckResult, error) {
	return a.CheckUpdatesOpt(ctx, false)
}

// CheckUpdatesOpt force=true 时跳过缓存并清空 Redis 检测缓存。
func (a *App) CheckUpdatesOpt(ctx context.Context, force bool) (UpdateCheckResult, error) {
	// 对齐 sub2api：检测接口永不因 GitHub 限流返回 5xx；多源取最高版本 + 缓存结果校正
	mode := a.UpdateMode
	if mode == "" {
		mode = "disabled"
	}
	cur := normalizeVer(version.Version)
	out := UpdateCheckResult{
		Current:       cur,
		Latest:        cur,
		Mode:          mode,
		Authenticated: strings.TrimSpace(a.UpdateGitHubToken) != "",
	}
	if mode == "disabled" || !a.UpdateEnabled {
		out.Message = "在线更新未启用（UPDATE_MODE=disabled）"
		return out, nil
	}
	if a.UpdateGitHubOwner == "" || a.UpdateGitHubRepo == "" {
		out.Message = "未配置 UPDATE_GITHUB_OWNER / UPDATE_GITHUB_REPO"
		return out, nil
	}

	if force {
		a.clearUpdateCheckCache()
	} else if cached, ok := a.getUpdateCheckCache(cur, mode); ok {
		return finalizeUpdateResult(cached, cur, mode, true), nil
	}

	// 多源探测后取 semver 最高者（避免 raw/atom/旧缓存指到比当前更旧的版本却仍提示更新）
	type cand struct {
		ver, url, src string
	}
	var cands []cand
	var lastErr error

	if ver, err := a.fetchVersionFromRaw(ctx); err == nil && ver != "" {
		cands = append(cands, cand{
			ver: normalizeVer(ver),
			url: fmt.Sprintf("https://github.com/%s/%s/releases", a.UpdateGitHubOwner, a.UpdateGitHubRepo),
			src: "raw",
		})
	} else if err != nil {
		lastErr = err
	}
	if tag, url, err := a.fetchLatestTagFromAtom(ctx); err == nil && tag != "" {
		cands = append(cands, cand{ver: normalizeVer(tag), url: url, src: "atom"})
	} else if err != nil {
		lastErr = err
	}
	if tag, url, err := a.fetchLatestTagViaRedirect(ctx); err == nil && tag != "" {
		cands = append(cands, cand{ver: normalizeVer(tag), url: url, src: "redirect"})
	} else if err != nil {
		lastErr = err
	}
	if out.Authenticated {
		if rel, err := a.fetchLatestRelease(ctx); err == nil && rel != nil {
			c := cand{ver: normalizeVer(rel.TagName), url: rel.HTMLURL, src: "api"}
			cands = append(cands, c)
			out.Body = rel.Body
			if !rel.PublishedAt.IsZero() {
				out.PublishedAt = rel.PublishedAt.UTC().Format(time.RFC3339)
			}
		} else if err != nil {
			lastErr = err
		}
	}

	var latest, htmlURL, src string
	for _, c := range cands {
		if c.ver == "" {
			continue
		}
		if latest == "" || semverGreater(c.ver, latest) || (!semverGreater(latest, c.ver) && c.ver == latest && htmlURL == "") {
			if latest == "" || semverGreater(c.ver, latest) {
				latest, htmlURL, src = c.ver, c.url, c.src
			} else if c.url != "" && htmlURL == "" {
				htmlURL = c.url
			}
		}
	}

	if latest == "" {
		if cached, ok := a.getUpdateCheckCacheStale(cur, mode); ok {
			cached = finalizeUpdateResult(cached, cur, mode, true)
			cached.Message = "远端暂不可达，已用缓存并按当前版本校正"
			if lastErr != nil {
				cached.Message += "（" + shortErr(lastErr) + "）"
			}
			return cached, nil
		}
		out.Message = "暂时无法获取远端版本。Docker 部署请在服务器执行：bash scripts/upgrade.sh"
		if lastErr != nil {
			out.Message += " 详情：" + shortErr(lastErr)
		}
		out.TokenRecommended = !out.Authenticated
		return out, nil
	}

	out.Latest = latest
	out.ReleaseURL = htmlURL
	out = finalizeUpdateResult(out, cur, mode, false)
	if src != "" && a.Log != nil {
		a.Log.Info("update check ok", "source", src, "latest", latest, "current", cur, "hasUpdate", out.HasUpdate)
	}

	a.setUpdateCheckCache(out)
	return out, nil
}

// finalizeUpdateResult 按当前版本重算 HasUpdate / Message，避免缓存文案与真实比较不一致。
func finalizeUpdateResult(in UpdateCheckResult, cur, mode string, fromCache bool) UpdateCheckResult {
	out := in
	out.Current = normalizeVer(cur)
	out.Latest = normalizeVer(out.Latest)
	if out.Latest == "" {
		out.Latest = out.Current
	}
	out.Mode = mode
	out.HasUpdate = semverGreater(out.Latest, out.Current)
	out.FromCache = fromCache
	// 远端更旧：不当作更新
	if out.Latest != "" && semverGreater(out.Current, out.Latest) {
		out.HasUpdate = false
		out.Message = "当前版本已新于远端记录（v" + out.Latest + "），无需更新"
	} else if out.HasUpdate {
		out.Message = "发现新版本 v" + out.Latest +
			"。一键更新会下载 Linux 二进制（内嵌 DB 迁移），替换后重启并自动执行未应用的 SQL；数据卷不删。" +
			" 也可用：bash scripts/upgrade.sh v" + out.Latest
		out.ReleaseURL = strings.TrimSpace(out.ReleaseURL)
	} else {
		out.Message = "已是最新版本（内嵌迁移已在启动时校验）"
	}
	if fromCache {
		if !strings.Contains(out.Message, "缓存") {
			out.Message += " · 缓存"
		}
	}
	return out
}

func (a *App) clearUpdateCheckCache() {
	a.updateCheckCacheMu.Lock()
	a.updateCheckCache = nil
	a.updateCheckCacheMu.Unlock()
	if a.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = a.RDB.Del(ctx, updateRedisCacheKey).Err()
		cancel()
	}
}

func shortErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	// 去掉 GitHub 限流原文 JSON
	if strings.Contains(strings.ToLower(s), "rate limit") || strings.Contains(s, "API rate limit") {
		return "GitHub 限流"
	}
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

func (a *App) getUpdateCheckCache(cur, mode string) (UpdateCheckResult, bool) {
	// 内存：只关心 latest 是否仍有效，current/hasUpdate 返回前校正
	a.updateCheckCacheMu.Lock()
	c := a.updateCheckCache
	if c != nil && time.Since(c.at) <= updateCheckCacheTTL && c.result.Mode == mode && c.result.Latest != "" {
		out := c.result
		a.updateCheckCacheMu.Unlock()
		return finalizeUpdateResult(out, cur, mode, true), true
	}
	a.updateCheckCacheMu.Unlock()

	if a.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		raw, err := a.RDB.Get(ctx, updateRedisCacheKey).Result()
		if err == nil && raw != "" {
			var out UpdateCheckResult
			if json.Unmarshal([]byte(raw), &out) == nil && out.Latest != "" {
				// mode 不一致也可用 latest 数字
				out = finalizeUpdateResult(out, cur, mode, true)
				a.setUpdateCheckCacheMem(out)
				return out, true
			}
		}
	}
	return UpdateCheckResult{}, false
}

// getUpdateCheckCacheStale 失败降级：允许过期缓存（最多 24h）
func (a *App) getUpdateCheckCacheStale(cur, mode string) (UpdateCheckResult, bool) {
	a.updateCheckCacheMu.Lock()
	defer a.updateCheckCacheMu.Unlock()
	c := a.updateCheckCache
	if c == nil || c.result.Latest == "" {
		return UpdateCheckResult{}, false
	}
	if time.Since(c.at) > 24*time.Hour {
		return UpdateCheckResult{}, false
	}
	return finalizeUpdateResult(c.result, cur, mode, true), true
}

func (a *App) setUpdateCheckCacheMem(r UpdateCheckResult) {
	a.updateCheckCacheMu.Lock()
	defer a.updateCheckCacheMu.Unlock()
	cp := r
	cp.FromCache = false
	a.updateCheckCache = &updateCheckCache{at: time.Now(), result: cp}
}

func (a *App) setUpdateCheckCache(r UpdateCheckResult) {
	a.setUpdateCheckCacheMem(r)
	if a.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		cp := r
		cp.FromCache = false
		if b, err := json.Marshal(cp); err == nil {
			_ = a.RDB.Set(ctx, updateRedisCacheKey, string(b), updateCheckCacheTTL).Err()
		}
	}
}

// fetchVersionFromRaw 读仓库 main/VERSION（raw.githubusercontent.com，不走 API 限流）
func (a *App) fetchVersionFromRaw(ctx context.Context) (string, error) {
	// 依次尝试 main / master
	refs := []string{"main", "master"}
	client := &http.Client{Timeout: 12 * time.Second}
	var last error
	for _, ref := range refs {
		u := fmt.Sprintf(
			"https://raw.githubusercontent.com/%s/%s/%s/VERSION",
			a.UpdateGitHubOwner, a.UpdateGitHubRepo, ref,
		)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			last = err
			continue
		}
		req.Header.Set("User-Agent", "CardKey-Updater")
		req.Header.Set("Accept", "text/plain")
		resp, err := client.Do(req)
		if err != nil {
			last = err
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
		_ = resp.Body.Close()
		if resp.StatusCode != 200 {
			last = fmt.Errorf("VERSION HTTP %d", resp.StatusCode)
			continue
		}
		ver := normalizeVer(strings.TrimSpace(string(b)))
		if ver == "" || strings.Contains(ver, "<") {
			last = fmt.Errorf("invalid VERSION body")
			continue
		}
		return ver, nil
	}
	if last == nil {
		last = fmt.Errorf("VERSION not found")
	}
	return "", last
}

// fetchLatestTagFromAtom 解析 GitHub releases.atom（不走 REST API）
func (a *App) fetchLatestTagFromAtom(ctx context.Context) (tag, htmlURL string, err error) {
	u := fmt.Sprintf("https://github.com/%s/%s/releases.atom", a.UpdateGitHubOwner, a.UpdateGitHubRepo)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "CardKey-Updater")
	req.Header.Set("Accept", "application/atom+xml, application/xml, text/xml, */*")
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("atom HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", "", err
	}
	s := string(body)
	// 找第一条 entry 的 link href=.../releases/tag/vX
	const marker = "/releases/tag/"
	idx := strings.Index(s, marker)
	if idx < 0 {
		// 仓库尚无 Release
		return "", "", fmt.Errorf("no release entries in atom")
	}
	// 向前找 href 起始
	start := idx
	for start > 0 && s[start] != '"' && s[start] != '\'' {
		start--
	}
	quote := byte('"')
	if start >= 0 && (s[start] == '"' || s[start] == '\'') {
		quote = s[start]
		start++
	} else {
		start = idx
	}
	end := start
	for end < len(s) && s[end] != quote && s[end] != ' ' && s[end] != '<' {
		end++
	}
	link := s[start:end]
	if !strings.HasPrefix(link, "http") {
		if strings.HasPrefix(link, "/") {
			link = "https://github.com" + link
		} else {
			link = "https://github.com/" + link
		}
	}
	tag = extractReleaseTag(link)
	if tag == "" {
		// 尝试从 <title>v0.1.3</title> 在第一个 entry
		if i := strings.Index(s, "<entry>"); i >= 0 {
			sub := s[i:]
			if t1 := strings.Index(sub, "<title>"); t1 >= 0 {
				t2 := strings.Index(sub[t1+7:], "</title>")
				if t2 > 0 {
					tag = normalizeVer(strings.TrimSpace(sub[t1+7 : t1+7+t2]))
				}
			}
		}
	}
	if tag == "" {
		return "", "", fmt.Errorf("cannot parse atom tag")
	}
	return tag, link, nil
}

// fetchLatestTagViaRedirect 利用 github.com/.../releases/latest 的 302，无需 API Token。
func (a *App) fetchLatestTagViaRedirect(ctx context.Context) (tag, htmlURL string, err error) {
	u := fmt.Sprintf("https://github.com/%s/%s/releases/latest", a.UpdateGitHubOwner, a.UpdateGitHubRepo)
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", "", err
	}
	// 模拟浏览器，减少被当成爬虫拦截
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CardKey-Updater/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	loc := resp.Header.Get("Location")
	if loc == "" && resp.Request != nil {
		loc = resp.Request.URL.String()
	}
	if loc == "" {
		return "", "", fmt.Errorf("no redirect from releases/latest (status %d)", resp.StatusCode)
	}
	tag = extractReleaseTag(loc)
	if tag == "" {
		return "", "", fmt.Errorf("cannot parse tag from %s", loc)
	}
	if strings.HasPrefix(loc, "http") {
		htmlURL = loc
	} else {
		htmlURL = "https://github.com" + loc
	}
	return tag, htmlURL, nil
}

func extractReleaseTag(loc string) string {
	const marker = "/releases/tag/"
	i := strings.Index(loc, marker)
	if i < 0 {
		return ""
	}
	tag := loc[i+len(marker):]
	if j := strings.IndexAny(tag, "?#\"'"); j >= 0 {
		tag = tag[:j]
	}
	tag = strings.Trim(tag, "/")
	return tag
}

func (a *App) ListUpdateHistory() ([]UpdateHistoryItem, error) {
	cur := normalizeVer(version.Version)
	dir := a.UpdateReleasesDir
	if dir == "" {
		return []UpdateHistoryItem{{Version: cur, IsCurrent: true}}, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []UpdateHistoryItem{{Version: cur, IsCurrent: true}}, nil
		}
		return nil, err
	}
	var items []UpdateHistoryItem
	seen := map[string]bool{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			ver := normalizeVer(name)
			p := filepath.Join(dir, name, "cardkey")
			if _, err := os.Stat(p); err != nil {
				continue
			}
			info, _ := e.Info()
			mt := ""
			if info != nil {
				mt = info.ModTime().UTC().Format(time.RFC3339)
			}
			items = append(items, UpdateHistoryItem{
				Version: ver, Path: p, ModTime: mt, IsCurrent: ver == cur,
			})
			seen[ver] = true
			continue
		}
		if strings.HasPrefix(name, "cardkey-") {
			ver := normalizeVer(strings.TrimPrefix(name, "cardkey-"))
			p := filepath.Join(dir, name)
			info, _ := e.Info()
			mt := ""
			if info != nil {
				mt = info.ModTime().UTC().Format(time.RFC3339)
			}
			items = append(items, UpdateHistoryItem{
				Version: ver, Path: p, ModTime: mt, IsCurrent: ver == cur,
			})
			seen[ver] = true
		}
	}
	if !seen[cur] {
		items = append(items, UpdateHistoryItem{Version: cur, IsCurrent: true})
	}
	sort.Slice(items, func(i, j int) bool {
		return semverGreater(items[i].Version, items[j].Version)
	})
	return items, nil
}

// canApplyUpdate docker / binary 均可在线替换可执行文件后退出，由 Docker restart / systemd 拉起。
func (a *App) canApplyUpdate() bool {
	if !a.UpdateEnabled {
		return false
	}
	switch a.UpdateMode {
	case "binary", "docker":
		return true
	default:
		return false
	}
}

// persistentBinaryPath Docker 数据卷上的持久二进制（重建容器后 entrypoint 仍可启动）
func (a *App) persistentBinaryPath() string {
	if a.DataDir == "" {
		return ""
	}
	return filepath.Join(a.DataDir, "bin", "cardkey")
}

func (a *App) currentBinaryPath() (string, error) {
	// 始终优先当前进程真实路径（Docker 入口 /app/cardkey 或 data/bin/cardkey）
	exe, err := os.Executable()
	if err == nil {
		if resolved, e2 := filepath.EvalSymlinks(exe); e2 == nil {
			exe = resolved
		}
		if st, e2 := os.Stat(exe); e2 == nil && !st.IsDir() {
			// 若用户显式配置了且与当前进程不同、且文件存在，才用配置（裸机自定义路径）
			if p := strings.TrimSpace(a.UpdateBinaryPath); p != "" {
				if st2, e3 := os.Stat(p); e3 == nil && !st2.IsDir() {
					// 仅当配置路径就是正在运行的文件时采用（避免指到 /opt/... 空路径）
					if sameFile(exe, p) {
						return p, nil
					}
				}
				if a.Log != nil {
					a.Log.Warn("ignore UPDATE_BINARY_PATH (use running executable)",
						"configured", p, "executable", exe)
				}
			}
			return exe, nil
		}
	}
	// Executable 失败时的兜底
	if p := strings.TrimSpace(a.UpdateBinaryPath); p != "" {
		if st, e2 := os.Stat(p); e2 == nil && !st.IsDir() {
			return p, nil
		}
	}
	if err != nil {
		return "", err
	}
	return exe, nil
}

func sameFile(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if a == b {
		return true
	}
	// 忽略符号链接差异
	ra, ea := filepath.EvalSymlinks(a)
	rb, eb := filepath.EvalSymlinks(b)
	return ea == nil && eb == nil && ra == rb
}

func (a *App) writableReleasesDir() string {
	candidates := []string{a.UpdateReleasesDir}
	if a.DataDir != "" {
		candidates = append(candidates, filepath.Join(a.DataDir, "releases"))
	}
	if exe, err := a.currentBinaryPath(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "releases"))
	}
	candidates = append(candidates, filepath.Join(os.TempDir(), "cardkey-releases"))
	for _, d := range candidates {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		if err := os.MkdirAll(d, 0o755); err != nil {
			continue
		}
		// 写探针
		probe := filepath.Join(d, ".write_probe")
		if err := os.WriteFile(probe, []byte("1"), 0o600); err != nil {
			continue
		}
		_ = os.Remove(probe)
		return d
	}
	return filepath.Join(os.TempDir(), "cardkey-releases")
}

// directReleaseAssetURL 不走 API，直接拼 GitHub Release 下载地址（公开仓库可用）。
func (a *App) directReleaseAssetURL(ver string) (assetURL, assetName string) {
	ver = normalizeVer(ver)
	goos, arch := runtime.GOOS, runtime.GOARCH
	assetName = fmt.Sprintf("cardkey-%s-%s", goos, arch)
	if goos == "windows" {
		assetName += ".exe"
	}
	assetURL = fmt.Sprintf(
		"https://github.com/%s/%s/releases/download/v%s/%s",
		a.UpdateGitHubOwner, a.UpdateGitHubRepo, ver, assetName,
	)
	return assetURL, assetName
}

func (a *App) ApplyUpdate(ctx context.Context, targetVer, actor, ip string) error {
	// 对齐 sub2api：下载 Release 二进制 → 原子替换当前进程文件 → 退出由编排器重启
	if !a.canApplyUpdate() {
		return apperr.Validation("当前更新模式不支持一键应用（UPDATE_MODE=disabled）")
	}
	if a.UpdateGitHubOwner == "" || a.UpdateGitHubRepo == "" {
		return apperr.Validation("未配置 GitHub 仓库")
	}
	a.updateMu.Lock()
	if a.updateStatus.State == "downloading" || a.updateStatus.State == "applying" {
		a.updateMu.Unlock()
		return apperr.Conflict("已有更新任务进行中")
	}
	a.updateMu.Unlock()

	targetVer = normalizeVer(targetVer)
	if targetVer == "" || targetVer == "latest" {
		// 用检测链路拿最新版本号（不强制 API）
		if check, err := a.CheckUpdates(ctx); err == nil && check.Latest != "" {
			targetVer = normalizeVer(check.Latest)
		}
	}
	if targetVer == "" {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: "无法解析目标版本"})
		return apperr.Validation("无法解析目标版本，请先检测更新")
	}

	preferred, err := a.currentBinaryPath()
	if err != nil {
		return apperr.Internal("无法定位当前可执行文件: " + err.Error())
	}
	binPath, err := a.pickWritableBinaryPath(preferred)
	if err != nil {
		return apperr.Internal("替换二进制失败: " + err.Error() + "。若曾用 root 写入 data/bin，请执行: docker compose exec -u root cardkey chown -R cardkey:cardkey /app/data/bin")
	}
	if a.Log != nil && binPath != preferred {
		a.Log.Warn("update target binary path adjusted for writability",
			"preferred", preferred, "writable", binPath)
	}

	a.setUpdateStatus(UpdateStatus{State: "checking", Message: "准备下载 v" + targetVer + "…", Progress: 5})

	// 1) 优先直连 Release 资产（无 API 限流）
	assetURL, assetName := a.directReleaseAssetURL(targetVer)
	// 2) 有 Token 时尝试 API 拿精确资产（含 checksum）
	var rel *ghRelease
	if strings.TrimSpace(a.UpdateGitHubToken) != "" {
		if r, err := a.fetchReleaseByTag(ctx, targetVer); err == nil {
			rel = r
			if u, n, err := pickAsset(r); err == nil {
				assetURL, assetName = u, n
			}
		}
	}

	// 与可执行文件同目录建临时目录，保证 rename 原子（同文件系统）
	exeDir := filepath.Dir(binPath)
	tempDir, err := os.MkdirTemp(exeDir, ".cardkey-update-*")
	if err != nil {
		// 回退 data/releases
		relDir := a.writableReleasesDir()
		tempDir, err = os.MkdirTemp(relDir, ".cardkey-update-*")
		if err != nil {
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
			return apperr.Internal("无法创建临时目录（请检查 /app 或 DATA_DIR 写权限）")
		}
	}
	defer func() { _ = os.RemoveAll(tempDir) }()

	partial := filepath.Join(tempDir, assetName+".partial")
	finalNew := filepath.Join(tempDir, "cardkey.new")

	a.setUpdateStatus(UpdateStatus{State: "downloading", Message: "下载 " + assetName, Progress: 15})
	if err := a.downloadFile(ctx, assetURL, partial); err != nil {
		// 直链失败：尝试 API 列出资产（有 Token 或公开 API）
		if rel == nil {
			if r, e2 := a.fetchReleaseByTag(ctx, targetVer); e2 == nil {
				rel = r
			} else if r, e2 := a.fetchLatestRelease(ctx); e2 == nil {
				rel = r
				targetVer = normalizeVer(r.TagName)
			}
		}
		if rel != nil {
			if u, n, e3 := pickAsset(rel); e3 == nil {
				assetURL, assetName = u, n
				partial = filepath.Join(tempDir, assetName+".partial")
				if err = a.downloadFile(ctx, assetURL, partial); err != nil {
					a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
					return apperr.Internal("下载更新失败: " + err.Error())
				}
			} else {
				a.setUpdateStatus(UpdateStatus{State: "failed", Error: "release has no linux asset"})
				return apperr.Validation("该版本 Release 无 linux/" + runtime.GOARCH + " 资产。请升级到附带 cardkey-linux-amd64 的版本，或执行 bash scripts/upgrade.sh")
			}
		} else {
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
			return apperr.Validation("无法下载更新包: " + err.Error() + "。请确认 Release 含 cardkey-linux-amd64，或执行 bash scripts/upgrade.sh")
		}
	}

	a.setUpdateStatus(UpdateStatus{State: "verifying", Message: "校验文件…", Progress: 70})
	if rel != nil {
		if sumURL := findAssetURL(rel, "checksums.txt"); sumURL != "" {
			ok, err := verifySHA256(partial, assetName, sumURL, a.UpdateGitHubToken)
			if err != nil {
				if a.Log != nil {
					a.Log.Warn("checksum verify skipped", "err", err)
				}
			} else if !ok {
				_ = os.Remove(partial)
				a.setUpdateStatus(UpdateStatus{State: "failed", Error: "SHA256 校验失败"})
				return apperr.Validation("SHA256 校验失败")
			}
		}
	}
	// 无 API 时尝试下载 checksums.txt 直链
	if rel == nil {
		sumURL := fmt.Sprintf(
			"https://github.com/%s/%s/releases/download/v%s/checksums.txt",
			a.UpdateGitHubOwner, a.UpdateGitHubRepo, targetVer,
		)
		ok, err := verifySHA256(partial, assetName, sumURL, a.UpdateGitHubToken)
		if err != nil {
			if a.Log != nil {
				a.Log.Warn("checksum optional skip", "err", err)
			}
		} else if !ok {
			_ = os.Remove(partial)
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: "SHA256 校验失败"})
			return apperr.Validation("SHA256 校验失败")
		}
	}

	_ = os.Chmod(partial, 0o755)
	if err := os.Rename(partial, finalNew); err != nil {
		// Windows 可能 rename 失败，copy
		if err := copyFile(partial, finalNew); err != nil {
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
			return err
		}
		_ = os.Remove(partial)
	}
	_ = os.Chmod(finalNew, 0o755)

	// 归档一份到 releases 目录
	relDir := a.writableReleasesDir()
	archDir := filepath.Join(relDir, targetVer)
	_ = os.MkdirAll(archDir, 0o755)
	_ = copyFile(finalNew, filepath.Join(archDir, "cardkey"))

	a.setUpdateStatus(UpdateStatus{State: "applying", Message: "切换二进制…", Progress: 85})
	backupPath := binPath + ".bak"
	_ = os.Remove(backupPath)
	// 1) 当前 → .bak
	if err := os.Rename(binPath, backupPath); err != nil {
		// 不可 rename 则 copy 备份
		_ = copyFile(binPath, backupPath)
	}
	// 2) 新文件 → 当前路径
	if err := os.Rename(finalNew, binPath); err != nil {
		// 跨设备时 copy
		if err2 := copyFile(finalNew, binPath); err2 != nil {
			// 尝试恢复
			_ = os.Rename(backupPath, binPath)
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: err2.Error()})
			return apperr.Internal("替换二进制失败: " + err2.Error())
		}
	}
	_ = os.Chmod(binPath, 0o755)
	// Docker：再写一份到数据卷，避免 compose recreate 后镜像旧 exe 把 UI 打回旧版
	if persist := a.persistentBinaryPath(); persist != "" && !sameFile(persist, binPath) {
		_ = os.MkdirAll(filepath.Dir(persist), 0o755)
		if err := copyFile(binPath, persist); err != nil {
			if a.Log != nil {
				a.Log.Warn("persist binary to data volume failed", "path", persist, "err", err)
			}
		} else {
			_ = os.Chmod(persist, 0o755)
			if a.Log != nil {
				a.Log.Info("persisted updated binary on data volume", "path", persist)
			}
		}
	}
	a.pruneReleases()
	a.Audit(ctx, "admin", actor, "update_apply", "system", "apply "+targetVer+" mode="+a.UpdateMode, ip)
	a.setUpdateStatus(UpdateStatus{
		State:    "restarting",
		Message:  "即将重启：新版本内嵌 SPA+迁移会在启动时生效（不删库）…",
		Progress: 95,
	})
	// Docker: restart policy 会拉起同容器；entrypoint 优先 data/bin/cardkey
	// 重启后 main 会 MigrateFS + SyncToDir(静态)，UI 与 API 一并更新。
	// 延迟足够长，确保 HTTP 响应先写回浏览器（否则客户端拿不到 success，不会开始等重启）。
	go func() {
		time.Sleep(1500 * time.Millisecond)
		if a.Log != nil {
			a.Log.Info("exiting for update restart (embedded migrations+SPA apply on boot)",
				"version", targetVer, "mode", a.UpdateMode, "bin", binPath)
		}
		os.Exit(0)
	}()
	return nil
}

func (a *App) RollbackUpdate(ctx context.Context, targetVer, actor, ip string) error {
	if !a.canApplyUpdate() {
		return apperr.Validation("当前更新模式不支持回滚")
	}
	targetVer = normalizeVer(targetVer)
	binPath, err := a.currentBinaryPath()
	if err != nil {
		return apperr.Internal("无法定位当前可执行文件")
	}
	var src string
	if targetVer == "" || targetVer == "previous" || targetVer == "bak" {
		src = binPath + ".bak"
	} else {
		src = filepath.Join(a.writableReleasesDir(), targetVer, "cardkey")
	}
	if _, err := os.Stat(src); err != nil {
		return apperr.NotFound("找不到可回滚版本: " + targetVer)
	}
	if st, err := os.Stat(binPath); err == nil && !st.IsDir() {
		_ = copyFile(binPath, binPath+".pre-rollback")
	}
	if err := copyFile(src, binPath); err != nil {
		return apperr.Internal("回滚失败: " + err.Error())
	}
	_ = os.Chmod(binPath, 0o755)
	a.Audit(ctx, "admin", actor, "update_rollback", "system", "rollback "+targetVer, ip)
	a.setUpdateStatus(UpdateStatus{State: "restarting", Message: "回滚完成，即将重启…", Progress: 95})
	go func() {
		time.Sleep(1500 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func (a *App) pruneReleases() {
	keep := a.UpdateKeepReleases
	if keep < 1 {
		keep = 5
	}
	dir := a.writableReleasesDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		name string
		t    time.Time
	}
	var dirs []item
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		dirs = append(dirs, item{name: e.Name(), t: info.ModTime()})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].t.After(dirs[j].t) })
	for i := keep; i < len(dirs); i++ {
		_ = os.RemoveAll(filepath.Join(dir, dirs[i].name))
	}
}

func (a *App) fetchLatestRelease(ctx context.Context) (*ghRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", a.UpdateGitHubOwner, a.UpdateGitHubRepo)
	return a.doGitHubJSON(ctx, url)
}

func (a *App) fetchReleaseByTag(ctx context.Context, tag string) (*ghRelease, error) {
	tag = strings.TrimPrefix(tag, "v")
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/tags/v%s", a.UpdateGitHubOwner, a.UpdateGitHubRepo, tag)
	rel, err := a.doGitHubJSON(ctx, url)
	if err != nil {
		url2 := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/tags/%s", a.UpdateGitHubOwner, a.UpdateGitHubRepo, tag)
		return a.doGitHubJSON(ctx, url2)
	}
	return rel, nil
}

func (a *App) doGitHubJSON(ctx context.Context, url string) (*ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "CardKey-Updater")
	if tok := strings.TrimSpace(a.UpdateGitHubToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, apperr.Internal("请求 GitHub 失败: " + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, apperr.NotFound("未找到 Release（仓库无 Release 或 tag 不存在）")
	}
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 400))
		msg := string(b)
		if strings.Contains(strings.ToLower(msg), "rate limit") {
			return nil, apperr.New(429, "GITHUB_RATE_LIMIT",
				"GitHub API 限流：请配置 UPDATE_GITHUB_TOKEN 或稍后再试")
		}
		return nil, apperr.New(resp.StatusCode, "GITHUB_FORBIDDEN",
			fmt.Sprintf("GitHub API %d（建议配置 UPDATE_GITHUB_TOKEN）: %s", resp.StatusCode, truncate(msg, 200)))
	}
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 400))
		return nil, apperr.Internal(fmt.Sprintf("GitHub API %d: %s", resp.StatusCode, truncate(string(b), 200)))
	}
	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, apperr.Internal("解析 Release 失败")
	}
	return &rel, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (a *App) downloadFile(ctx context.Context, url, dest string) error {
	if dir := filepath.Dir(dest); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "CardKey-Updater/1.0")
	req.Header.Set("Accept", "application/octet-stream")
	// 仅 api.github.com 带 Token；下载会 302 到 objects.githubusercontent.com，必须去掉 Authorization
	tok := strings.TrimSpace(a.UpdateGitHubToken)
	client := &http.Client{
		Timeout: 15 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			host := strings.ToLower(req.URL.Host)
			if host != "api.github.com" {
				req.Header.Del("Authorization")
			} else if tok != "" {
				req.Header.Set("Authorization", "Bearer "+tok)
			}
			return nil
		},
	}
	if tok != "" && strings.Contains(strings.ToLower(url), "api.github.com") {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return fmt.Errorf("download 404: release asset not found (%s)", url)
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(f, io.LimitReader(resp.Body, 500<<20))
	if err != nil {
		return err
	}
	if n < 1024 {
		return fmt.Errorf("downloaded file too small (%d bytes), likely not a binary", n)
	}
	return nil
}

func pickAsset(rel *ghRelease) (url, name string, err error) {
	goos, arch := runtime.GOOS, runtime.GOARCH
	// cardkey-linux-amd64, cardkey_linux_amd64, etc.
	candidates := []string{
		fmt.Sprintf("cardkey-%s-%s", goos, arch),
		fmt.Sprintf("cardkey_%s_%s", goos, arch),
		fmt.Sprintf("cardkey-%s-%s.tar.gz", goos, arch),
	}
	for _, c := range candidates {
		for _, a := range rel.Assets {
			n := strings.ToLower(a.Name)
			if n == c || strings.HasPrefix(n, c) {
				return a.BrowserDownloadURL, a.Name, nil
			}
		}
	}
	// fuzzy
	for _, a := range rel.Assets {
		n := strings.ToLower(a.Name)
		if strings.Contains(n, goos) && strings.Contains(n, arch) && !strings.Contains(n, "checksum") {
			return a.BrowserDownloadURL, a.Name, nil
		}
	}
	return "", "", apperr.NotFound(fmt.Sprintf("Release 中无适合 %s/%s 的资产", goos, arch))
}

func findAssetURL(rel *ghRelease, name string) string {
	for _, a := range rel.Assets {
		if strings.EqualFold(a.Name, name) {
			return a.BrowserDownloadURL
		}
	}
	return ""
}

func verifySHA256(filePath, assetName, checksumsURL, token string) (bool, error) {
	req, err := http.NewRequest(http.MethodGet, checksumsURL, nil)
	if err != nil {
		return false, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return false, err
	}
	f, err := os.Open(filePath)
	if err != nil {
		return false, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 2 && strings.EqualFold(parts[0], sum) && strings.Contains(parts[1], assetName) {
			return true, nil
		}
		if len(parts) >= 2 && strings.EqualFold(parts[0], sum) {
			return true, nil
		}
	}
	return false, nil
}

// dirWritable 探测目录是否可写（一键更新写 .tmp 用）
func dirWritable(dir string) bool {
	if dir == "" {
		return false
	}
	_ = os.MkdirAll(dir, 0o755)
	f, err := os.CreateTemp(dir, ".cardkey-wprobe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	dir := filepath.Dir(dst)
	_ = os.MkdirAll(dir, 0o755)

	// 优先同目录临时文件再 rename（原子）；目录只读时退到 os.TempDir 再 copy
	tmp, err := os.CreateTemp(dir, ".cardkey-copy-*")
	useRename := true
	if err != nil {
		tmp, err = os.CreateTemp("", "cardkey-copy-*")
		useRename = false
		if err != nil {
			return err
		}
	}
	tmpName := tmp.Name()
	_, copyErr := io.Copy(tmp, in)
	closeErr := tmp.Close()
	if copyErr != nil {
		_ = os.Remove(tmpName)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpName)
		return closeErr
	}
	_ = os.Chmod(tmpName, 0o755)

	if useRename {
		if err := os.Rename(tmpName, dst); err == nil {
			return nil
		}
		// rename 失败（含 Windows 目标被占用）则继续按拷贝覆盖
	}

	// 直接覆盖目标
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	in2, err := os.Open(tmpName)
	if err != nil {
		_ = out.Close()
		_ = os.Remove(tmpName)
		return err
	}
	_, err = io.Copy(out, in2)
	_ = in2.Close()
	cerr := out.Close()
	_ = os.Remove(tmpName)
	if err != nil {
		return err
	}
	return cerr
}

// pickWritableBinaryPath 选择当前用户可写的替换目标（避免 root 写过的 data/bin 导致 permission denied）
func (a *App) pickWritableBinaryPath(preferred string) (string, error) {
	cands := make([]string, 0, 4)
	if preferred != "" {
		cands = append(cands, preferred)
	}
	if p := a.persistentBinaryPath(); p != "" {
		cands = append(cands, p)
	}
	// 镜像内路径：Dockerfile 已 chown 给 cardkey
	cands = append(cands, "/app/cardkey")
	if exe, err := os.Executable(); err == nil {
		cands = append(cands, exe)
	}

	seen := map[string]bool{}
	for _, p := range cands {
		p = filepath.Clean(strings.TrimSpace(p))
		if p == "" || p == "." || seen[p] {
			continue
		}
		seen[p] = true
		if dirWritable(filepath.Dir(p)) {
			return p, nil
		}
	}
	return "", fmt.Errorf("没有可写的二进制路径（请 chown cardkey /app/data/bin）")
}

func normalizeVer(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	return v
}

// 简易 semver 比较：a > b
func semverGreater(a, b string) bool {
	ap := parseSemver(a)
	bp := parseSemver(b)
	for i := 0; i < 3; i++ {
		if ap[i] > bp[i] {
			return true
		}
		if ap[i] < bp[i] {
			return false
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	v = normalizeVer(v)
	var out [3]int
	parts := strings.Split(v, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n := 0
		for _, c := range parts[i] {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		out[i] = n
	}
	return out
}

// silence unused if build tags
var _ = sync.Mutex{}
