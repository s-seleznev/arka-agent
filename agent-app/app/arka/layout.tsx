import { ArkaScreen } from "@/components/arka/workspace-shell";
import type { ReactNode } from "react";
export const metadata = { title: "АРКА" };
export default function Layout({ children }: { children: ReactNode }) {
  return <ArkaScreen>{children}</ArkaScreen>;
}
