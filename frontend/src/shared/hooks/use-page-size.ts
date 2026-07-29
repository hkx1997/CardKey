import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "cardkey.admin.pageSize";
const ALLOWED = [10, 20, 50, 100] as const;
export type AdminPageSize = (typeof ALLOWED)[number];

function readStored(): AdminPageSize {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if ((ALLOWED as readonly number[]).includes(n)) return n as AdminPageSize;
  } catch {
    /* ignore */
  }
  return 20;
}

/** 进程内共享：设置页改条数后，其它列表页立刻拿到同一默认值 */
let current: AdminPageSize = readStored();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): AdminPageSize {
  return current;
}

function getServerSnapshot(): AdminPageSize {
  return 20;
}

function writePageSize(n: number): AdminPageSize {
  const next = (ALLOWED as readonly number[]).includes(n)
    ? (n as AdminPageSize)
    : 20;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  emit();
  return next;
}

// 多标签页：A 页改了，B 页也同步
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = readStored();
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

/** 管理端列表每页条数（localStorage + 跨组件即时同步） */
export function usePageSize() {
  const pageSize = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setPageSize = useCallback((n: number) => {
    writePageSize(n);
  }, []);

  return { pageSize, setPageSize, options: ALLOWED };
}
