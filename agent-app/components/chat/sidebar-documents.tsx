"use client";

import { FileTextIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useWorkspacePreview } from "@/hooks/use-workspace-preview";

type StoredFile = {
  contentType: string;
  id: string;
  name: string;
};

function StoredFileItem({ file }: { file: StoredFile }) {
  const { openFile } = useWorkspacePreview();
  const handleOpen = useCallback(() => {
    openFile({
      contentType: file.contentType,
      id: file.id,
      name: file.name,
      url: `/api/files/${file.id}`,
    });
  }, [file, openFile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="h-8 text-[13px]"
        onClick={handleOpen}
        tooltip={file.name}
      >
        <FileTextIcon className="size-4" />
        <span className="truncate">{file.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarDocuments() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const loadFiles = useCallback(async () => {
    const response = await fetch("/api/files");
    if (response.ok) {
      const data = (await response.json()) as { files: StoredFile[] };
      setFiles(data.files);
    }
  }, []);

  useEffect(() => {
    loadFiles();
    window.addEventListener("arkasha-files-changed", loadFiles);
    return () => window.removeEventListener("arkasha-files-changed", loadFiles);
  }, [loadFiles]);

  if (!files.length) {
    return null;
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
        Документы
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {files.map((file) => (
            <StoredFileItem file={file} key={file.id} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
