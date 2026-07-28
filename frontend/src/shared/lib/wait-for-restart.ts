/**
 * 一键更新 / 回滚后：固定倒计时后强制刷新。
 * 倒计时结束一定 hardReload，不依赖 healthz 是否探测到 downtime。
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
  try {
    sessionStorage.setItem("cardkey-just-updated", String(Date.now()));
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_ck", String(Date.now()));
  window.location.replace(`${url.pathname}${url.search}`);
}

export const RELOAD_COUNTDOWN_SEC = 10;

/**
 * 固定秒数倒计时后 hardReload（默认 10 秒）。
 * 期间探测 healthz 仅用于文案，不提前结束。
 */
export async function waitForRestartAndReload(opts?: {
  targetVersion?: string;
  previousVersion?: string;
  countdownSec?: number;
  onStatus?: (s: RestartWaitState) => void;
}): Promise<boolean> {
  const total = Math.max(3, opts?.countdownSec ?? RELOAD_COUNTDOWN_SEC);
  const target = stripV(opts?.targetVersion);

  const report = (remaining: number, extra?: Partial<RestartWaitState>) => {
    opts?.onStatus?.({
      phase: remaining <= 0 ? "ready" : "countdown",
      attempt: total - remaining,
      remainingSec: remaining,
      totalSec: total,
      message:
        extra?.message ??
        (remaining > 0
          ? `${remaining} 秒后自动刷新页面…`
          : "正在刷新页面…"),
      version: extra?.version,
    });
  };

  report(total, {
    message: target
      ? `已提交，${total} 秒后刷新（目标 v${target}）`
      : `已提交，${total} 秒后自动刷新`,
  });

  for (let left = total; left > 0; left--) {
    const { ok, version } = await probeHealthz();
    const ver = stripV(version);
    if (ok && ver) {
      report(left, {
        version: ver,
        message: `服务已响应（v${ver}），${left} 秒后刷新`,
      });
    } else if (!ok) {
      report(left, { message: `服务重启中，${left} 秒后刷新` });
    } else {
      report(left);
    }
    await sleep(1000);
  }

  report(0, { message: "正在刷新页面…" });
  await sleep(150);
  hardReloadPage();
  return true;
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
