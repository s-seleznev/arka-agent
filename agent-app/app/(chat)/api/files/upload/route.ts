import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { saveUploadedFile } from "@/lib/db/queries";
import { extractTextFromFile } from "@/lib/files/extract-text";

const allowedTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 20 * 1024 * 1024, {
      message: "Размер файла не должен превышать 20 МБ",
    })
    .refine((file) => allowedTypes.has(file.type), {
      message:
        "Поддерживаются PDF, DOCX, XLSX, TXT, MD, CSV, JSON и изображения",
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.issues
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileBuffer = await file.arrayBuffer();
    const extracted = await extractTextFromFile({
      bytes: fileBuffer,
      contentType: file.type,
    });

    try {
      const data = await put(
        `${session.user.id}/${crypto.randomUUID()}-${safeName}`,
        fileBuffer,
        {
          access: "private",
          addRandomSuffix: false,
        }
      );
      const storedFile = await saveUploadedFile({
        contentType: file.type || "application/octet-stream",
        extractedText: extracted.text,
        name: filename,
        pathname: data.pathname,
        size: file.size,
        textStatus: extracted.status,
        userId: session.user.id,
      });

      return NextResponse.json({
        contentType: storedFile.contentType,
        id: storedFile.id,
        name: storedFile.name,
        pathname: storedFile.name,
        size: storedFile.size,
        url: `/api/files/${storedFile.id}`,
      });
    } catch {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
