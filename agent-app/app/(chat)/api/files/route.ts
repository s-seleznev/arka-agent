import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getUploadedFilesByUserId } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const files = await getUploadedFilesByUserId({ userId: session.user.id });
  return NextResponse.json({ files });
}
