import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { farmErrorStatus, publicFarmError } from "@/lib/farm/errors";
import {
  createDefaultView,
  getSavedView,
  getSavedViewForChat,
} from "@/lib/farm/views";

const createSchema = z.object({ chatId: z.uuid(), farmId: z.uuid() });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const url = new URL(request.url);
  const viewId = url.searchParams.get("viewId");
  const chatId = url.searchParams.get("chatId");
  try {
    const view = viewId
      ? await getSavedView({
          id: z.uuid().parse(viewId),
          userId: session.user.id,
        })
      : chatId
        ? await getSavedViewForChat({
            chatId: z.uuid().parse(chatId),
            userId: session.user.id,
          })
        : null;
    return Response.json({ view });
  } catch {
    return Response.json({ error: "INVALID_VIEW_REQUEST" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const input = createSchema.parse(await request.json());
    const view = await createDefaultView({ ...input, userId: session.user.id });
    return Response.json({ view }, { status: 201 });
  } catch (error) {
    const failure = publicFarmError(error, "VIEW_CREATE_FAILED");
    return Response.json(
      { error: failure.code },
      { status: farmErrorStatus(failure.code) }
    );
  }
}
