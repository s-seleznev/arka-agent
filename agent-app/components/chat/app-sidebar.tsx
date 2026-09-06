"use client";

import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useEffect, useRef } from "react";
import { SidebarDocuments } from "@/components/chat/sidebar-documents";
import { SidebarHistory } from "@/components/chat/sidebar-history";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import styles from "@/components/arka/workspace.module.css";

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const scroll = useRef<HTMLDivElement>(null);
  const updateEdges = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    el.dataset.top = String(el.scrollTop > 1);
    el.dataset.bottom = String(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
  }, []);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const resize = new ResizeObserver(updateEdges);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    updateEdges();
    return () => resize.disconnect();
  }, [updateEdges]);
  return <>
    <div className={styles.chatActions}>
      <SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton onClick={() => { setOpenMobile(false); router.push("/"); }}>
          <svg width="24" height="24" aria-hidden="true"><use href="/arka/icons.svg#chat-left-plus" /></svg><span>Новая задача</span>
        </SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton disabled title="Запланировано — скоро">
          <svg width="24" height="24" aria-hidden="true"><use href="/arka/icons.svg#calendar" /></svg><span>Запланировано</span>
        </SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </div>
    <div className={styles.historyScroll} ref={scroll} onScroll={updateEdges}>
      <div><SidebarHistory user={user} />{user ? <SidebarDocuments /> : null}</div>
    </div>
  </>;
}
