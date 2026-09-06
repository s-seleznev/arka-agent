"use client";

import { useCallback, useMemo, useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import type { GroupPath, ReportViewState } from "@/lib/farm/types";
import type { Attachment } from "@/lib/types";

export type WorkspacePreview = {
  attachment: Attachment | null;
  animalCard: Record<string, unknown> | null;
  expandedGroupPaths: GroupPath[];
  isVisible: boolean;
  selectedIds: string[];
  title?: string;
  type: "file" | "list" | "table" | null;
  view: ReportViewState | null;
  viewportRowIds: string[];
};

export const initialWorkspacePreview: WorkspacePreview = {
  animalCard: null,
  attachment: null,
  expandedGroupPaths: [],
  isVisible: false,
  selectedIds: [],
  type: null,
  view: null,
  viewportRowIds: [],
};

export function useWorkspacePreview() {
  const routePathname = usePathname();
  const assistantPathRef = useRef(routePathname.startsWith("/arka") ? "/" : routePathname);
  if (!routePathname.startsWith("/arka")) assistantPathRef.current = routePathname;
  const pathname = assistantPathRef.current;
  const scope = pathname.startsWith("/chat/") ? pathname : "new";
  const { data, mutate } = useSWR<WorkspacePreview>(`workspace-preview:${scope}`, null, {
    fallbackData: initialWorkspacePreview,
  });
  const preview = useMemo(() => data ?? initialWorkspacePreview, [data]);

  const openFile = useCallback(
    (attachment: Attachment) => {
      mutate(
        (current) => ({
          ...(current ?? initialWorkspacePreview),
          attachment,
          isVisible: true,
          type: "file",
        }),
        false
      );
    },
    [mutate]
  );
  const close = useCallback(() => {
    mutate(
      (current) =>
        current?.view
          ? {
              ...current,
              animalCard: null,
              attachment: null,
              isVisible: true,
              title: undefined,
              type: "table",
            }
          : initialWorkspacePreview,
      false
    );
  }, [mutate]);
  const openStructuredView = useCallback(
    (type: "list" | "table", title: string) => {
      mutate(
        (current) => ({
          ...(current ?? initialWorkspacePreview),
          attachment: null,
          isVisible: true,
          title,
          type,
        }),
        false
      );
    },
    [mutate]
  );

  return { close, openFile, openStructuredView, preview, setPreview: mutate };
}


export function WorkspacePreviewPersistence() {
  const { data: session } = useSession();
  const { preview, setPreview } = useWorkspacePreview();
  const pathname = usePathname();
  const key = session?.user?.id && pathname.startsWith("/chat/") ? `arka-table:${session.user.id}:${pathname}` : null;
  const restoredKeys = useRef(new Set<string>());
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!key) {
      if (pathname === "/") void setPreview(initialWorkspacePreview, false);
      return;
    }
    if (restoredKeys.current.has(key)) { setRestoredKey(key); return; }
    let cancelled = false;
    const restore = async () => {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const value = JSON.parse(stored);
          if (typeof value.isVisible === "boolean") await setPreview({ ...initialWorkspacePreview, ...value, attachment: null, animalCard: null, type: "table" }, false);
        } else {
          const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/views?chatId=${pathname.split("/")[2]}`);
          if (response.ok) {
            const { view } = await response.json();
            if (!cancelled && view) await setPreview({ ...initialWorkspacePreview, type: "table", view, isVisible: true }, false);
          }
        }
      } catch { /* Keep the empty state when restoration is unavailable. */ }
      if (!cancelled) { restoredKeys.current.add(key); setRestoredKey(key); }
    };
    void restore();
    return () => { cancelled = true; };
  }, [key, pathname, setPreview]);
  useEffect(() => {
    if (!key || restoredKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify({ ...preview, attachment: null, animalCard: null, type: "table" })); } catch { /* Storage may be disabled. */ }
  }, [key, restoredKey, preview]);
  return null;
}
