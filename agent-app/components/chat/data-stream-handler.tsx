"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useActiveChat } from "@/hooks/use-active-chat";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import {
  initialWorkspacePreview,
  useWorkspacePreview,
} from "@/hooks/use-workspace-preview";
import { artifactDefinitions } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function DataStreamHandler() {
  const { dataStream, setDataStream } = useDataStream();
  const { setChatTitle } = useActiveChat();
  const { mutate } = useSWRConfig();

  const { artifact, setArtifact, setMetadata } = useArtifact();
  const { setPreview } = useWorkspacePreview();

  useEffect(() => {
    if (!dataStream?.length) {
      return;
    }

    const newDeltas = dataStream.slice();
    setDataStream([]);

    for (const delta of newDeltas) {
      if (delta.type === "data-chat-title") {
        setChatTitle(delta.data);
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        continue;
      }
      if (delta.type === "data-view-state") {
        setPreview(
          (current) => ({
            ...(current ?? initialWorkspacePreview),
            attachment: null,
            expandedGroupPaths: [],
            isVisible: true,
            selectedIds: [],
            title: undefined,
            type: "table",
            view: delta.data,
            viewportRowIds: [],
          }),
          false
        );
        mutate(
          (key) =>
            typeof key === "string" && key.includes("/api/views?chatId="),
          { view: delta.data },
          { revalidate: false }
        );
        continue;
      }
      if (delta.type === "data-animal-card") {
        setPreview(
          (current) => ({
            ...(current ?? initialWorkspacePreview),
            animalCard: delta.data.animal,
            isVisible: true,
            type: "table",
          }),
          false
        );
        continue;
      }
      const artifactDefinition = artifactDefinitions.find(
        (currentArtifactDefinition) =>
          currentArtifactDefinition.kind === artifact.kind
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          setArtifact,
          setMetadata,
          streamPart: delta,
        });
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: "streaming" };
        }

        switch (delta.type) {
          case "data-id":
            return {
              ...draftArtifact,
              documentId: delta.data,
              status: "streaming",
            };

          case "data-title":
            return {
              ...draftArtifact,
              status: "streaming",
              title: delta.data,
            };

          case "data-kind":
            return {
              ...draftArtifact,
              kind: delta.data,
              status: "streaming",
            };

          case "data-clear":
            return {
              ...draftArtifact,
              content: "",
              status: "streaming",
            };

          case "data-finish":
            return {
              ...draftArtifact,
              status: "idle",
            };

          default:
            return draftArtifact;
        }
      });
    }
  }, [
    dataStream,
    setArtifact,
    setMetadata,
    artifact,
    setDataStream,
    mutate,
    setPreview,
    setChatTitle,
  ]);

  return null;
}
