/**
 * 一键更新 / 回滚后等待服务就绪再刷新。
 * - 探测到 healthz 可用（且目标版本已切换）则立刻刷新，不必等满倒计时
 * - 超时仍 hardReload，避免卡在等待页
 */

export type RestartWaitState = {
  phase: "applying" | "countdown" | "ready" | "timeout";
  attempt: number;
  version?: string;
  message: string;
  remainingSec?: number;
  totalSec?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripV(v?: string | null) {
  return (v ?? "").replace(/^v/i, "").trim();
}

type HealthzBody = {
  success?: boolean;
  data?: { status?: string; version?: string };
};

async function probeHealthz(): Promise<{ ok: boolean; version?: string }> {
  try {
    const res = await fetch(`/healthz?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json().catch(() => null)) as HealthzBody | null;
    if (!body?.success) return { ok: false };
    return { ok: true, version: body.data?.version };
  } catch {
    return { ok: false };
  }
}

/** 强制绕过文档缓存刷新 */
export function hardReloadPage() {
  const g = globalThis as typeof globalThis & {
    sessionStorage?: Storage;
    location?: Location;
  };
  try {
    g.sessionStorage?.setItem("cardkey-just-updated", String(Date.now()));
  } catch {
    /* ignore */
  }
  const loc = g.location;
  if (!loc?.href || typeof loc.replace !== "function") return;
  const url = new URL(loc.href);
  url.searchParams.set("_ck", String(Date.now()));
  loc.replace(`${url.pathname}${url.search}`);
}

/** UI 展示的「最长等待」秒数（超时仍会刷新） */
export const RELOAD_COUNTDOWN_SEC = 10;

/** 提交后至少等待该毫秒再允许「版本已匹配即刷新」，避开旧进程尚未退出 */
const MIN_GRACE_MS = 1200;

/** 探测间隔 */
const POLL_MS = 400;

/**
 * 等待服务就绪后 hardReload。
 * 就绪条件（满足其一即可提前结束）：
 * 1. 曾探测到宕机，之后 healthz 恢复
 * 2. 指定了 targetVersion，且 healthz 返回该版本（且已过最短宽限）
 * 3. 达到 countdownSec 超时 → 强制刷新
 */
export async function waitForRestartAndReload(opts?: {
  targetVersion?: string;
  previousVersion?: string;
  countdownSec?: number;
  onStatus?: (s: RestartWaitState) => void;
}): Promise<boolean> {
  const total = Math.max(3, opts?.countdownSec ?? RELOAD_COUNTDOWN_SEC);
  const target = stripV(opts?.targetVersion);
  const previous = stripV(opts?.previousVersion);
  const started = Date.now();
  let sawDown = false;
  let attempt = 0;

  const report = (
    remaining: number,
    phase: RestartWaitState["phase"],
    message: string,
    version?: string,
  ) => {
    opts?.onStatus?.({
      phase,
      attempt,
      remainingSec: remaining,
      totalSec: total,
      message,
      version,
    });
  };

  report(
    total,
    "countdown",
    target
      ? `等待服务就绪（目标 v${target}，最多 ${total} 秒）…`
      : `等待服务就绪（最多 ${total} 秒）…`,
  );

  while (true) {
    attempt += 1;
    const elapsed = Date.now() - started;
    const remaining = Math.max(0, Math.ceil((total * 1000 - elapsed) / 1000));

    const { ok, version } = await probeHealthz();
    const ver = stripV(version);

    if (!ok) {
      sawDown = true;
      report(
        remaining,
        "countdown",
        remaining > 0
          ? `服务重启中，就绪后立即刷新（剩余最多 ${remaining} 秒）…`
          : "等待超时，即将刷新…",
      );
    } else {
      const versionMatched = !!target && !!ver && ver === target;
      const leftOldVersion =
        !!previous && !!ver && previous !== "" && ver !== previous;
      // 宕机后恢复，或目标版本已上线（过宽限），或已离开旧版本
      const readyEarly =
        (sawDown && ok) ||
        (versionMatched && elapsed >= MIN_GRACE_MS) ||
        (leftOldVersion && elapsed >= MIN_GRACE_MS && !!target);

      if (readyEarly) {
        report(
          0,
          "ready",
          ver
            ? `服务已就绪（v${ver}），正在刷新…`
            : "服务已就绪，正在刷新…",
          ver || undefined,
        );
        await sleep(120);
        hardReloadPage();
        return true;
      }

      report(
        remaining,
        "countdown",
        ver
          ? `服务响应中（v${ver}），确认切换后立即刷新…`
          : `服务响应中，确认切换后立即刷新…`,
        ver || undefined,
      );
    }

    if (elapsed >= total * 1000) {
      report(0, "timeout", "等待超时，正在刷新页面…");
      await sleep(120);
      hardReloadPage();
      return true;
    }

    await sleep(POLL_MS);
  }
}

export function isLikelyRestartDisconnect(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (
      m.includes("failed to fetch") ||
      m.includes("networkerror") ||
      m.includes("network error") ||
      m.includes("load failed") ||
      m.includes("aborted") ||
      m.includes("econnreset") ||
      m.includes("econnrefused") ||
      m.includes("unexpected end of json") ||
      m.includes("unexpected eof")
    ) {
      return true;
    }
  }
  const status = (err as { status?: number }).status;
  if (
    typeof status === "number" &&
    (status === 0 || status === 502 || status === 503 || status === 504)
  ) {
    return true;
  }
  return false;
}
