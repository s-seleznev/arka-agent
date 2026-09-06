"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function WelcomeWorkspace() {
  const { data: session } = useSession();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!session?.user?.id) return;
    const key = `arka-welcome-visited:${session.user.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* Storage can be disabled. */
    }
    let cancelled = false;
    void fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/demo-workspace`,
      { method: "POST" }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Welcome workspace unavailable");
        const result = await response.json();
        if (cancelled) return;
        if (result.chatId) {
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            /* The server also deduplicates reports. */
          }
          void mutate(unstable_serialize(getChatHistoryPaginationKey));
          router.replace(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${result.chatId}`
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, router, mutate]);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-background px-3 py-2 text-sm"
    >
      Не удалось открыть примеры отчётов. Обновите страницу или начните новый
      чат.
    </div>
  );
}
