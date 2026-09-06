import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback } from "react";
import type { Chat } from "@/lib/db/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { MoreHorizontalIcon, TrashIcon } from "./icons";

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  onRename,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  onRename: (chat: Chat) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleDelete = useCallback(() => {
    onDelete(chat.id);
  }, [chat.id, onDelete]);
  const handleRename = useCallback(() => {
    onRename(chat);
  }, [chat, onRename]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={chat.title}>
        <Link
          aria-current={isActive ? "page" : undefined}
          href={`/chat/${chat.id}`}
          onClick={closeMobile}
        >
          <span className="truncate">{chat.title}</span>
        </Link>
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            aria-label={`Действия с чатом ${chat.title}`}
            showOnHover
          >
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={handleRename}>
              <PencilIcon />
              <span>Переименовать</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDelete} variant="destructive">
              <TrashIcon />
              <span>Удалить</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  if (prevProps.chat.title !== nextProps.chat.title) {
    return false;
  }
  return true;
});
