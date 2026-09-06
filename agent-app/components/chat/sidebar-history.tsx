"use client";

import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: Chat[]) => {
  const days = new Map<string, Chat[]>();
  for (const chat of chats) {
    const date = new Date(chat.createdAt);
    const key = [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
    days.set(key, [...(days.get(key) ?? []), chat]);
  }
  return Array.from(days, ([id, chats]) => ({
    id, chats,
    label: new Date(chats[0].createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }),
  }));
};

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=${PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    error,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    user ? getChatHistoryPaginationKey : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [renameChat, setRenameChat] = useState<Chat | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistories
    ? paginatedChatHistories.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = useCallback(() => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;

    setShowDeleteDialog(false);

    if (isCurrentChat) {
      router.replace("/");
    }

    mutate((chatHistories) => {
      if (chatHistories) {
        return chatHistories.map((chatHistory) => ({
          ...chatHistory,
          chats: chatHistory.chats.filter((chat) => chat.id !== chatToDelete),
        }));
      }
    });

    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatToDelete}`,
      { method: "DELETE" }
    );

    toast.success("Чат удалён");
  }, [deleteId, mutate, pathname, router]);

  const handleShowDeleteDialog = useCallback((chatId: string) => {
    setDeleteId(chatId);
    setShowDeleteDialog(true);
  }, []);

  const handleShowRenameDialog = useCallback((chat: Chat) => {
    setRenameChat(chat);
    setRenameTitle(chat.title);
  }, []);

  const handleRename = useCallback(async () => {
    const title = renameTitle.trim();
    if (!renameChat || !title) {
      return;
    }
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      {
        body: JSON.stringify({ id: renameChat.id, title }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }
    );
    if (!response.ok) {
      toast.error("Не удалось переименовать чат");
      return;
    }
    mutate((pages) =>
      pages?.map((page) => ({
        ...page,
        chats: page.chats.map((chat) =>
          chat.id === renameChat.id ? { ...chat, title } : chat
        ),
      }))
    );
    window.dispatchEvent(
      new CustomEvent("arkasha-chat-title-changed", {
        detail: { chatId: renameChat.id, title },
      })
    );
    setRenameChat(null);
  }, [mutate, renameChat, renameTitle]);
  const handleRenameDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameChat(null);
    }
  }, []);
  const handleRenameTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRenameTitle(event.target.value);
    },
    []
  );
  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        handleRename();
      }
    },
    [handleRename]
  );

  const handleViewportEnter = useCallback(() => {
    if (!isValidating && !hasReachedEnd) {
      setSize((size) => size + 1);
    }
  }, [hasReachedEnd, isValidating, setSize]);

  if (!user) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Войдите, чтобы сохранять историю чатов.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>История</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {["first", "second", "third", "fourth", "fifth"].map((key) => (
              <SidebarMenuSkeleton key={key} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (error && !paginatedChatHistories?.some(page => page.chats.length > 0)) {
    return <SidebarGroup><SidebarGroupContent>
      <p className="px-2 text-sm text-muted-foreground">Не удалось загрузить историю.</p>
      <Button variant="ghost" size="sm" onClick={() => mutate()}>Повторить</Button>
    </SidebarGroupContent></SidebarGroup>;
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>История</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Здесь появятся ваши чаты.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const chatsFromHistory =
    paginatedChatHistories?.flatMap((page) => page.chats) ?? [];
  const sections = groupChatsByDate(chatsFromHistory);

  return (
    <>
      {sections.map((section) => (
        <SidebarGroup
          className="group-data-[collapsible=icon]:hidden"
          key={section.id}
        >
          <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {section.chats.map((chat) => (
                <ChatItem
                  chat={chat}
                  isActive={chat.id === id}
                  key={chat.id}
                  onDelete={handleShowDeleteDialog}
                  onRename={handleShowRenameDialog}
                  setOpenMobile={setOpenMobile}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}

      <motion.div onViewportEnter={handleViewportEnter} />

      {hasReachedEnd ? null : (
        <div className="flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50">
          <div className="animate-spin">
            <LoaderIcon />
          </div>
          <div className="text-xs">Загрузка…</div>
        </div>
      )}

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
            <AlertDialogDescription>
              Действие нельзя отменить. Чат будет удалён безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={handleRenameDialogOpenChange}
        open={renameChat !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Переименовать чат</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={120}
            onChange={handleRenameTitleChange}
            onKeyDown={handleRenameKeyDown}
            value={renameTitle}
          />
          <DialogFooter>
            <Button
              disabled={!renameTitle.trim()}
              onClick={handleRename}
              type="button"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
