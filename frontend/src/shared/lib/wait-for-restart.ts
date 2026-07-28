/**
 * 一键更新 / 回滚后：进程会退出再拉起。
 * 轮询 /healthz，确认服务恢复（可选校验版本）后强制刷新页面。
 */

export type RestartWaitState = {
  phase: "waiting_down" | "waiting_up" | "ready" | "timeout";
  attempt: number;
  version?: string;
  message: string;
};

type HealthzBody = {
  success?: boolean;
  data?: { status?: string; version?: string; commit?: string };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripV(v?: string | null) {
  return (v ?? "").replace(/^v/i, "").trim();
}

/** 决策是否可刷新（纯函数，便于单测） */
export function shouldReloadAfterProbe(input: {
  ok: boolean;
  version?: string;
  sawDown: boolean;
  target?: string;
  previous?: string;
  attempt: number;
  /** 自 apply 提交起是否已过最短观察窗（避免立刻命中旧版） */
  pastGrace: boolean;
}): "wait" | "reload" | "wait_for_target" {
  const ver = stripV(input.version);
  const target = stripV(input.target);
  const previous = stripV(input.previous);

  if (!input.ok) {
    return "wait";
  }

  // 命中目标版本 → 刷新（需过 grace，避免读到更新前缓存的极短窗口）
  if (target && ver && ver === target && (input.pastGrace || input.sawDown || input.attempt >= 2)) {
    return "reload";
  }

  // 版本相对更新前已变化（含回滚）
  if (ver && previous && ver !== previous && (input.pastGrace || input.sawDown)) {
    // 若指定了目标且仍不对，继续等
    if (target && ver !== target) {
      return "wait_for_target";
    }
    return "reload";
  }

  // 经历过 downtime 后恢复
  if (input.sawDown) {
    if (target && ver && ver !== target) {
      return "wait_for_target";
    }
    // 无目标版本要求，或 healthz 未带版本：只要恢复即可
    if (!target || !ver) {
      return "reload";
    }
  }

  return "wait";
}

async function probeHealthz(): Promise<{
  ok: boolean;
  version?: string;
}> {
  try {
    // 防中间层缓存
    const res = await fetch(`/healthz?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json().catch(() => null)) as HealthzBody | null;
    if (!body?.success) return { ok: false };
    return {
      ok: true,
      version: body.data?.version,
    };
  } catch {
    return { ok: false };
  }
}

/** 强制绕过文档缓存刷新（更新后旧 index.html 会导致「看起来没更新」） */
export function hardReloadPage() {
  try {
    sessionStorage.setItem("cardkey-just-updated", String(Date.now()));
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_ck", String(Date.now()));
  // 去掉 hash 再 replace，保证重新拉 index.html
  const next = `${url.pathname}${url.search}`;
  window.location.replace(next);
}

/**
 * 等待服务恢复后 hardReload。
 * @returns true 已触发刷新；false 超时
 */
export async function waitForRestartAndReload(opts?: {
  targetVersion?: string;
  previousVersion?: string;
  maxWaitMs?: number;
  intervalMs?: number;
  onStatus?: (s: RestartWaitState) => void;
  settleMs?: number;
  /** 最短等待后再允许按版本匹配刷新，默认 2s */
  graceMs?: number;
}): Promise<boolean> {
  const maxWait = opts?.maxWaitMs ?? 240_000;
  const interval = opts?.intervalMs ?? 1_200;
  const settleMs = opts?.settleMs ?? 600;
  const graceMs = opts?.graceMs ?? 2_000;
  const target = stripV(opts?.targetVersion);
  const previous = stripV(opts?.previousVersion);
  const start = Date.now();
  let sawDown = false;
  let attempt = 0;

  const report = (
    partial: Omit<RestartWaitState, "attempt"> & { attempt?: number },
  ) => {
    opts?.onStatus?.({
      ...partial,
      attempt: partial.attempt ?? attempt,
    });
  };

  report({
    phase: "waiting_down",
    message: "更新已提交，等待进程重启…",
  });

  // 后端约 1.2s 后 os.Exit；先给退出窗口
  await sleep(800);

  while (Date.now() - start < maxWait) {
    attempt++;
    const pastGrace = Date.now() - start >= graceMs;
    const { ok, version } = await probeHealthz();
    const ver = stripV(version);

    if (!ok) {
      sawDown = true;
      report({
        phase: "waiting_up",
        message: "服务重启中，正在等待恢复…",
        version: ver || undefined,
      });
      await sleep(interval);
      continue;
    }

    const decision = shouldReloadAfterProbe({
      ok,
      version: ver,
      sawDown,
      target,
      previous,
      attempt,
      pastGrace,
    });

    if (decision === "wait_for_target") {
      report({
        phase: "waiting_up",
        message: ver
          ? `服务已响应（v${ver}），等待切换到 v${target}…`
          : `等待切换到 v${target}…`,
        version: ver || undefined,
      });
      await sleep(interval);
      continue;
    }

    if (decision === "reload") {
      report({
        phase: "ready",
        message: ver
          ? `服务已恢复（v${ver}），即将刷新…`
          : "服务已恢复，即将刷新…",
        version: ver || undefined,
      });
      await sleep(settleMs);
      hardReloadPage();
      return true;
    }

    report({
      phase: sawDown ? "waiting_up" : "waiting_down",
      message: ver
        ? `服务仍在线（v${ver}），等待重启生效…`
        : "等待服务重启…",
      version: ver || undefined,
    });
    await sleep(interval);
  }

  report({
    phase: "timeout",
    message: "等待超时，请手动刷新页面（Ctrl+Shift+R）",
  });
  return false;
}

/**
 * 判断 apply/rollback 请求失败是否仍可能是「进程已退出」导致的断连。
 * 真正业务失败（400/403/校验错误）不应走等待重启。
 */
export function isLikelyRestartDisconnect(err: unknown): boolean {
  if (err == null) return false;
  // fetch 网络层（进程已死最常见）
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
  // 仅网关/不可达：不要把业务 500（下载失败等）当成重启成功
  const status = (err as { status?: number }).status;
  if (
    typeof status === "number" &&
    (status === 0 || status === 502 || status === 503 || status === 504)
  ) {
    return true;
  }
  return false;
}
