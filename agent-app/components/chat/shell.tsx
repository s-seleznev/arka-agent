"use client";

import { motion, useReducedMotion } from "framer-motion";
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
    <div className="flex size-full min-w-0 flex-col bg-background">
      <ChatHeader key={chatId} />

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
    </div>
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

  return (
    <>
      <div className="h-dvh w-full overflow-hidden">
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
                className="h-full min-w-0"
                initial={{ x: reduceMotion ? 0 : 64, opacity: reduceMotion ? 1 : 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >{workspacePane}</motion.div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
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
    </>
  );
}
