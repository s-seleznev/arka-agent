"use client";

import { DownloadIcon, FileTextIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspacePreview } from "@/hooks/use-workspace-preview";
import { FarmTableWorkspace } from "./farm-table";

function TextPreview({ url }: { url: string }) {
  return (
    <iframe
      className="h-full w-full border-0 bg-background"
      src={url}
      title="Предпросмотр документа"
    />
  );
}

function EmptyPreview() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid w-56 grid-cols-3 gap-2 opacity-50">
          <div className="col-span-3 h-7 rounded bg-muted" />
          <div className="h-16 rounded bg-muted" />
          <div className="h-16 rounded bg-muted" />
          <div className="h-16 rounded bg-muted" />
        </div>
        <p className="font-medium">Файлы, списки и таблицы</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Откройте документ из чата. Данные фермы появятся здесь после
          подключения базы.
        </p>
      </div>
    </div>
  );
}

export function WorkspacePreviewPanel() {
  const { close, preview } = useWorkspacePreview();
  const file = preview.isVisible ? preview.attachment : null;
  if (preview.type !== "file") {
    return <FarmTableWorkspace />;
  }
  const isImage = file?.contentType.startsWith("image/") ?? false;
  const canEmbed =
    file?.contentType === "application/pdf" ||
    file?.contentType.startsWith("text/") ||
    file?.contentType === "application/json";

  return (
    <aside className="hidden h-dvh min-w-0 flex-1 flex-col bg-background md:flex">
      <header
        className="flex h-[var(--app-bar-height)] shrink-0 items-center gap-3 border-b border-border px-3"
        data-testid="workspace-preview-header"
      >
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {file?.name ?? preview.title ?? "Область просмотра"}
        </div>
        {file ? (
          <Button asChild size="icon" title="Скачать" variant="ghost">
            <a href={`${file.url}?download=1`}>
              <DownloadIcon className="size-4" />
            </a>
          </Button>
        ) : null}
        {preview.isVisible ? (
          <Button onClick={close} size="icon" title="Закрыть" variant="ghost">
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        {file ? (
          isImage ? (
            // biome-ignore lint/performance/noImgElement: authenticated file route cannot be optimized by Next Image
            <img
              alt={file.name}
              className="mx-auto h-full w-full object-contain p-6"
              src={file.url}
            />
          ) : canEmbed ? (
            <TextPreview url={file.url} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <FileTextIcon className="mx-auto mb-3 size-10 text-muted-foreground" />
                <p className="font-medium">Файл сохранён</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Встроенный просмотр этого формата появится на следующем этапе.
                </p>
              </div>
            </div>
          )
        ) : (
          <EmptyPreview />
        )}
      </div>
    </aside>
  );
}
