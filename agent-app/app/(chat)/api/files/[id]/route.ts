import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getUploadedFileById } from "@/lib/db/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const file = await getUploadedFileById({ id });
  if (!file || file.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await get(file.pathname, { access: "private" });
  if (result?.statusCode !== 200) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const disposition = new URL(request.url).searchParams.get("download")
    ? `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
    : `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`;

  return new Response(result.stream, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": disposition,
      "Content-Length": String(file.size),
      "Content-Type": file.contentType,
    },
  });
}
