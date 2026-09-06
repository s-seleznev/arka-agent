import Image from "next/image";
import { useCallback } from "react";
import { useWorkspacePreview } from "@/hooks/use-workspace-preview";
import type { Attachment } from "@/lib/types";
import { Spinner } from "../ui/spinner";
import { CrossSmallIcon } from "./icons";

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType } = attachment;
  const { openFile } = useWorkspacePreview();
  const handleOpen = useCallback(() => {
    if (!isUploading) {
      openFile(attachment);
    }
  }, [attachment, isUploading, openFile]);
  const handleRemove = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove]
  );

  return (
    <div
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted"
      data-testid="input-attachment-preview"
      title={isUploading ? name : `Открыть ${name}`}
    >
      <button className="size-full" onClick={handleOpen} type="button">
        {contentType?.startsWith("image") ? (
          <Image
            alt={name ?? "attachment"}
            className="size-full object-cover"
            height={96}
            src={url}
            width={96}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground text-xs">
            File
          </div>
        )}
      </button>

      {isUploading ? (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Spinner className="size-5" />
        </div>
      ) : null}

      {onRemove && !isUploading && (
        <button
          className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
          onClick={handleRemove}
          type="button"
        >
          <CrossSmallIcon size={10} />
        </button>
      )}
    </div>
  );
};
