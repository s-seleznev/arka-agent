"use client";

import { EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import type { AnimalRow, ReportViewState } from "@/lib/farm/types";
import type { TableField } from "./table-view/view-controls";

type SceneAnimal = AnimalRow & { matched: boolean; sex: "MALE" | "FEMALE" };
type SceneData = { animals: SceneAnimal[]; viewId: string; revision: number; snapshot: string };

export function FarmScene({ active, view, fields, onOpenAnimal, onViewport, onRefresh }: {
  active: boolean;
  view: ReportViewState;
  fields: TableField[];
  onOpenAnimal: (row: AnimalRow, opener: HTMLButtonElement) => void;
  onViewport: (ids: string[]) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const channel = useId();
  const iframe = useRef<HTMLIFrameElement>(null);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [ready, setReady] = useState(false);
  const [infographic, setInfographic] = useState(false);
  const [sceneError, setSceneError] = useState(false);
  const [applied, setApplied] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scope = `${view.id}:${view.revision}`;
  const { data, error, mutate } = useSWR<SceneData>(active ? ["farm-scene", view.id, view.revision] : null, async () => {
    const response = await fetch(`${base}/api/farm/scene`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: view.id, revision: view.revision }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "SCENE_QUERY_FAILED");
    return result;
  }, { revalidateOnFocus: false, errorRetryCount: 1, keepPreviousData: false });
  const payload = useMemo(() => {
    if (!data || data.viewId !== view.id || data.revision !== view.revision) return null;
    const group = view.groupBy[0] ?? null;
    const field = fields.find(item => item.id === group?.field);
    const groupLabels = Object.fromEntries(data.animals.map(animal => {
      const value = animal.groupValue;
      const option = field?.options?.find(item => "value" in item.value && item.value.value === value);
      const label = field?.id === "sex" && value === "MALE" ? "Бычки" : field?.id === "sex" && value === "FEMALE" ? "Коровы" : option?.label ?? (value == null ? "Не указано" : typeof value === "boolean" ? value ? "Да" : "Нет" : String(value));
      return [JSON.stringify(value), label];
    }));
    return { ...data, group, groupLabels };
  }, [data, fields, view]);
  const latest = useRef({ payload, onOpenAnimal, onViewport, active, scope });
  latest.current = { payload, onOpenAnimal, onViewport, active, scope };
  const send = useCallback((message: Record<string, unknown>) => {
    iframe.current?.contentWindow?.postMessage({ source: "arka-workspace", channel, ...message }, location.origin);
  }, [channel]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow || message?.source !== "arka-farm" || message.channel !== channel) return;
      const current = latest.current;
      if (message.type === "ready") {
        setReady(true); setSceneError(false); setInfographic(false);
        send({ type: "active", active: current.active });
        if (current.payload) send({ type: "data", ...current.payload });
      } else if (message.type === "mode") {
        setInfographic(Boolean(message.infographic));
      } else if (message.type === "applied" && `${message.viewId}:${message.revision}` === current.scope) {
        setApplied(current.scope); setSceneError(false);
      } else if (message.type === "error") setSceneError(true);
      else if (message.type === "select" && current.active && current.payload) {
        const animal = current.payload.animals.find(row => row.animalId === message.animalId && row.farmId === message.farmId);
        const opener = iframe.current?.contentDocument?.querySelector<HTMLButtonElement>(".animal-bubble");
        if (animal && opener) current.onOpenAnimal(animal, opener);
      } else if (message.type === "viewport" && current.active && current.payload && Array.isArray(message.ids)) {
        const allowed = new Set(current.payload.animals.filter(row => row.matched).map(row => row.animalId));
        current.onViewport(message.ids.filter((id: unknown): id is string => typeof id === "string" && allowed.has(id)));
      } else if (message.type === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, send]);
  useEffect(() => { if (ready) send({ type: "active", active }); }, [active, ready, send]);
  useEffect(() => { if (ready && payload) send({ type: "data", ...payload }); }, [payload, ready, send]);
  const retry = useCallback(async () => {
    if (sceneError) { setReady(false); setApplied(""); setSceneError(false); setAttempt(value => value + 1); }
    if (error && ["RULE_SNAPSHOT_STALE", "RULE_PROJECTION_STALE", "CURSOR_STALE"].includes(error.message)) await onRefresh();
    await mutate();
  }, [error, mutate, onRefresh, sceneError]);
  const pending = applied !== scope || !data;
  const matched = data?.animals.filter(animal => animal.matched).length ?? 0;
  return (
    <div className="absolute inset-0 overflow-hidden bg-white" data-testid="farm-scene" aria-busy={pending}>
      <iframe
        key={attempt}
        ref={iframe}
        title="3D-модель фермы"
        src={`${base}/cow-lab/index.html?scene=farm&embed=1&channel=${encodeURIComponent(channel)}&v=43`}
        className="h-full w-full border-0"
        tabIndex={active && !pending ? 0 : -1}
        style={{ pointerEvents: pending || !active ? "none" : undefined }}
        onError={() => setSceneError(true)}
      />
      {(error || sceneError) ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 px-8 text-center" role="alert">
          <p className="text-sm font-medium">Не удалось открыть 3D-ферму</p>
          <p className="max-w-sm text-sm text-muted-foreground">{error?.message === "SCENE_CAPACITY_EXCEEDED" ? "Для этой фермы превышен предел 2 000 моделей. Все животные доступны в таблице." : "Фильтры сохранены. Повторите загрузку или вернитесь к таблице."}</p>
          <Button onClick={() => void retry()} size="sm" variant="outline"><RefreshCwIcon /> Повторить</Button>
        </div>
      ) : pending ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground" role="status">
          <RefreshCwIcon className="size-4 animate-spin" /> {ready ? "Применяем состояние таблицы…" : "Загружаем 3D-ферму…"}
        </div>
      ) : (
        <div className="absolute top-3 right-3 flex max-w-[calc(100%-24px)] flex-wrap items-center justify-end gap-3 rounded-lg border bg-background px-2 py-1 text-sm shadow-sm" data-testid="farm-scene-legend">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={infographic}
            onClick={() => send({ type: "environment", hidden: !infographic })}
          >
            {infographic ? <EyeIcon /> : <EyeOffIcon />}
            {infographic ? "Показать окружение" : "Скрыть окружение"}
          </Button>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <span>{matched} в выборке</span>
          {!infographic && <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full border border-slate-400 bg-slate-200/50" /> {data.animals.length - matched} вне фильтров</span>}
        </div>
      )}
    </div>
  );
}
