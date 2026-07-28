package app

import (
	"context"
	"sync"
	"time"
)

type auditEvent struct {
	ActorType  string
	ActorLabel string
	Action     string
	Resource   string
	Detail     string
	IP         string
}

var (
	auditOnce   sync.Once
	auditCh     chan auditEvent
	auditStop   chan struct{}
	auditWG     sync.WaitGroup
)

// StartAuditWorker 异步批量写审计（降低写路径延迟）。
func (a *App) StartAuditWorker(ctx context.Context) {
	auditOnce.Do(func() {
		auditCh = make(chan auditEvent, 512)
		auditStop = make(chan struct{})
		auditWG.Add(1)
		go a.auditWorkerLoop(ctx)
	})
}

func (a *App) auditWorkerLoop(ctx context.Context) {
	defer auditWG.Done()
	buf := make([]auditEvent, 0, 64)
	t := time.NewTicker(200 * time.Millisecond)
	defer t.Stop()
	flush := func() {
		if len(buf) == 0 || a.Pool == nil {
			buf = buf[:0]
			return
		}
		// 逐条插入保持 schema 简单；批量仍比同步省请求 RTT
		cctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		for _, e := range buf {
			_, err := a.Pool.Exec(cctx, `
				INSERT INTO audit_logs(actor_type, actor_label, action, resource, detail, ip)
				VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::inet)`,
				e.ActorType, e.ActorLabel, e.Action, e.Resource, e.Detail, e.IP)
			if err != nil && a.Log != nil {
				a.Log.Warn("audit async write failed", "err", err)
			}
		}
		cancel()
		buf = buf[:0]
	}
	for {
		select {
		case <-ctx.Done():
			// 排空
			for {
				select {
				case e := <-auditCh:
					buf = append(buf, e)
					if len(buf) >= 64 {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case e := <-auditCh:
			buf = append(buf, e)
			if len(buf) >= 32 {
				flush()
			}
		case <-t.C:
			flush()
		}
	}
}

// Audit 异步入队；队列满时同步落库，避免丢关键操作。
func (a *App) Audit(ctx context.Context, actorType, actorLabel, action, resource, detail, ip string) {
	e := auditEvent{
		ActorType: actorType, ActorLabel: actorLabel,
		Action: action, Resource: resource, Detail: detail, IP: ip,
	}
	if auditCh != nil {
		select {
		case auditCh <- e:
			return
		default:
			// 满则同步
		}
	}
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_, err := a.Pool.Exec(actx, `
		INSERT INTO audit_logs(actor_type, actor_label, action, resource, detail, ip)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::inet)`,
		actorType, actorLabel, action, resource, detail, ip)
	if err != nil && a.Log != nil {
		a.Log.Warn("audit write failed", "err", err)
	}
}
