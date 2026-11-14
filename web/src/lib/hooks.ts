"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Fetch + optional polling. Keeps the last good value while refreshing. */
export function useApi<T>(fn: (() => Promise<T>) | null, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(fn));
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  const load = useCallback(async () => {
    const f = fnRef.current;
    if (!f) return;
    try {
      const v = await f();
      setData(v);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fnRef.current) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: load };
}

/** A ticking clock for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
