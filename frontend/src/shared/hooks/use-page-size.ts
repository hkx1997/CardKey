import { useCallback, useState } from "react";

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

/** 管理端列表每页条数（localStorage，跨页共享） */
export function usePageSize() {
  const [pageSize, setPageSizeState] = useState<AdminPageSize>(readStored);

  const setPageSize = useCallback((n: number) => {
    const next = (ALLOWED as readonly number[]).includes(n)
      ? (n as AdminPageSize)
      : 20;
    setPageSizeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  return { pageSize, setPageSize, options: ALLOWED };
}
