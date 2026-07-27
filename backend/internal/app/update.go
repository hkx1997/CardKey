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

// 检测结果缓存（降低匿名 API 60 次/小时 限流）
const updateCheckCacheTTL = 15 * time.Minute

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
	mode := a.UpdateMode
	if mode == "" {
		mode = "disabled"
	}
	cur := normalizeVer(version.Version)
	out := UpdateCheckResult{
		Current:       cur,
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

	// 短缓存：同一进程内 15 分钟内重复点击不重复请求 GitHub
	if cached, ok := a.getUpdateCheckCache(cur, mode); ok {
		return cached, nil
	}

	// 1) 优先：GitHub 网页 /releases/latest 302 跳转（不走 api.github.com，不受 60/h 限流）
	if tag, htmlURL, err := a.fetchLatestTagViaRedirect(ctx); err == nil && tag != "" {
		latest := normalizeVer(tag)
		out.Latest = latest
		out.ReleaseURL = htmlURL
		out.HasUpdate = semverGreater(latest, cur)
		if mode == "docker" {
			out.Message = "Docker 模式：请在宿主机执行 docker compose pull && docker compose up -d"
		} else if !out.HasUpdate {
			out.Message = "已是最新版本"
		}
		// 2) 有 Token 时再补 Release 说明（额度 5000/h，可接受）
		if out.Authenticated {
			if rel, err := a.fetchLatestRelease(ctx); err == nil && rel != nil {
				out.Body = rel.Body
				if !rel.PublishedAt.IsZero() {
					out.PublishedAt = rel.PublishedAt.UTC().Format(time.RFC3339)
				}
				if rel.HTMLURL != "" {
					out.ReleaseURL = rel.HTMLURL
				}
			}
		}
		a.setUpdateCheckCache(out)
		return out, nil
	}

	// 3) 回退 API（无 Token 时易 403 限流；正常路径已走 302，多数情况用不到）
	rel, err := a.fetchLatestRelease(ctx)
	if err != nil {
		// 友好提示限流，不把整段 JSON 砸给用户
		if msg, ok := friendlyGitHubErr(err); ok {
			out.Message = msg
			out.TokenRecommended = !out.Authenticated
			return out, nil
		}
		return out, err
	}
	latest := normalizeVer(rel.TagName)
	out.Latest = latest
	out.ReleaseURL = rel.HTMLURL
	out.Body = rel.Body
	if !rel.PublishedAt.IsZero() {
		out.PublishedAt = rel.PublishedAt.UTC().Format(time.RFC3339)
	}
	out.HasUpdate = semverGreater(latest, cur)
	if mode == "docker" {
		out.Message = "Docker 模式：请在宿主机执行 docker compose pull && docker compose up -d"
	} else if !out.HasUpdate {
		out.Message = "已是最新版本"
	}
	a.setUpdateCheckCache(out)
	return out, nil
}

func (a *App) getUpdateCheckCache(cur, mode string) (UpdateCheckResult, bool) {
	a.updateCheckCacheMu.Lock()
	defer a.updateCheckCacheMu.Unlock()
	c := a.updateCheckCache
	if c == nil || time.Since(c.at) > updateCheckCacheTTL {
		return UpdateCheckResult{}, false
	}
	// 当前版本变化则缓存失效
	if c.result.Current != cur || c.result.Mode != mode {
		return UpdateCheckResult{}, false
	}
	out := c.result
	out.FromCache = true
	if out.Message == "" {
		out.Message = "（缓存结果，15 分钟内有效）"
	} else if !strings.Contains(out.Message, "缓存") {
		out.Message = out.Message + " · 缓存"
	}
	return out, true
}

func (a *App) setUpdateCheckCache(r UpdateCheckResult) {
	a.updateCheckCacheMu.Lock()
	defer a.updateCheckCacheMu.Unlock()
	cp := r
	cp.FromCache = false
	a.updateCheckCache = &updateCheckCache{at: time.Now(), result: cp}
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
	req.Header.Set("User-Agent", "CardKey-Updater")
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	loc := resp.Header.Get("Location")
	if loc == "" && (resp.StatusCode == 200 || resp.StatusCode == 304) {
		// 少数环境不跳转，仍可从 final URL 解析
		loc = resp.Request.URL.String()
	}
	if loc == "" {
		return "", "", fmt.Errorf("no redirect from releases/latest (status %d)", resp.StatusCode)
	}
	// /owner/repo/releases/tag/v1.2.3 或完整 URL
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
	// .../releases/tag/v1.2.3 或 .../releases/tag/1.2.3
	const marker = "/releases/tag/"
	i := strings.Index(loc, marker)
	if i < 0 {
		return ""
	}
	tag := loc[i+len(marker):]
	if j := strings.IndexAny(tag, "?#"); j >= 0 {
		tag = tag[:j]
	}
	tag = strings.Trim(tag, "/")
	return tag
}

func friendlyGitHubErr(err error) (string, bool) {
	if err == nil {
		return "", false
	}
	s := err.Error()
	low := strings.ToLower(s)
	if strings.Contains(low, "rate limit") ||
		strings.Contains(s, "API rate limit") ||
		strings.Contains(s, "GITHUB_RATE_LIMIT") ||
		strings.Contains(s, "限流") ||
		(strings.Contains(s, "403") && strings.Contains(low, "github")) {
		return "GitHub API 访问次数已用尽（匿名约 60 次/小时）。请在服务器 .env 设置 UPDATE_GITHUB_TOKEN（GitHub Personal Access Token），然后 docker compose up -d 重启。检测已改为优先走网页跳转，一般无需 API；配置 Token 后额度约 5000 次/小时。", true
	}
	if strings.Contains(s, "GITHUB_FORBIDDEN") || strings.Contains(s, "GitHub API 401") {
		return "GitHub 拒绝访问。请检查 UPDATE_GITHUB_TOKEN 是否有效，或仓库是否公开。", true
	}
	return "", false
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

func (a *App) ApplyUpdate(ctx context.Context, targetVer, actor, ip string) error {
	if a.UpdateMode != "binary" || !a.UpdateEnabled {
		return apperr.Validation("当前部署模式不支持在线应用更新")
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
	a.setUpdateStatus(UpdateStatus{State: "checking", Message: "获取 Release…", Progress: 5})
	rel, err := a.fetchReleaseByTag(ctx, targetVer)
	if err != nil {
		// 空 tag 用 latest
		if targetVer == "" || targetVer == "latest" {
			rel, err = a.fetchLatestRelease(ctx)
		}
		if err != nil {
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
			return err
		}
		targetVer = normalizeVer(rel.TagName)
	}

	assetURL, assetName, err := pickAsset(rel)
	if err != nil {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
		return err
	}

	if err := os.MkdirAll(a.UpdateReleasesDir, 0o755); err != nil {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
		return apperr.Internal("无法创建 releases 目录")
	}

	destDir := filepath.Join(a.UpdateReleasesDir, targetVer)
	_ = os.MkdirAll(destDir, 0o755)
	partial := filepath.Join(destDir, "cardkey.partial")
	final := filepath.Join(destDir, "cardkey")

	a.setUpdateStatus(UpdateStatus{State: "downloading", Message: "下载 " + assetName, Progress: 15})
	if err := a.downloadFile(ctx, assetURL, partial); err != nil {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
		return err
	}

	a.setUpdateStatus(UpdateStatus{State: "verifying", Message: "校验文件…", Progress: 70})
	// 可选 checksums 资产
	if sumURL := findAssetURL(rel, "checksums.txt"); sumURL != "" {
		ok, err := verifySHA256(partial, assetName, sumURL, a.UpdateGitHubToken)
		if err != nil {
			a.Log.Warn("checksum verify skipped", "err", err)
		} else if !ok {
			_ = os.Remove(partial)
			a.setUpdateStatus(UpdateStatus{State: "failed", Error: "SHA256 校验失败"})
			return apperr.Validation("SHA256 校验失败")
		}
	}
	_ = os.Chmod(partial, 0o755)
	if err := os.Rename(partial, final); err != nil {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
		return err
	}

	binPath := a.UpdateBinaryPath
	if binPath == "" {
		binPath = "/opt/cardkey/cardkey"
	}
	a.setUpdateStatus(UpdateStatus{State: "applying", Message: "切换二进制…", Progress: 85})
	// 备份当前
	if st, err := os.Stat(binPath); err == nil && !st.IsDir() {
		bak := binPath + ".bak"
		_ = copyFile(binPath, bak)
	}
	if err := copyFile(final, binPath); err != nil {
		a.setUpdateStatus(UpdateStatus{State: "failed", Error: err.Error()})
		return apperr.Internal("替换二进制失败: " + err.Error())
	}
	_ = os.Chmod(binPath, 0o755)
	a.pruneReleases()
	a.Audit(ctx, "admin", actor, "update_apply", "system", "apply "+targetVer, ip)
	a.setUpdateStatus(UpdateStatus{State: "restarting", Message: "即将重启服务…", Progress: 95})
	// 延迟退出，让响应先返回
	go func() {
		time.Sleep(800 * time.Millisecond)
		a.Log.Info("exiting for update restart", "version", targetVer)
		os.Exit(0) // systemd Restart=always 拉起新二进制
	}()
	return nil
}

func (a *App) RollbackUpdate(ctx context.Context, targetVer, actor, ip string) error {
	if a.UpdateMode != "binary" || !a.UpdateEnabled {
		return apperr.Validation("当前部署模式不支持回滚")
	}
	targetVer = normalizeVer(targetVer)
	binPath := a.UpdateBinaryPath
	var src string
	if targetVer == "" || targetVer == "previous" || targetVer == "bak" {
		src = binPath + ".bak"
	} else {
		src = filepath.Join(a.UpdateReleasesDir, targetVer, "cardkey")
	}
	if _, err := os.Stat(src); err != nil {
		return apperr.NotFound("找不到可回滚版本: " + targetVer)
	}
	// 先备份当前
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
		time.Sleep(800 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func (a *App) pruneReleases() {
	keep := a.UpdateKeepReleases
	if keep < 1 {
		keep = 5
	}
	dir := a.UpdateReleasesDir
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "CardKey-Updater")
	if a.UpdateGitHubToken != "" {
		req.Header.Set("Authorization", "Bearer "+a.UpdateGitHubToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
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

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	cerr := out.Close()
	if err != nil {
		return err
	}
	if cerr != nil {
		return cerr
	}
	return os.Rename(tmp, dst)
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
