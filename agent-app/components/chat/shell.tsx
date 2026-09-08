"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Maximize2, Minimize2, PanelRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./shell.module.css";
import { TableAssistantControlContext } from "./table-view/assistant-control";
import { CowIcon } from "./cow-icon";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  initialWorkspacePreview,
  useWorkspacePreview,
} from "@/hooks/use-workspace-preview";
import type { Attachment, ChatMessage } from "@/lib/types";
import { Artifact } from "./artifact";
import { ChatHeader } from "./chat-header";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { WorkspacePreviewPanel } from "./workspace-preview";

export function ChatShell() {
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();
  const { preview, setPreview } = useWorkspacePreview();
  const isMobile = useIsMobile();
  const isWorkspaceVisible = isArtifactVisible || preview.isVisible;
  const [tableFullscreen, setTableFullscreen] = useState(false);
  const [compactChatOpen, setCompactChatOpen] = useState(false);
  const [keyboardTransition, setKeyboardTransition] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const compactChatRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const isTableVisible = preview.isVisible && preview.type !== "file";
  const farmMode = preview.displayMode === "farm";
  const fullscreen = tableFullscreen && isTableVisible && !isMobile && (pathname === "/" || pathname.startsWith("/chat/"));
  const transition = { duration: reduceMotion || keyboardTransition ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] as const };

  const closeCompactChat = useCallback(() => {
    setCompactChatOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    setTableFullscreen(false);
    setCompactChatOpen(false);
  }, [chatId, pathname]);

  useEffect(() => {
    if (!isTableVisible || isMobile) {
      setTableFullscreen(false);
      setCompactChatOpen(false);
    }
  }, [isTableVisible, isMobile]);

  useEffect(() => {
    if (!fullscreen) return;
    const sidebar = shellRef.current?.closest("[data-workspace-shell]")?.querySelector<HTMLElement>("[data-workspace-sidebar]");
    const wasInert = sidebar?.inert;
    if (sidebar) sidebar.inert = true;
    return () => { if (sidebar) sidebar.inert = wasInert ?? false; };
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen || !compactChatOpen) return;
    const frame = requestAnimationFrame(() => compactChatRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [fullscreen, compactChatOpen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setKeyboardTransition(true);
      if (compactChatOpen) closeCompactChat();
      else {
        setTableFullscreen(false);
        fullscreenButtonRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, compactChatOpen, closeCompactChat]);


  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);

      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact, setPreview]);

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      setInput(text ?? "");
      setEditingMessage(msg);
    },
    [setInput]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
  }, [setInput]);

  const handleSendEditedMessage = useCallback(async () => {
    if (!editingMessage) {
      return;
    }

    const msg = editingMessage;
    setEditingMessage(null);
    await submitEditedMessage({
      message: msg,
      regenerate,
      setMessages,
      text: input,
    });
    setInput("");
  }, [editingMessage, input, regenerate, setInput, setMessages]);

  const handleActivateGateway = useCallback(() => {
    window.open(
      "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
      "_blank"
    );
    window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  }, []);

  const chatPane = (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: fullscreen && !compactChatOpen ? 0 : 1, y: fullscreen && !compactChatOpen && !reduceMotion ? 12 : 0, scale: fullscreen && !compactChatOpen && !reduceMotion ? 0.97 : 1 }}
      transition={transition}
      ref={compactChatRef}
      id="compact-assistant-chat"
      className={`flex size-full min-w-0 flex-col bg-background ${fullscreen ? styles.compactChat : ""}`}
      aria-label={fullscreen ? "Чат с ассистентом" : undefined}
      role={fullscreen ? "region" : undefined}
      aria-hidden={fullscreen && !compactChatOpen || undefined}
      inert={fullscreen && !compactChatOpen}
      style={{ pointerEvents: fullscreen && !compactChatOpen ? "none" : undefined }}
    >
      <ChatHeader key={chatId} compact={fullscreen} onClose={closeCompactChat} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Messages
          addToolApprovalResponse={addToolApprovalResponse}
          chatId={chatId}
          isArtifactVisible={isWorkspaceVisible}
          isLoading={isLoading}
          isReadonly={isReadonly}
          messages={messages}
          onEditMessage={handleEditMessage}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        {status === "error" && !isReadonly && (
          <div role="alert" className="mx-auto mb-3 flex w-full max-w-4xl items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
            <span>{error?.message || "Ответ прервался. Повторите запрос."}</span>
            <button type="button" className="shrink-0 rounded-md border px-3 py-2" onClick={() => void regenerate()}>
              Повторить
            </button>
          </div>
        )}
        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={chatId}
              editingMessage={editingMessage}
              input={input}
              isLoading={isLoading}
              messages={messages}
              onCancelEdit={handleCancelEdit}
              onModelChange={setCurrentModelId}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={
                editingMessage ? handleSendEditedMessage : sendMessage
              }
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
            />
          )}
        </div>
      </div>
    </motion.div>
  );

  const workspacePane = preview.isVisible ? (
    <WorkspacePreviewPanel />
  ) : isArtifactVisible ? (
    <Artifact
      addToolApprovalResponse={addToolApprovalResponse}
      attachments={attachments}
      chatId={chatId}
      input={input}
      isReadonly={isReadonly}
      messages={messages}
      regenerate={regenerate}
      selectedModelId={currentModelId}
      selectedVisibilityType={visibilityType}
      sendMessage={sendMessage}
      setAttachments={setAttachments}
      setInput={setInput}
      setMessages={setMessages}
      status={status}
      stop={stop}
      votes={votes}
    />
  ) : (
    <WorkspacePreviewPanel />
  );

  const assistantControl = fullscreen && !compactChatOpen ? (
    <Button ref={launcherRef} variant="ghost" size="sm"
      aria-label="Открыть ассистента" aria-expanded={false} aria-controls="compact-assistant-chat"
      onClick={(event) => { setKeyboardTransition(event.detail === 0); setCompactChatOpen(true); }}
    ><Sparkles strokeWidth={1.5} /><span>Ассистент</span>{(status === "streaming" || status === "submitted") && <span className="size-1.5 rounded-full bg-current" aria-label="Готовит ответ" />}</Button>
  ) : null;

  return (
    <TableAssistantControlContext.Provider value={assistantControl}>
      <div ref={shellRef} className="h-dvh w-full overflow-hidden">
        {isMobile || !isWorkspaceVisible ? (
          chatPane
        ) : (
          <ResizablePanelGroup
            autoSaveId="arkasha-chat-workspace"
            className="h-dvh"
            id="arkasha-chat-workspace"
            orientation="horizontal"
          >
            <ResizablePanel
              data-testid="chat-panel"
              defaultSize="40%"
              id="chat"
              maxSize="70%"
              minSize="28%"
            >
              {chatPane}
            </ResizablePanel>
            <ResizableHandle
              aria-label="Изменить ширину чата"
              disabled={fullscreen}
              aria-hidden={fullscreen || undefined}
              data-testid="chat-resize-handle"
              id="chat-resize-handle"
              style={{ width: 1, backgroundColor: "transparent", borderRight: "1px solid var(--border)", boxSizing: "border-box" }}
            />
            <ResizablePanel
              data-testid="workspace-panel"
              defaultSize="60%"
              id="workspace"
              minSize="30%"
            >
              <motion.div
                layout="position"
                className={`h-full min-w-0 ${styles.workspace} ${fullscreen ? styles.fullscreenTable : ""}`}
                initial={false}
                transition={transition}
              >{workspacePane}</motion.div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <div className={styles.tableActions}>
        {isTableVisible && !isMobile && <Button
          variant="ghost" size="icon"
          aria-label={farmMode ? "Показать таблицу" : "Показать 3D-ферму"}
          title={farmMode ? "Показать таблицу" : "Показать 3D-ферму"}
          aria-pressed={farmMode}
          data-testid="farm-view-toggle"
          className={farmMode ? "bg-muted text-foreground" : undefined}
          onClick={() => setPreview(current => ({ ...(current ?? initialWorkspacePreview), displayMode: current?.displayMode === "farm" ? "table" : "farm" }), false)}
        ><CowIcon /></Button>}
        {isTableVisible && !isMobile && <Button
          ref={fullscreenButtonRef}
          variant="ghost" size="icon"
          aria-label={fullscreen ? `Вернуть ${farmMode ? "ферму" : "таблицу"} рядом с чатом` : `Развернуть ${farmMode ? "ферму" : "таблицу"} на весь экран`}
          title={fullscreen ? "Вернуть рядом с чатом" : "Развернуть на весь экран"}
          aria-pressed={fullscreen}
          onClick={(event) => {
            setKeyboardTransition(event.detail === 0);
            setCompactChatOpen(!fullscreen);
            setTableFullscreen(!fullscreen);
          }}
        >{fullscreen ? <Minimize2 strokeWidth={1.5} /> : <Maximize2 strokeWidth={1.5} />}</Button>}
        <Button variant="ghost" size="icon"
          aria-label={preview.isVisible ? "Закрыть таблицу" : "Открыть таблицу"}
          title={preview.isVisible ? "Закрыть таблицу" : "Открыть таблицу"}
          aria-pressed={preview.isVisible}
          onClick={(event) => {
            setKeyboardTransition(event.detail === 0);
            setTableFullscreen(false);
            setCompactChatOpen(false);
            setPreview(current => ({ ...(current ?? initialWorkspacePreview), attachment: null, type: "table", isVisible: !current?.isVisible }), false);
          }}
        ><PanelRight strokeWidth={1.5} /></Button>
      </div>


      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Модель не подключена</AlertDialogTitle>
            <AlertDialogDescription>
              Подключите OpenAI-compatible модель или активируйте Vercel AI
              Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Закрыть</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateGateway}>
              Открыть Vercel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TableAssistantControlContext.Provider>
  );
}
