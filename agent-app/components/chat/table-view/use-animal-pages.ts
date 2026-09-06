"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnimalGroupNode,
  AnimalPage,
  AnimalRow,
  GroupPath,
} from "@/lib/farm/types";

export type AnimalTableRow =
  | {
      animal: AnimalRow;
      key: string;
      kind: "animal";
      level: number;
    }
  | {
      expanded: boolean;
      group: AnimalGroupNode;
      key: string;
      kind: "group";
      level: number;
    }
  | {
      key: string;
      kind: "loading";
      label: string;
      level: number;
      path: GroupPath;
    }
  | {
      error: string;
      key: string;
      kind: "error";
      level: number;
      path: GroupPath;
    }
  | {
      key: string;
      kind: "more";
      level: number;
      path: GroupPath;
    };

type PageResponse = {
  page: AnimalPage;
  revision: number;
};

type Bucket = {
  error: string | null;
  loading: boolean;
  pages: AnimalPage[];
};

type UseAnimalPagesInput = {
  base: string;
  refreshViewSnapshot: () => Promise<boolean>;
  revision: number;
  viewId: string | null;
};

const ROOT_KEY = "[]";

function pathKey(path: GroupPath) {
  return JSON.stringify(path);
}

function uniqueGroups(pages: AnimalPage[]) {
  const groups = new Map<string, AnimalGroupNode>();
  for (const page of pages) {
    if (page.kind !== "groups") {
      continue;
    }
    for (const group of page.groups) {
      groups.set(pathKey(group.path), group);
    }
  }
  return [...groups.values()];
}

function uniqueRows(pages: AnimalPage[]) {
  const rows = new Map<string, AnimalRow>();
  for (const page of pages) {
    if (page.kind !== "rows") {
      continue;
    }
    for (const row of page.rows) {
      rows.set(row.animalId, row);
    }
  }
  return [...rows.values()];
}

function getLastPage(bucket: Bucket | undefined) {
  return bucket?.pages.at(-1);
}

function getNextCursor(bucket: Bucket | undefined) {
  return getLastPage(bucket)?.nextCursor ?? null;
}

function hasFinished(bucket: Bucket | undefined) {
  const last = getLastPage(bucket);
  return Boolean(last && (last.end || last.nextCursor === null));
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Не удалось загрузить данные";
}

function runInBackground(task: Promise<unknown>) {
  task.catch(() => undefined);
}

export function useAnimalPages({
  base,
  refreshViewSnapshot,
  revision,
  viewId,
}: UseAnimalPagesInput) {
  const versionKey = viewId ? `${viewId}:${revision}` : "disabled";
  const activeVersionRef = useRef(versionKey);
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());
  const collapsedKeysRef = useRef(new Set<string>());
  const skipAutoExpandRef = useRef(false);
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set()
  );

  const requestPage = useCallback(
    async (path: GroupPath, cursor: string | null, replace = false) => {
      if (!viewId) {
        return;
      }
      const bucketKey = pathKey(path);
      const generation = generationRef.current;
      const requestKey = `${versionKey}:${generation}:${bucketKey}:${cursor ?? "first"}`;
      if (inFlightRef.current.has(requestKey)) {
        return;
      }
      inFlightRef.current.add(requestKey);
      setBuckets((current) => ({
        ...current,
        [bucketKey]: {
          error: null,
          loading: true,
          pages: replace ? [] : (current[bucketKey]?.pages ?? []),
        },
      }));

      try {
        const response = await fetch(`${base}/api/farm/animals`, {
          body: JSON.stringify({
            cursor,
            groupPath: path,
            limit: 50,
            viewId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json()) as PageResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "ANIMAL_QUERY_FAILED");
        }
        if (
          activeVersionRef.current !== versionKey ||
          generationRef.current !== generation ||
          payload.revision !== revision
        ) {
          return;
        }
        setBuckets((current) => {
          const existing = current[bucketKey]?.pages ?? [];
          const pages = replace ? [payload.page] : [...existing, payload.page];
          return {
            ...current,
            [bucketKey]: { error: null, loading: false, pages },
          };
        });
      } catch (cause) {
        if (
          activeVersionRef.current !== versionKey ||
          generationRef.current !== generation
        ) {
          return;
        }
        setBuckets((current) => ({
          ...current,
          [bucketKey]: {
            error: errorMessage(cause),
            loading: false,
            pages: current[bucketKey]?.pages ?? [],
          },
        }));
      } finally {
        inFlightRef.current.delete(requestKey);
      }
    },
    [base, revision, versionKey, viewId]
  );

  useEffect(() => {
    activeVersionRef.current = versionKey;
    generationRef.current += 1;
    setBuckets({});
    setExpandedKeys(new Set());
    skipAutoExpandRef.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(`arka-collapsed-groups:${viewId}`) ?? "[]");
      collapsedKeysRef.current = new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
    } catch {
      collapsedKeysRef.current = new Set();
    }
    if (viewId) {
      runInBackground(requestPage([], null, true));
    }
  }, [requestPage, versionKey, viewId]);

  useEffect(() => {
    if (skipAutoExpandRef.current) {
      skipAutoExpandRef.current = false;
      return;
    }
    if (!viewId) return;
    const keys = new Set<string>();
    const pending: GroupPath[] = [];
    const visit = (path: GroupPath) => {
      for (const group of uniqueGroups(buckets[pathKey(path)]?.pages ?? [])) {
        const key = pathKey(group.path);
        if (collapsedKeysRef.current.has(key)) continue;
        keys.add(key);
        const bucket = buckets[key];
        if (!bucket) pending.push(group.path);
        else visit(group.path);
      }
    };
    visit([]);
    setExpandedKeys(current =>
      current.size === keys.size && [...keys].every(key => current.has(key)) ? current : keys
    );
    const capacity = Math.max(0, 4 - Object.values(buckets).filter(bucket => bucket.loading).length);
    for (const path of pending.slice(0, capacity)) runInBackground(requestPage(path, null, true));
  }, [buckets, requestPage, viewId]);

  const toggleGroup = useCallback(
    (path: GroupPath) => {
      const key = pathKey(path);
      const willExpand = !expandedKeys.has(key);
      if (willExpand) collapsedKeysRef.current.delete(key);
      else collapsedKeysRef.current.add(key);
      try {
        localStorage.setItem(`arka-collapsed-groups:${viewId}`, JSON.stringify([...collapsedKeysRef.current]));
      } catch {
        // Keep the current session state when browser storage is unavailable.
      }
      setExpandedKeys((current) => {
        const next = new Set(current);
        if (willExpand) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
      if (willExpand && !buckets[key]?.pages.length && !buckets[key]?.loading) {
        runInBackground(requestPage(path, null, true));
      }
    },
    [buckets, expandedKeys, requestPage, viewId]
  );

  const loadMore = useCallback(
    (path: GroupPath) => {
      const bucket = buckets[pathKey(path)];
      const cursor = getNextCursor(bucket);
      if (cursor && !bucket?.loading) {
        runInBackground(requestPage(path, cursor));
      }
    },
    [buckets, requestPage]
  );

  const retry = useCallback(
    (path: GroupPath) => {
      const bucket = buckets[pathKey(path)];
      if (
        bucket?.error &&
        [
          "RULE_SNAPSHOT_STALE",
          "RULE_PROJECTION_STALE",
          "CURSOR_STALE",
        ].includes(bucket.error)
      ) {
        if (bucket.loading) {
          return;
        }
        setBuckets((current) => ({
          ...current,
          [pathKey(path)]: { ...bucket, loading: true },
        }));
        runInBackground(
          (async () => {
            try {
              const changed = await refreshViewSnapshot();
              if (activeVersionRef.current !== versionKey) {
                return;
              }
              // A new view revision resets every group/page through the existing effect.
              if (!changed) {
                generationRef.current += 1;
                setBuckets({});
                setExpandedKeys(new Set());
                await requestPage([], null, true);
              }
            } catch (cause) {
              if (activeVersionRef.current !== versionKey) {
                return;
              }
              setBuckets((current) => ({
                ...current,
                [pathKey(path)]: {
                  ...bucket,
                  error: errorMessage(cause),
                  loading: false,
                },
              }));
            }
          })()
        );
        return;
      }
      const cursor = getNextCursor(bucket);
      runInBackground(requestPage(path, cursor, bucket?.pages.length === 0));
    },
    [buckets, refreshViewSnapshot, requestPage, versionKey]
  );

  const rows = useMemo(() => {
    const result: AnimalTableRow[] = [];
    const appendBucket = (path: GroupPath, level: number) => {
      const key = pathKey(path);
      const bucket = buckets[key];
      const pages = bucket?.pages ?? [];
      const [first] = pages;

      if (!first && bucket?.loading) {
        result.push({
          key: `loading:${key}`,
          kind: "loading",
          label: level === 0 ? "Загружаем животных…" : "Загружаем группу…",
          level,
          path,
        });
        return;
      }
      if (!first && bucket?.error) {
        result.push({
          error: bucket.error,
          key: `error:${key}`,
          kind: "error",
          level,
          path,
        });
        return;
      }
      if (!first) {
        return;
      }

      if (first.kind === "groups") {
        for (const group of uniqueGroups(pages)) {
          const groupKey = pathKey(group.path);
          result.push({
            expanded: expandedKeys.has(groupKey),
            group,
            key: `group:${groupKey}`,
            kind: "group",
            level,
          });
          if (expandedKeys.has(groupKey)) {
            appendBucket(group.path, level + 1);
          }
        }
      } else {
        for (const animal of uniqueRows(pages)) {
          result.push({
            animal,
            key: animal.animalId,
            kind: "animal",
            level,
          });
        }
      }

      if (bucket?.error) {
        result.push({
          error: bucket.error,
          key: `error:${key}:${pages.length}`,
          kind: "error",
          level,
          path,
        });
      } else if (!hasFinished(bucket)) {
        result.push({
          key: `more:${key}:${pages.length}`,
          kind: "more",
          level,
          path,
        });
      }
    };

    appendBucket([], 0);
    return result;
  }, [buckets, expandedKeys]);

  const rootBucket = buckets[ROOT_KEY];
  const rootPage = rootBucket?.pages[0];
  const expandedGroupPaths = useMemo(
    () => [...expandedKeys].map((key) => JSON.parse(key) as GroupPath),
    [expandedKeys]
  );
  return {
    expandedGroupPaths,
    initialError:
      rootBucket?.error && rootBucket.pages.length === 0
        ? rootBucket.error
        : null,
    isInitialLoading: Boolean(rootBucket?.loading && !rootPage),
    isLoading: Object.values(buckets).some((bucket) => bucket.loading),
    loadMore,
    retry,
    rootComplete: hasFinished(rootBucket),
    rootKind: rootPage?.kind ?? null,
    rows,
    toggleGroup,
    totalRows: rootPage?.totalRows ?? 0,
  };
}
