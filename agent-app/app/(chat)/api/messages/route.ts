import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getLatestReportViewByChat,
  getMessagesByChatId,
  saveChat,
} from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const session = await auth();
  let chat = await getChatById({ id: chatId });
  if (!chat && session?.user) {
    const view = await getLatestReportViewByChat({
      chatId,
      userId: session.user.id,
    });
    if (view) {
      await saveChat({
        id: chatId,
        title: "Новая задача",
        userId: session.user.id,
        visibility: "private",
      });
      chat = await getChatById({ id: chatId });
    }
  }
  const messages = await getMessagesByChatId({ id: chatId });

  if (!chat) {
    return Response.json({
      isReadonly: false,
      messages: [],
      userId: null,
      visibility: "private",
    });
  }

  if (
    chat.visibility === "private" &&
    (!session?.user || session.user.id !== chat.userId)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const isReadonly = !session?.user || session.user.id !== chat.userId;

  return Response.json({
    isReadonly,
    messages: convertToUIMessages(messages),
    title: chat.title,
    userId: chat.userId,
    visibility: chat.visibility,
  });
}
