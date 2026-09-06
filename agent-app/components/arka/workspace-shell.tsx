"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { ChatShell } from "@/components/chat/shell";
import { Toaster } from "sonner";
import { WorkspacePreviewPersistence } from "@/hooks/use-workspace-preview";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ArkaFooter } from "./footer";
import { ArkaNavigation } from "./navigation";
import { WorkspaceNavigation } from "./workspace-navigation";
import styles from "./workspace.module.css";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const sidebar = useRef<HTMLElement>(null);
  const assistantRoute = pathname === "/" || pathname.startsWith("/chat/");
  const [assistantVisited, setAssistantVisited] = useState(assistantRoute);
  useEffect(() => {
    if (assistantRoute) setAssistantVisited(true);
  }, [assistantRoute]);
  const [isArka, setIsArka] = useState(pathname.startsWith("/arka"));
  useEffect(() => { setIsArka(pathname.startsWith("/arka")); }, [pathname]);
  const isWorkspace = pathname.startsWith("/arka") || pathname === "/" || pathname.startsWith("/chat/");
  useEffect(() => {
    sidebar.current?.querySelectorAll(".nav-item-root").forEach((item) => {
      item.classList.toggle("active", item.querySelector("a")?.getAttribute("href") === pathname);
    });
  }, [pathname]);
  if (!isWorkspace) return children;
  return (
    <SidebarProvider defaultOpen className={styles.provider}>
      <div className={styles.shell} data-workspace-shell>
        <WorkspacePreviewPersistence />
        <aside className={styles.sidebar} data-workspace-sidebar ref={sidebar}>
          <WorkspaceNavigation isArka={isArka} onSelect={setIsArka} />
          <div className={styles.navigation}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={isArka ? "overview" : "assistant"}
                className={styles.menuContent}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.18, ease: "easeOut" } }}
                exit={{ opacity: 0, transition: { duration: 0.12, ease: "easeOut" } }}
              >
                <Suspense fallback={<div />} >{isArka ? <ArkaNavigation /> : <AppSidebar user={session?.user} />}</Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
          <ArkaFooter />
        </aside>
        <main className={styles.main}>
          {(assistantVisited || assistantRoute) && (
            <div className="h-full min-h-0 min-w-0 w-full" style={{ display: assistantRoute ? "flex" : "none" }} aria-hidden={!assistantRoute}>
              <DataStreamProvider>
                <Suspense fallback={<div />}>
                  <ActiveChatProvider><ChatShell /></ActiveChatProvider>
                </Suspense>
              </DataStreamProvider>
            </div>
          )}
          <Toaster position="top-center" theme="light" />
          <Suspense fallback={<div />}>{children}</Suspense>
        </main>
      </div>
    </SidebarProvider>
  );
}

export function ArkaScreen({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="arka-prototype arka-screen" data-screen={pathname.split("/").pop()}>{children}</div>;
}
