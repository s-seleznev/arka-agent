"use client";

import { DownloadIcon, LoaderCircleIcon, PrinterIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TableAssistantControlContext } from "./assistant-control";

type Props = {
  viewId: string;
  revision: number;
  count: number;
  loading: boolean;
  disabled: boolean;
};
export function TableExportFooter({
  viewId,
  revision,
  count,
  loading,
  disabled,
}: Props) {
  const assistantControl = useContext(TableAssistantControlContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [viewId]);
  const url = `/api/views/${encodeURIComponent(viewId)}/export?revision=${revision}`;
  async function download() {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${url}&format=csv`, {
        signal: abort.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.message ??
            result.error ??
            "Не удалось подготовить CSV. Повторите попытку."
        );
      }
      if (!response.headers.get("content-type")?.startsWith("text/csv")) {
        throw new Error(
          "Не удалось получить CSV. Проверьте вход в приложение и повторите попытку."
        );
      }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "Животные.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Не удалось скачать CSV.");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      {error ? (
        <div
          className="shrink-0 border-t px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <footer
        className="relative z-[5] flex h-[var(--app-bar-height)] shrink-0 items-center gap-2 bg-white px-3"
        style={{ borderTop: "1px solid var(--divider-color)" }}
        data-testid="farm-export-footer"
      >
        {assistantControl}
        <span
          className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="farm-row-count"
          role="status"
        >
          {loading ? "Загрузка…" : `${count.toLocaleString("ru-RU")} животных`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          onClick={download}
          title="Скачать все строки с текущими фильтрами и колонками"
        >
          {busy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <DownloadIcon className="size-4" />
          )}
          <span>{busy ? "Подготовка…" : "Скачать CSV"}</span>
        </Button>
        {disabled ? (
          <Button type="button" variant="ghost" size="sm" disabled>
            <PrinterIcon className="size-4" />
            Напечатать
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`${url}&format=print`}
              target="_blank"
              rel="noopener noreferrer"
              title="Открыть печатный отчёт со всеми строками"
            >
              <PrinterIcon className="size-4" />
              Напечатать
            </a>
          </Button>
        )}
      </footer>
    </>
  );
}
