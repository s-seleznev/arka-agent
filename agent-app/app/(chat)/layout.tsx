import Script from "next/script";

// The assistant runtime lives in WorkspaceShell so section navigation cannot
// unmount an in-flight response or reset chat/table UI state.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <><Script src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js" strategy="lazyOnload" />{children}</>;
}
