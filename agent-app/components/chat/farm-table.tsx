// biome-ignore-all lint/performance/noJsxPropsBind: grid cells and retry states need row-scoped handlers.
"use client";

import {
  ChevronRightIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type MouseEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DataGrid, {
  type Column,
  type RenderRowProps,
  Row,
} from "react-data-grid";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { canRebaseViewOperations } from "@/components/chat/table-view/rebase";
import {
  type AnimalTableRow,
  useAnimalPages,
} from "@/components/chat/table-view/use-animal-pages";
import {
  type TableField,
  TableViewControls,
} from "@/components/chat/table-view/view-controls";
import { TableExportFooter } from "@/components/chat/table-view/export-footer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialWorkspacePreview,
  useWorkspacePreview,
} from "@/hooks/use-workspace-preview";
import type {
  AnimalGroupNode,
  AnimalRow,
  FarmSummary,
  GroupPath,
  ReportViewState,
  ViewOperation,
} from "@/lib/farm/types";
import { applyViewOperations } from "@/lib/farm/view-model";
import { cn, fetchWithErrorHandlers } from "@/lib/utils";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { FarmScene } from "./farm-scene";


type FarmResponse = { farms: FarmSummary[]; fields: TableField[] };
type ViewResponse = { view: ReportViewState | null };
type ViewMutationResponse = {
  current?: ReportViewState;
  error?: string;
  view?: ReportViewState;
};

type ViewRequestScope = {
  chatId: string;
  revision: number;
  viewId: string;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithErrorHandlers(url, init);
  return response.json() as Promise<T>;
}

function runInBackground(task: Promise<unknown>) {
  task.catch(() => undefined);
}

function formatValue(
  value: unknown,
  field?: Pick<TableField, "type" | "unit">
) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }
  if (field?.type === "number" && typeof value === "number") {
    return `${new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 1,
    }).format(value)}${field.unit ? ` ${field.unit}` : ""}`;
  }
  if (field?.type === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("ru-RU").format(date);
    }
  }
  return String(value);
}

function AnimalNumberCell({
  onOpen,
  row,
}: {
  onOpen: (row: AnimalRow, opener: HTMLButtonElement) => void;
  row: AnimalRow;
}) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onOpen(row, event.currentTarget),
    [onOpen, row]
  );
  const number = formatValue(row.primaryIdentifier);

  return (
    <div className="flex h-full w-full min-w-0 items-center gap-1">
      <Button
        aria-label={`Открыть карточку животного ${number}`}
        className="h-full max-w-[calc(100%-1.75rem)] min-w-0 justify-start rounded-none px-0 font-normal hover:bg-transparent hover:underline"
        data-testid="animal-number-link"
        onClick={handleClick}
        size="sm"
        style={{ color: "inherit" }}
        variant="ghost"
      >
        <span className="truncate">{number}</span>
      </Button>
      <Button
        aria-label={`Открыть расширенное описание животного ${number}`}
        className="ml-auto invisible opacity-0 transition-opacity focus-visible:visible focus-visible:opacity-100 group-focus-within/animal-cell:visible group-focus-within/animal-cell:opacity-100 group-hover/animal-cell:visible group-hover/animal-cell:opacity-100"
        data-testid="animal-card-button"
        onClick={handleClick}
        size="icon-xs"
        variant="ghost"
      >
        <PanelRightOpenIcon />
      </Button>
    </div>
  );
}

function ServerGroupCell({
  expanded,
  field,
  group,
  level,
  onToggle,
}: {
  expanded: boolean;
  field?: TableField;
  group: AnimalGroupNode;
  level: number;
  onToggle: (path: GroupPath) => void;
}) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onToggle(group.path);
    },
    [group.path, onToggle]
  );
  const label =
    group.value === null || group.value === undefined || group.value === ""
      ? "Не указано"
      : formatValue(group.value, field);
  const count = new Intl.NumberFormat("ru-RU").format(group.count);

  return (
    <Button
      aria-expanded={expanded}
      aria-label={`${expanded ? "Свернуть" : "Развернуть"} группу ${field?.label ?? group.field}: ${label}, ${count} животных`}
      className="h-full w-full min-w-0 justify-start gap-1.5 rounded-none px-0 font-medium hover:bg-transparent active:bg-transparent aria-expanded:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      onClick={handleClick}
      size="sm"
      style={{
        paddingLeft: `${level * 16}px`,
        paddingRight: "8px",
      }}
      type="button"
      variant="ghost"
    >
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)]",
          expanded && "rotate-90"
        )}
        data-icon="inline-start"
      />
      <span className="shrink-0 whitespace-nowrap">{field?.label ?? group.field}: {label}</span>
      <span className="shrink-0 rounded-full bg-[var(--neutral-container-default)] px-2 py-0.5 font-normal text-muted-foreground text-xs tabular-nums">
        {count}
      </span>
    </Button>
  );
}

function StickyGroupHeader({ rows, scrollTop, fieldMap, onToggle }: {
  rows: AnimalTableRow[];
  scrollTop: number;
  fieldMap: Map<string, TableField>;
  onToggle: (path: GroupPath) => void;
}) {
  let active: Extract<AnimalTableRow, { kind: "group" }> | undefined;
  let nextTop = Infinity;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind !== "group") continue;
    const top = index * 35 - scrollTop;
    if (top <= 0) active = row;
    else { nextTop = top; break; }
  }
  if (!active || scrollTop <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[35px] z-[4] h-[35px] overflow-hidden">
      <div
        className="pointer-events-auto h-[35px] border-b bg-white pl-6"
        style={{ transform: `translateY(${Math.min(0, nextTop - 35)}px)` }}
      >
        <ServerGroupCell expanded={active.expanded} field={fieldMap.get(active.group.field)}
          group={active.group} level={active.level} onToggle={onToggle} />
      </div>
    </div>
  );
}

function renderTableRow(key: React.Key, props: RenderRowProps<AnimalTableRow>) {
  const { row } = props;
  return (
    <Row
      {...props}
      aria-expanded={row.kind === "group" ? row.expanded : undefined}
      aria-level={
        row.kind === "group" || row.kind === "animal"
          ? row.level + 1
          : undefined
      }
      data-animal-id={row.kind === "animal" ? row.animal.animalId : undefined}
      data-group-level={row.kind === "group" ? row.level : undefined}
      data-load-path={
        row.kind === "more" ? JSON.stringify(row.path) : undefined
      }
      data-row-kind={row.kind}
      key={key}
    />
  );
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function renderedRowRect(element: HTMLElement) {
  const ownRect = element.getBoundingClientRect();
  if (ownRect.height > 0) {
    return ownRect;
  }
  return (
    element
      .querySelector<HTMLElement>('[role="gridcell"]')
      ?.getBoundingClientRect() ?? ownRect
  );
}

export function FarmTableWorkspace() {
  const { chatId: activeChatId } = useActiveChat();
  const pathname = usePathname();
  const router = useRouter();
  const { preview, setPreview } = useWorkspacePreview();
  const farmMode = preview.displayMode === "farm";
  const [sceneMounted, setSceneMounted] = useState(farmMode);
  useEffect(() => { if (farmMode) setSceneMounted(true); }, [farmMode]);
  const chatId = activeChatId;
  const { mutate: mutateCache } = useSWRConfig();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const {
    data: farmData,
    error: farmError,
    mutate: mutateFarms,
  } = useSWR<FarmResponse>(
    `${base}/api/farms`,
    (url: string) => jsonRequest(url),
    { revalidateOnFocus: true, errorRetryCount: 2, errorRetryInterval: 1500 }
  );
  const viewKey = `${base}/api/views?chatId=${chatId}`;
  const {
    data: viewData,
    error: viewError,
    mutate: mutateView,
    isLoading: viewLoading,
  } = useSWR<ViewResponse>(viewKey, (url: string) => jsonRequest(url), {
    revalidateOnFocus: false,
  });
  const previewView = preview.view?.chatId === chatId ? preview.view : null;
  const view = viewData?.view ?? previewView;
  const viewRef = useRef(view);
  const activeChatIdRef = useRef(chatId);
  activeChatIdRef.current = chatId;
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const animalCardRequestRef = useRef(0);
  const [creationByChat, setCreationByChat] = useState<
    Record<string, { error: string | null; pending: boolean }>
  >({});
  const [mutatingCounts, setMutatingCounts] = useState<Record<string, number>>(
    {}
  );
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [failedOperations, setFailedOperations] = useState<
    ViewOperation[] | null
  >(null);
  const animalCardOpenerRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const viewportIdsRef = useRef<string[]>([]);
  const scanFrameRef = useRef<number | null>(null);
  const fields = useMemo(
    () =>
      (farmData?.fields ?? []).map((field) =>
        field.id === "farmId"
          ? {
              ...field,
              options: (farmData?.farms ?? []).map((farm) => ({
                label: farm.name,
                value: { type: "string" as const, value: farm.id },
              })),
            }
          : field
      ),
    [farmData?.farms, farmData?.fields]
  );
  const fieldMap = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields]
  );
  const creationStatus = creationByChat[chatId];
  const creating = creationStatus?.pending ?? false;
  const creationError = creationStatus?.error ?? null;
  const mutatingCount = mutatingCounts[chatId] ?? 0;

  useEffect(() => {
    activeChatIdRef.current = chatId;
    viewRef.current = view;
  }, [chatId, view]);

  useEffect(() => {
    if (activeChatIdRef.current !== chatId) {
      return;
    }
    mutationQueueRef.current = Promise.resolve();
    animalCardRequestRef.current += 1;
    setFailedOperations(null);
    setViewNotice(null);
  }, [chatId]);

  useEffect(() => {
    if (view || viewLoading || creating || creationError || !farmData?.farms[0]) {
      return;
    }
    const targetChatId = chatId;
    const targetViewKey = viewKey;
    setCreationByChat((current) => ({
      ...current,
      [targetChatId]: { error: null, pending: true },
    }));
    jsonRequest<ViewResponse>(`${base}/api/views`, {
      body: JSON.stringify({ chatId, farmId: farmData.farms[0].id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then(async (created) => {
        if (!created.view) {
          throw new Error("VIEW_CREATE_FAILED");
        }
        const unfiltered = await jsonRequest<ViewResponse>(`${base}/api/views/${created.view.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: created.view.revision, patch: { filters: { ...created.view.filters, children: [] } } }),
        });
        const createdView = unfiltered.view;
        if (!createdView) throw new Error("VIEW_CREATE_FAILED");
        await mutateCache(
          targetViewKey,
          (current: ViewResponse | undefined) => {
            if (
              current?.view &&
              (current.view.id !== createdView.id ||
                current.view.revision > createdView.revision)
            ) {
              return current;
            }
            return { view: createdView };
          },
          { revalidate: false }
        );
        runInBackground(
          mutateCache(unstable_serialize(getChatHistoryPaginationKey))
        );
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "VIEW_CREATE_FAILED";
        setCreationByChat((current) => ({
          ...current,
          [targetChatId]: { error: message, pending: false },
        }));
      })
      .finally(() =>
        setCreationByChat((current) => ({
          ...current,
          [targetChatId]: {
            error: current[targetChatId]?.error ?? null,
            pending: false,
          },
        }))
      );
  }, [
    base,
    chatId,
    creating,
    creationError,
    farmData?.farms,
    mutateCache,
    viewKey,
    viewData?.view,
    view,
    viewLoading,
  ]);

  useEffect(() => {
    if (!view) {
      return;
    }
    setPreview(
      (current) => ({
        ...(current ?? initialWorkspacePreview),
        attachment: null,
        isVisible: true,
        type: "table",
        view,
      }),
      false
    );
  }, [setPreview, view]);

  const refreshViewSnapshot = useCallback(async () => {
    const { current } = viewRef;
    if (!current) {
      throw new Error("VIEW_NOT_FOUND");
    }
    const targetViewKey = `${base}/api/views?chatId=${current.chatId}`;
    const response = await fetch(`${base}/api/views/${current.id}`, {
      body: JSON.stringify({
        action: "refresh_snapshot",
        expectedRevision: current.revision,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as ViewMutationResponse;
    const updated = response.status === 409 ? payload.current : payload.view;
    if (!updated || (!response.ok && response.status !== 409)) {
      throw new Error(payload.error ?? "Не удалось обновить данные таблицы");
    }
    if (updated.id !== current.id) {
      throw new Error("VIEW_UPDATE_FAILED");
    }
    await mutateCache(
      targetViewKey,
      (cached: ViewResponse | undefined) =>
        cached?.view &&
        (cached.view.id !== updated.id ||
          cached.view.revision > updated.revision)
          ? cached
          : { view: updated },
      { revalidate: false }
    );
    if (
      activeChatIdRef.current === current.chatId &&
      viewRef.current?.id === updated.id &&
      viewRef.current.revision <= updated.revision
    ) {
      viewRef.current = updated;
    }
    return updated.revision !== current.revision;
  }, [base, mutateCache]);

  const pages = useAnimalPages({
    base,
    refreshViewSnapshot,
    revision: view?.revision ?? 0,
    viewId: view?.id ?? null,
  });
  const viewVersionKey = view ? `${view.id}:${view.revision}` : null;

  useEffect(() => {
    if (!viewVersionKey) {
      return;
    }
    viewportIdsRef.current = [];
    setPreview(
      (current) => ({
        ...(current ?? initialWorkspacePreview),
        expandedGroupPaths: [],
        viewportRowIds: [],
      }),
      false
    );
  }, [setPreview, viewVersionKey]);

  useEffect(() => {
    if (!view) {
      return;
    }
    setPreview(
      (current) => ({
        ...(current ?? initialWorkspacePreview),
        expandedGroupPaths: pages.expandedGroupPaths,
        selectedIds: current?.selectedIds ?? [],
        view,
        viewportRowIds: viewportIdsRef.current,
      }),
      false
    );
  }, [pages.expandedGroupPaths, setPreview, view]);

  const sendOperations = useCallback(
    async (operations: ViewOperation[], scope: ViewRequestScope) => {
      const targetViewKey = `${base}/api/views?chatId=${scope.chatId}`;
      const cacheScopedView = async (candidate?: ReportViewState) => {
        if (!candidate || candidate.id !== scope.viewId) {
          return;
        }
        await mutateCache(
          targetViewKey,
          (current: ViewResponse | undefined) => {
            if (
              current?.view &&
              (current.view.id !== candidate.id ||
                current.view.revision > candidate.revision)
            ) {
              return current;
            }
            return { view: candidate };
          },
          { revalidate: false }
        );
      };
      const scopeIsActive = () => {
        const currentView = viewRef.current;
        return (
          activeChatIdRef.current === scope.chatId &&
          currentView?.id === scope.viewId &&
          currentView.revision >= scope.revision
        );
      };
      if (!scopeIsActive()) {
        return;
      }
      const baseView = viewRef.current as ReportViewState;
      setMutatingCounts((current) => ({
        ...current,
        [scope.chatId]: (current[scope.chatId] ?? 0) + 1,
      }));
      try {
        const request = async (expected: ReportViewState) => {
          // Pure shared validation uses only the authorized catalogue, never SQL.
          applyViewOperations(
            expected,
            operations,
            Object.fromEntries(
              fields.map((field) => [field.id, { ...field, sql: "" }])
            )
          );
          const response = await fetch(`${base}/api/views/${expected.id}`, {
            body: JSON.stringify({
              expectedRevision: expected.revision,
              operations,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          });
          const payload = (await response.json()) as ViewMutationResponse;
          return { payload, response };
        };

        let { payload, response } = await request(baseView);
        if (!scopeIsActive()) {
          await cacheScopedView(payload.view ?? payload.current);
          return;
        }
        let rebased = false;

        if (response.status === 409 && payload.current) {
          await cacheScopedView(payload.current);
          if (!scopeIsActive()) {
            return;
          }
          const activeView = viewRef.current;
          const latestView =
            activeView?.id === payload.current.id &&
            activeView.revision > payload.current.revision
              ? activeView
              : payload.current;
          viewRef.current = latestView;
          if (canRebaseViewOperations(baseView, latestView, operations)) {
            rebased = true;
            ({ payload, response } = await request(latestView));
            if (!scopeIsActive()) {
              await cacheScopedView(payload.view ?? payload.current);
              return;
            }
          }
        }

        const next = payload.view ?? payload.current;
        if (next) {
          await cacheScopedView(next);
          if (!scopeIsActive()) {
            return;
          }
          const activeView = viewRef.current;
          if (
            activeView?.id !== next.id ||
            activeView.revision <= next.revision
          ) {
            viewRef.current = next;
          }
        }
        if (response.status === 409) {
          throw new Error(
            "Таблица изменилась параллельно. Проверьте актуальные правила и повторите действие."
          );
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "Не удалось изменить таблицу");
        }
        setFailedOperations(null);
        setViewNotice(
          rebased
            ? "Независимое изменение применено поверх новой версии таблицы."
            : null
        );
      } catch (cause) {
        if (!scopeIsActive()) {
          return;
        }
        const message =
          cause instanceof Error
            ? cause.message
            : "Не удалось изменить таблицу";
        setFailedOperations(operations);
        setViewNotice(message);
        throw cause;
      } finally {
        setMutatingCounts((current) => {
          const nextCount = Math.max(0, (current[scope.chatId] ?? 0) - 1);
          if (nextCount > 0) {
            return { ...current, [scope.chatId]: nextCount };
          }
          const { [scope.chatId]: _, ...rest } = current;
          return rest;
        });
      }
    },
    [base, mutateCache, fields]
  );

  const applyOperations = useCallback(
    (operations: ViewOperation[]) => {
      const currentView = viewRef.current;
      if (!currentView || activeChatIdRef.current !== chatId) {
        return Promise.reject(
          new Error("Представление таблицы ещё не загружено")
        );
      }
      const scope: ViewRequestScope = {
        chatId,
        revision: currentView.revision,
        viewId: currentView.id,
      };
      const task = mutationQueueRef.current.then(() =>
        sendOperations(operations, scope)
      );
      mutationQueueRef.current = task.catch(() => undefined);
      return task;
    },
    [chatId, sendOperations]
  );

  const retryFailedOperations = useCallback(() => {
    if (failedOperations) {
      applyOperations(failedOperations).catch(() => undefined);
    }
  }, [applyOperations, failedOperations]);

  const openAnimal = useCallback(
    async (row: AnimalRow, opener: HTMLButtonElement) => {
      const { current: currentView } = viewRef;
      if (!currentView || activeChatIdRef.current !== chatId) {
        return;
      }
      const requestId = animalCardRequestRef.current + 1;
      animalCardRequestRef.current = requestId;
      const scope: ViewRequestScope = {
        chatId,
        revision: currentView.revision,
        viewId: currentView.id,
      };
      animalCardOpenerRef.current = opener;
      try {
        const payload = await jsonRequest<{ animal: Record<string, unknown> }>(
          `${base}/api/farm/animal`,
          {
            body: JSON.stringify({
              animalId: row.animalId,
              farmId: row.farmId,
              viewId: currentView.id,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }
        );
        if (
          animalCardRequestRef.current !== requestId ||
          activeChatIdRef.current !== scope.chatId ||
          viewRef.current?.id !== scope.viewId ||
          viewRef.current.revision !== scope.revision
        ) {
          return;
        }
        setPreview(
          (currentPreview) => ({
            ...(currentPreview ?? initialWorkspacePreview),
            animalCard: payload.animal,
            selectedIds: [row.animalId],
          }),
          false
        );
      } catch {
        if (
          animalCardRequestRef.current !== requestId ||
          activeChatIdRef.current !== scope.chatId ||
          viewRef.current?.id !== scope.viewId ||
          viewRef.current.revision !== scope.revision
        ) {
          return;
        }
        setViewNotice("Не удалось открыть карточку животного.");
      }
    },
    [base, chatId, setPreview]
  );

  const visibleColumns = useMemo(() => {
    if (!view) {
      return [];
    }
    return [
      "primaryIdentifier",
      ...Array.from(
        new Set(view.columns)
      ).filter((fieldId) => fieldId !== "primaryIdentifier"),
    ];
  }, [view]);

  const columns = useMemo<Column<AnimalTableRow>[]>(() => {
    if (!view) {
      return [];
    }
    const [firstColumn] = visibleColumns;
    return visibleColumns.map((fieldId) => {
      const field = fieldMap.get(fieldId);
      return {
        cellClass: (row) => {
          if (row.kind === "group") {
            return fieldId === firstColumn
              ? `farm-group-label-cell${fieldId === "primaryIdentifier" ? " farm-frozen-cell" : ""}`
              : `farm-group-empty-cell${fieldId === "primaryIdentifier" ? " farm-frozen-cell" : ""}`;
          }
          return row.kind === "animal" && fieldId === "primaryIdentifier"
            ? "group/animal-cell farm-frozen-cell"
            : undefined;
        },
        frozen: fieldId === "primaryIdentifier",
        headerCellClass: fieldId === "primaryIdentifier" ? "farm-frozen-cell" : undefined,
        key: fieldId,
        name: field?.label ?? fieldId,
        renderHeaderCell: () => (
          <div className="flex h-full min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{field?.label ?? fieldId}</span>
            {fieldId !== "primaryIdentifier" && <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button className="farm-column-menu shrink-0" size="icon-xs" variant="ghost"
                  aria-label={`Меню колонки ${field?.label ?? fieldId}`}
                  onClick={event => event.stopPropagation()}>
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={mutatingCount > 0}
                  onSelect={() => runInBackground(applyOperations([{
                    type: "view.update", patch: { columns: view.columns.filter(id => id !== fieldId) },
                  }]))}>
                  Скрыть колонку
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        ),
        renderCell: ({ row }: { row: AnimalTableRow }) => {
          if (row.kind === "animal") {
            return fieldId === "primaryIdentifier" ? (
              <AnimalNumberCell onOpen={openAnimal} row={row.animal} />
            ) : (
              formatValue(row.animal[fieldId], field)
            );
          }
          if (fieldId !== firstColumn) {
            return null;
          }
          if (row.kind === "group") {
            return (
              <ServerGroupCell
                expanded={row.expanded}
                field={fieldMap.get(row.group.field)}
                group={row.group}
                level={row.level}
                onToggle={pages.toggleGroup}
              />
            );
          }
          if (row.kind === "more") {
            return (
              <Button
                className="justify-start"
                data-testid="farm-load-more"
                onClick={() => pages.loadMore(row.path)}
                size="xs"
                style={{ marginLeft: `${row.level * 16}px` }}
                variant="ghost"
              >
                Загрузить ещё
              </Button>
            );
          }
          if (row.kind === "error") {
            return (
              <div
                className="flex items-center gap-2"
                role="alert"
                style={{ marginLeft: `${row.level * 16}px` }}
              >
                <span className="truncate text-destructive">
                  Не удалось загрузить продолжение
                </span>
                <Button
                  data-testid="farm-page-retry"
                  onClick={() => pages.retry(row.path)}
                  size="xs"
                  variant="outline"
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Повторить
                </Button>
              </div>
            );
          }
          return (
            <span
              className="text-muted-foreground"
              style={{ marginLeft: `${row.level * 16}px` }}
            >
              {row.label}
            </span>
          );
        },
        resizable: true,
        width:
          fieldId === "primaryIdentifier"
            ? view.groupBy.length > 0
              ? 220
              : 144
            : fieldId === "name"
              ? 190
              : 150,
      } satisfies Column<AnimalTableRow>;
    });
  }, [applyOperations, fieldMap, mutatingCount, openAnimal, pages, view, visibleColumns]);

  const scanViewport = useCallback(() => {
    if (farmMode) return;
    if (scanFrameRef.current !== null) {
      cancelAnimationFrame(scanFrameRef.current);
    }
    scanFrameRef.current = requestAnimationFrame(() => {
      scanFrameRef.current = null;
      const root = gridRef.current;
      if (!root) {
        return;
      }
      const grid = root.querySelector<HTMLElement>(".farm-data-grid");
      setGridScrollTop(grid?.scrollTop ?? 0);
      const bounds = root.getBoundingClientRect();
      const visibleIds = [
        ...root.querySelectorAll<HTMLElement>("[data-animal-id]"),
      ]
        .filter((element) => {
          const rect = renderedRowRect(element);
          return rect.bottom > bounds.top && rect.top < bounds.bottom;
        })
        .map((element) => element.dataset.animalId)
        .filter((value): value is string => Boolean(value));

      if (!sameIds(viewportIdsRef.current, visibleIds)) {
        viewportIdsRef.current = visibleIds;
        setPreview(
          (current) => ({
            ...(current ?? initialWorkspacePreview),
            viewportRowIds: visibleIds,
          }),
          false
        );
      }

      for (const element of root.querySelectorAll<HTMLElement>(
        "[data-load-path]"
      )) {
        const rect = renderedRowRect(element);
        if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
          continue;
        }
        const serialized = element.dataset.loadPath;
        if (!serialized) {
          continue;
        }
        try {
          pages.loadMore(JSON.parse(serialized) as GroupPath);
        } catch {
          // The attribute is written by this component; malformed state is ignored.
        }
      }
    });
  }, [farmMode, pages, setPreview]);

  const reportSceneViewport = useCallback((ids: string[]) => {
    if (sameIds(viewportIdsRef.current, ids)) return;
    viewportIdsRef.current = ids;
    setPreview(current => ({ ...(current ?? initialWorkspacePreview), viewportRowIds: ids }), false);
  }, [setPreview]);

  useEffect(() => {
    scanViewport();
    return () => {
      if (scanFrameRef.current !== null) {
        cancelAnimationFrame(scanFrameRef.current);
      }
    };
  }, [scanViewport]);

  const handleGridScroll = useCallback(
    (_event: UIEvent<HTMLDivElement>) => scanViewport(),
    [scanViewport]
  );
  const closeAnimalCard = useCallback(() => {
    animalCardRequestRef.current += 1;
    setPreview(
      (current) => ({
        ...(current ?? initialWorkspacePreview),
        animalCard: null,
      }),
      false
    );
  }, [setPreview]);
  const retryFarms = useCallback(() => {
    mutateFarms().catch(() => undefined);
  }, [mutateFarms]);
  const retryView = useCallback(() => {
    mutateView().catch(() => undefined);
  }, [mutateView]);
  const retryViewCreation = useCallback(
    () =>
      setCreationByChat((current) => ({
        ...current,
        [chatId]: { error: null, pending: false },
      })),
    [chatId]
  );

  if (farmError) {
    return (
      <WorkspaceState
        detail={farmError instanceof Error ? farmError.message : "Не удалось загрузить данные фермы."}
        onRetry={retryFarms}
        title="Не удалось загрузить фермы"
      />
    );
  }
  if (viewError) {
    return (
      <WorkspaceState
        detail="Не удалось получить сохранённое состояние таблицы."
        onRetry={retryView}
        title="Не удалось открыть отчёт"
      />
    );
  }
  if (!farmData || viewLoading || creating) {
    const pendingView = view ?? preview.view;
    return (
      <aside className="flex h-full min-w-0 flex-col bg-background" aria-busy="true">
        {pendingView ? <TableViewControls
          columns={pendingView.columns}
          fields={fields}
          filters={pendingView.filters}
          groupBy={pendingView.groupBy}
          isMutating
          onOperations={applyOperations}
          sort={pendingView.sort}
          viewId={pendingView.id}
        /> : <div className="h-[var(--app-bar-height)] shrink-0 border-b" />}
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <RefreshCwIcon className="size-4 animate-spin" /> Загружаем таблицу…
        </div>
      </aside>
    );
  }
  if (creationError) {
    return (
      <WorkspaceState
        detail="Состояние таблицы не удалось сохранить."
        onRetry={retryViewCreation}
        title="Не удалось открыть отчёт"
      />
    );
  }
  if (farmData.farms.length === 0) {
    return (
      <WorkspaceState
        detail="Для пользователя не найдено активного доступа к ферме."
        title="Нет доступных ферм"
      />
    );
  }
  if (!view) {
    return (
      <WorkspaceState
        detail="Представление таблицы не создано."
        title="Не удалось открыть отчёт"
      />
    );
  }

  const noRows =
    !pages.isInitialLoading && !pages.initialError && pages.totalRows === 0;
  return (
    <aside
      aria-busy={pages.isLoading || mutatingCount > 0}
      className="hidden h-dvh min-w-0 flex-1 flex-col bg-background md:flex"
      data-testid="farm-workspace"
    >
      {viewNotice ? (
        <div
          className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-muted-foreground text-xs"
          role={failedOperations ? "alert" : "status"}
        >
          <span>{viewNotice}</span>
          {failedOperations ? (
            <Button
              className="ml-auto"
              disabled={mutatingCount > 0}
              onClick={retryFailedOperations}
              size="xs"
              variant="outline"
            >
              <RefreshCwIcon data-icon="inline-start" />
              Повторить
            </Button>
          ) : null}
        </div>
      ) : null}

      <TableViewControls
        columns={view.columns}
        fields={fields}
        filters={view.filters}
        groupBy={view.groupBy}
        isMutating={mutatingCount > 0}
        onOperations={applyOperations}
        sort={view.sort}
        viewId={view.id}
      />

      <div className="relative min-h-0 flex-1" ref={gridRef} style={{ containerType: "inline-size" }}>
        <div className="absolute inset-0" aria-hidden={farmMode} inert={farmMode} style={{ visibility: farmMode ? "hidden" : undefined }}>
        {pages.isInitialLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCwIcon className="size-4 animate-spin" /> Загружаем животных…
          </div>
        ) : pages.initialError ? (
          <WorkspaceState
            detail={
              [
                "RULE_SNAPSHOT_STALE",
                "RULE_PROJECTION_STALE",
                "CURSOR_STALE",
              ].includes(pages.initialError)
                ? "Данные обновились. Повторная загрузка сохранит ваши фильтры и настройки."
                : "Применённые правила сохранены; повторите загрузку данных."
            }
            onRetry={() => pages.retry([])}
            title="Не удалось получить животных"
          />
        ) : noRows ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="font-medium">Ничего не найдено</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Измените или удалите фильтры.
              </p>
            </div>
          </div>
        ) : (
          <DataGrid
            className="farm-data-grid rdg-light dark:rdg-dark"
            columns={columns}
            enableVirtualization
            rowHeight={35}
            headerRowHeight={35}
            onCellClick={({ row }, event) => {
              if (row.kind === "group") event.preventGridDefault();
            }}
            onScroll={handleGridScroll}
            renderers={{ renderRow: renderTableRow }}
            role={view.groupBy.length > 0 ? "treegrid" : "grid"}
            rowKeyGetter={(row) => row.key}
            rows={pages.rows}
            style={{ height: "100%" }}
          />
        )}
        {!pages.isInitialLoading && !pages.initialError && !noRows && (
          <StickyGroupHeader
            rows={pages.rows}
            scrollTop={gridScrollTop}
            fieldMap={fieldMap}
            onToggle={pages.toggleGroup}
          />
        )}
        </div>
        {(sceneMounted || farmMode) && <div className="absolute inset-0" aria-hidden={!farmMode} inert={!farmMode} style={{ visibility: farmMode ? undefined : "hidden", pointerEvents: farmMode ? undefined : "none" }}>
          <FarmScene active={farmMode} view={view} fields={fields} onOpenAnimal={openAnimal} onViewport={reportSceneViewport} onRefresh={refreshViewSnapshot} />
        </div>}
      {preview.animalCard ? (
        <AnimalDetailsPanel
          animal={preview.animalCard}
          onClose={closeAnimalCard}
          openerRef={animalCardOpenerRef}
        />
      ) : null}

      </div>

      <TableExportFooter
        key={view.id}
        viewId={view.id}
        revision={view.revision}
        count={pages.totalRows}
        loading={pages.isInitialLoading}
        disabled={
          pages.isInitialLoading || Boolean(pages.initialError) ||
          mutatingCount > 0 || Boolean(failedOperations)
        }
      />
    </aside>
  );
}

type AnimalDetailField = readonly [
  key: string,
  label: string,
  type?: TableField["type"],
  unit?: string,
];

const animalDetailSections: Array<{
  fields: AnimalDetailField[];
  title: string;
}> = [
  {
    fields: [
      ["primary_identifier", "Номер"],
      ["name", "Кличка"],
      ["sex", "Пол"],
      ["birth_date", "Дата рождения", "date"],
      ["age_days", "Возраст, дней", "number"],
      ["group_code", "Группа"],
      ["status_code", "Статус"],
    ],
    title: "Основное",
  },
  {
    fields: [
      ["lactation_number", "Лактация", "number"],
      ["days_in_milk", "Дней в молоке", "number"],
      ["last_calving_at", "Последний отёл", "date"],
      ["last_milk_kg", "Последний надой", "number", "кг"],
      ["last_weight_kg", "Последний вес", "number", "кг"],
    ],
    title: "Лактация и продуктивность",
  },
  {
    fields: [
      ["last_insemination_at", "Последнее осеменение", "date"],
      ["is_pregnant", "Стельная", "boolean"],
      ["pregnancy_days", "Дней стельности", "number"],
      ["expected_calving_date", "Ожидаемый отёл", "date"],
      ["expected_dry_off_date", "Ожидаемый сухостой", "date"],
    ],
    title: "Воспроизводство",
  },
  {
    fields: [
      ["active_diagnosis_count", "Активные диагнозы", "number"],
      ["active_protocol_count", "Активные протоколы", "number"],
      ["active_withdrawal_count", "Активные ограничения", "number"],
      ["is_archived", "В архиве", "boolean"],
      ["is_exited", "Выбыло", "boolean"],
    ],
    title: "Здоровье и ограничения",
  },
];

function AnimalDetailsPanel({
  animal,
  onClose,
  openerRef,
}: {
  animal: Record<string, unknown>;
  onClose: () => void;
  openerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus({ preventScroll: true }); }, []);
  const closePanel = useCallback(() => {
    onClose();
    openerRef.current?.focus();
  }, [onClose, openerRef]);
  const number = formatValue(animal.primary_identifier);
  const name = formatValue(animal.name);

  return (
    <aside
      aria-label={`Животное № ${number}`}
      className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l bg-background motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200"
      data-testid="animal-card"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <header className="flex shrink-0 items-start gap-3 border-b p-6">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-base">Животное № {number}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{name}</p>
        </div>
        <Button
          ref={closeButton}
          aria-label="Закрыть карточку животного"
          className="shrink-0"
          onClick={closePanel}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <iframe
            key={String(animal.animal_id ?? animal.primary_identifier)}
            title="3D-модель животного — потяните для поворота"
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/cow-lab/animal.html?card=1&id=${encodeURIComponent(String(animal.animal_id ?? animal.animalId ?? animal.primary_identifier))}&animal=${animal.sex === "MALE" ? "bull" : "cow"}`}
            className="mt-4 h-56 w-full rounded-xl border-0"
          />
          {animalDetailSections.map((section) => (
            <section
              className="border-b py-5 last:border-b-0"
              key={section.title}
            >
              <h3 className="mb-3 font-medium text-sm">{section.title}</h3>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                {section.fields.map(([key, label, type = "text", unit]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="mt-0.5 font-medium">
                      {key === "sex" && animal[key] === "MALE" ? "Бык" : key === "sex" && animal[key] === "FEMALE" ? "Корова" : formatValue(animal[key], { type, unit })}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
    </aside>
  );
}

function WorkspaceState({
  busy = false,
  detail,
  onRetry,
  title,
}: {
  busy?: boolean;
  detail: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <aside
      aria-busy={busy}
      className="flex h-full min-h-48 min-w-0 flex-1 items-center justify-center bg-background p-8 text-center"
    >
      <div className="flex max-w-sm flex-col items-center gap-2">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{detail}</p>
        {onRetry ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Повторить
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
