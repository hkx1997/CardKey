import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 列表 keyset 游标栈：page1 无 cursor，翻到 page N 时带上 page N 的 cursor。
 * 筛选条件变化时自动重置。
 */
export function useListCursor(filterKey: string) {
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<Record<number, string>>({ 1: "" });
  const filterRef = useRef(filterKey);

  useEffect(() => {
    if (filterRef.current === filterKey) return;
    filterRef.current = filterKey;
    setPage(1);
    setCursors({ 1: "" });
  }, [filterKey]);

  const cursor = cursors[page] ?? "";

  const rememberNext = useCallback((currentPage: number, nextCursor?: string) => {
    if (!nextCursor) return;
    setCursors((prev) => ({ ...prev, [currentPage + 1]: nextCursor }));
  }, []);

  const goPage = useCallback((p: number) => {
    setPage(Math.max(1, p));
  }, []);

  const reset = useCallback(() => {
    setPage(1);
    setCursors({ 1: "" });
  }, []);

  return { page, setPage: goPage, cursor, rememberNext, reset, cursors };
}
