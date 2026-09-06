"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArkaNavigation } from "./navigation";

export function ArkaShell({children}: {children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const menu = ref.current?.querySelector<HTMLElement>(".nav-menu-items");
    if (!menu) return;
    const update = () => {
      menu.classList.toggle("scroll-top", menu.scrollTop > 1);
      menu.classList.toggle("scroll-bottom", menu.scrollHeight - menu.scrollTop - menu.clientHeight > 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    menu.addEventListener("scroll", update, {passive: true});
    update();
    return () => {observer.disconnect(); menu.removeEventListener("scroll", update);};
  }, []);
  useEffect(() => {
    const active = pathname.endsWith("/calendar") ? "/arka/calendar" : "/arka/commands";
    ref.current?.querySelectorAll(".nav-item-root").forEach((item) => {
      item.classList.toggle("active", item.querySelector("a")?.getAttribute("href") === active);
    });
  }, [pathname]);
  return <div className="arka-prototype" data-screen={pathname.split("/").pop()} ref={ref}><ArkaNavigation />{children}</div>;
}
