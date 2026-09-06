"use client";

import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initialWorkspacePreview, useWorkspacePreview } from "@/hooks/use-workspace-preview";
import { usePathname } from "next/navigation";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { Input } from "@/components/ui/input";
import { useActiveChat } from "@/hooks/use-active-chat";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function ChatHeader() {
  const pathname = usePathname();
  const { preview, setPreview } = useWorkspacePreview();
  const { chatId, chatTitle, isReadonly, setChatTitle } = useActiveChat();
  const { mutate } = useSWRConfig();
  const [draftTitle, setDraftTitle] = useState(chatTitle);
  const [isSaving, setIsSaving] = useState(false);
  const activeChatIdRef = useRef(chatId);
  const skipSaveRef = useRef(false);
  const canRename = pathname.startsWith("/chat/") && !isReadonly;
  activeChatIdRef.current = chatId;

  useEffect(() => {
    setDraftTitle(chatTitle);
  }, [chatTitle]);

  const saveTitle = useCallback(async () => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }

    const title = draftTitle.trim();
    if (!canRename || title === chatTitle) {
      setDraftTitle(chatTitle);
      return;
    }
    if (!title) {
      setDraftTitle(chatTitle);
      toast.error("Название чата не может быть пустым");
      return;
    }

    const targetChatId = chatId;
    setIsSaving(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
        {
          body: JSON.stringify({ id: chatId, title }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }
      );
      if (!response.ok) {
        throw new Error("CHAT_TITLE_UPDATE_FAILED");
      }

      if (activeChatIdRef.current === targetChatId) {
        setChatTitle(title);
      }
      await mutate(unstable_serialize(getChatHistoryPaginationKey));
    } catch {
      if (activeChatIdRef.current === targetChatId) {
        setDraftTitle(chatTitle);
        toast.error("Не удалось переименовать чат");
      }
    } finally {
      if (activeChatIdRef.current === targetChatId) {
        setIsSaving(false);
      }
    }
  }, [canRename, chatId, chatTitle, draftTitle, mutate, setChatTitle]);

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDraftTitle(event.target.value);
    },
    []
  );

  const handleTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        skipSaveRef.current = true;
        setDraftTitle(chatTitle);
        event.currentTarget.blur();
      }
    },
    [chatTitle]
  );

  return (
    <header
      className="flex h-[var(--app-bar-height)] shrink-0 items-center border-b border-border bg-background px-3"
      data-testid="chat-header"
    >
      <Input
        aria-label="Название чата"
        className="min-w-0 flex-1"
        maxLength={120}
        onBlur={saveTitle}
        onChange={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        readOnly={!canRename || isSaving}
        value={draftTitle}
        variant="title"
      />
      <Button className="fixed right-3 z-40 shrink-0" style={{ top: "calc((var(--app-bar-height) - 36px) / 2)" }} variant="ghost" size="icon" aria-label={preview.isVisible ? "Закрыть таблицу" : "Открыть таблицу"} title={preview.isVisible ? "Закрыть таблицу" : "Открыть таблицу"} aria-pressed={preview.isVisible} onClick={() => setPreview(current => ({ ...(current ?? initialWorkspacePreview), attachment: null, type: "table", isVisible: !current?.isVisible }), false)}>
        <PanelRight strokeWidth={1.5} />
      </Button>
    </header>
  );
}
