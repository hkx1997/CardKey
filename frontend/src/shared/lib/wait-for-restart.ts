/**
 * 一键更新 / 回滚后：进程会退出再拉起。
 * 轮询 /healthz，确认服务恢复（可选校验版本）后自动刷新页面。
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

async function probeHealthz(): Promise<{
  ok: boolean;
  version?: string;
}> {
  try {
    const res = await fetch("/healthz", {
      cache: "no-store",
      credentials: "same-origin",
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

/**
 * 等待服务经历一次不可达后再恢复，然后 location.reload()。
 * @returns true 已触发刷新；false 超时未刷新（调用方可提示手动刷新）
 */
export async function waitForRestartAndReload(opts?: {
  /** 期望更新到的版本（无 v 前缀亦可） */
  targetVersion?: string;
  /** 更新前版本，用于确认已切走（可选） */
  previousVersion?: string;
  maxWaitMs?: number;
  intervalMs?: number;
  onStatus?: (s: RestartWaitState) => void;
  /** 探测到就绪后延迟再刷新，给迁移一点时间 */
  settleMs?: number;
}): Promise<boolean> {
  const maxWait = opts?.maxWaitMs ?? 180_000;
  const interval = opts?.intervalMs ?? 1_500;
  const settleMs = opts?.settleMs ?? 800;
  const target = opts?.targetVersion?.replace(/^v/i, "").trim();
  const previous = opts?.previousVersion?.replace(/^v/i, "").trim();
  const start = Date.now();
  let sawDown = false;
  let attempt = 0;

  const report = (partial: Omit<RestartWaitState, "attempt"> & { attempt?: number }) => {
    opts?.onStatus?.({
      attempt,
      ...partial,
      attempt: partial.attempt ?? attempt,
    });
  };

  report({
    phase: "waiting_down",
    message: "更新已提交，等待进程重启…",
  });

  // 给进程一点时间退出（后端约 0.9s 后 os.Exit）
  await sleep(1_200);

  while (Date.now() - start < maxWait) {
    attempt++;
    const { ok, version } = await probeHealthz();
    const ver = version?.replace(/^v/i, "");

    if (!ok) {
      sawDown = true;
      report({
        phase: "waiting_up",
        message: "服务重启中，正在等待恢复…",
        version: ver,
      });
      await sleep(interval);
      continue;
    }

    // 已恢复：若观察到过 down，或版本已变化/命中目标，则认为成功
    const versionChanged =
      !!ver && !!previous && ver !== previous;
    const versionMatched = !target || (!!ver && ver === target);
    const ready =
      (sawDown && versionMatched) ||
      versionChanged ||
      (sawDown && !target) ||
      // 极快重启没扫到 down：只要版本对上也可
      (versionMatched && !!target && ver === target && attempt >= 2);

    if (ready || (sawDown && ok)) {
      // 若指定了目标版本且已恢复但仍是旧版，继续等（可能尚未切完）
      if (target && ver && ver !== target && !versionChanged) {
        report({
          phase: "waiting_up",
          message: `服务已响应（v${ver}），等待切换到 v${target}…`,
          version: ver,
        });
        await sleep(interval);
        continue;
      }
      report({
        phase: "ready",
        message: ver
          ? `服务已恢复（v${ver}），即将刷新…`
          : "服务已恢复，即将刷新…",
        version: ver,
      });
      await sleep(settleMs);
      window.location.reload();
      return true;
    }

    report({
      phase: "waiting_up",
      message: ver
        ? `服务仍在线（v${ver}），等待重启生效…`
        : "等待服务重启…",
      version: ver,
    });
    await sleep(interval);
  }

  report({
    phase: "timeout",
    message: "等待超时，请手动刷新页面",
  });
  return false;
}
