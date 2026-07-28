package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// listCursor 列表 keyset：created_at DESC, id DESC
type listCursor struct {
	At time.Time
	ID string
}

func encodeListCursor(at time.Time, id string) string {
	if id == "" || at.IsZero() {
		return ""
	}
	return at.UTC().Format(time.RFC3339Nano) + "|" + id
}

func decodeListCursor(s string) (listCursor, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return listCursor{}, false
	}
	parts := strings.SplitN(s, "|", 2)
	if len(parts) != 2 || parts[1] == "" {
		return listCursor{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		// 兼容 RFC3339
		t, err = time.Parse(time.RFC3339, parts[0])
		if err != nil {
			return listCursor{}, false
		}
	}
	return listCursor{At: t.UTC(), ID: parts[1]}, true
}

func countCacheKey(prefix string, parts ...string) string {
	h := sha1.New()
	_, _ = h.Write([]byte(prefix))
	for _, p := range parts {
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(p))
	}
	return "cardkey:cnt:" + prefix + ":" + hex.EncodeToString(h.Sum(nil)[:12])
}

// tableRowEstimate 用 pg_class 估算行数；失败返回 0,false。
func (a *App) tableRowEstimate(ctx context.Context, table string) (int, bool) {
	var n float64
	err := a.Pool.QueryRow(ctx, `
		SELECT COALESCE(c.reltuples, 0)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relname = $1 AND n.nspname = current_schema()`, table).Scan(&n)
	if err != nil || n < 0 {
		return 0, false
	}
	return int(n), true
}

// cachedExactCount Redis 缓存精确 COUNT；无 Redis 则直接算。
func (a *App) cachedExactCount(ctx context.Context, key string, ttl time.Duration, run func() (int, error)) (int, error) {
	if a.RDB != nil {
		if s, err := a.RDB.Get(ctx, key).Result(); err == nil && s != "" {
			if n, e := strconv.Atoi(s); e == nil && n >= 0 {
				return n, nil
			}
		}
	}
	n, err := run()
	if err != nil {
		return 0, err
	}
	if a.RDB != nil && n >= 0 {
		_ = a.RDB.Set(ctx, key, strconv.Itoa(n), ttl).Err()
	}
	return n, nil
}

// smartCount 大表无筛选时优先估算；有筛选则缓存精确 COUNT。
// preferExact=false 且估算行数 >= threshold 时返回估算。
func (a *App) smartCount(
	ctx context.Context,
	table string,
	filterKey string,
	unfiltered bool,
	threshold int,
	exact func() (int, error),
) (total int, exactOK bool, err error) {
	if unfiltered {
		if est, ok := a.tableRowEstimate(ctx, table); ok && est >= threshold {
			// 粗估可能偏低/偏高，夹一下
			if est < 0 {
				est = 0
			}
			return est, false, nil
		}
	}
	key := countCacheKey(table, filterKey)
	n, err := a.cachedExactCount(ctx, key, 45*time.Second, exact)
	if err != nil {
		return 0, true, err
	}
	return n, true, nil
}

func filterKey(parts ...string) string {
	return strings.Join(parts, "|")
}

// trimHasMore 若多取了一行则裁剪并生成 nextCursor。
func trimHasMore[T any](items []T, pageSize int, cursorOf func(T) (time.Time, string)) (out []T, hasMore bool, next string) {
	if len(items) > pageSize {
		hasMore = true
		items = items[:pageSize]
	}
	out = items
	if hasMore && len(out) > 0 {
		at, id := cursorOf(out[len(out)-1])
		next = encodeListCursor(at, id)
	}
	return out, hasMore, next
}

// keysetPredicate 追加 (created_at, id) < cursor 的条件，表别名 colPrefix 如 "cards" 或 "r"。
func keysetPredicate(colPrefix string, cur listCursor, argStart int) (sqlFrag string, args []any) {
	ca := colPrefix + ".created_at"
	id := colPrefix + ".id"
	// created_at < $n OR (created_at = $n AND id < $n+1)
	sqlFrag = fmt.Sprintf("(%s < $%d OR (%s = $%d AND %s::text < $%d))", ca, argStart, ca, argStart, id, argStart+1)
	args = []any{cur.At, cur.ID}
	return sqlFrag, args
}
