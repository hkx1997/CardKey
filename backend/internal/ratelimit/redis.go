package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Limiter struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// Allow fixed-window per-minute limit. Returns true if under limit.
// 使用 pipeline 将 INCR + EXPIRE 合并为一次 RTT，节省网络往返。
func (l *Limiter) Allow(ctx context.Context, key string, limit int) (bool, error) {
	if l == nil || l.rdb == nil || limit <= 0 {
		return true, nil
	}
	k := fmt.Sprintf("rl:%s:%d", key, time.Now().Unix()/60)
	pipe := l.rdb.Pipeline()
	incr := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, 2*time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		// fail open for availability unless caller wants closed
		return true, err
	}
	n, err := incr.Result()
	if err != nil {
		return true, err
	}
	return n <= int64(limit), nil
}

func Connect(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}
	return rdb, nil
}
