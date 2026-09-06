"use client";

import { useEffect } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const layoutStorage: ResizablePrimitive.LayoutStorage = {
  getItem(key) {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
  },
};

function readPersistedLayout(id: string) {
  const serialized = layoutStorage.getItem(`react-resizable-panels:${id}`);
  if (!serialized) {
    return;
  }
  try {
    const layout = JSON.parse(serialized) as Record<string, unknown>;
    if (
      Object.keys(layout).length > 0 &&
      Object.values(layout).every((value) => typeof value === "number")
    ) {
      return layout as Record<string, number>;
    }
  } catch {
    // Ignore corrupted local state and keep the declared default layout.
  }
}

function ResizablePanelGroup({
  autoSaveId,
  className,
  id,
  onLayoutChanged,
  ...props
}: ResizablePrimitive.GroupProps & { autoSaveId?: string }) {
  const persistenceId = autoSaveId ?? String(id ?? "resizable-panel-group");
  const groupRef = ResizablePrimitive.useGroupRef();
  const persistedLayout = ResizablePrimitive.useDefaultLayout({
    debounceSaveMs: 0,
    id: persistenceId,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });

  useEffect(() => {
    const initialLayout = readPersistedLayout(persistenceId);
    if (!initialLayout) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      groupRef.current?.setLayout(initialLayout);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [groupRef, persistenceId]);

  return (
    <ResizablePrimitive.Group
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      data-slot="resizable-panel-group"
      groupRef={groupRef}
      id={id}
      onLayoutChange={persistedLayout.onLayoutChange}
      onLayoutChanged={(layout, meta) => {
        persistedLayout.onLayoutChanged(layout, meta);
        onLayoutChanged?.(layout, meta);
      }}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      className={cn(
        "relative w-px shrink-0 bg-border outline-none aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        className
      )}
      data-slot="resizable-handle"
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
