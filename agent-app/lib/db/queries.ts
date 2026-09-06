import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { defaultAnimalColumns } from "@/lib/farm/fields";
import {
  REPORT_VIEW_SCHEMA_VERSION,
  type ReportViewPatch,
  type ReportViewState,
  type RuleContext,
} from "@/lib/farm/types";
import { createDefaultFilterTree } from "@/lib/farm/view-model";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import { productDb as db } from "./client";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type ReportView,
  reportView,
  type Suggestion,
  stream,
  suggestion,
  type User,
  uploadedFile,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      email: user.email,
      id: user.id,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db
      .insert(chat)
      .values({
        createdAt: new Date(),
        id,
        title,
        userId,
        visibility,
      })
      .onConflictDoNothing({ target: chat.id });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(reportView).where(eq(reportView.chatId, id));
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createReportView({
  chatId,
  farmId,
  userId,
}: {
  chatId: string;
  farmId: string;
  userId: string;
}): Promise<ReportView> {
  const [created] = await db
    .insert(reportView)
    .values({
      chatId,
      columns: defaultAnimalColumns,
      farmId,
      filters: createDefaultFilterTree(farmId),
      groupBy: [],
      schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
      sort: [],
      userId,
    })
    .returning();
  return created;
}

export async function getReportViewById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  const [selected] = await db
    .select()
    .from(reportView)
    .where(and(eq(reportView.id, id), eq(reportView.userId, userId)))
    .limit(1);
  return selected ?? null;
}

export async function getLatestReportViewByChat({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}) {
  const [selected] = await db
    .select()
    .from(reportView)
    .where(and(eq(reportView.chatId, chatId), eq(reportView.userId, userId)))
    .orderBy(desc(reportView.updatedAt))
    .limit(1);
  return selected ?? null;
}

export async function updateReportView({
  expectedRevision,
  id,
  patch,
  userId,
}: {
  expectedRevision: number;
  id: string;
  patch: ReportViewPatch & { ruleContext?: RuleContext | null };
  userId: string;
}) {
  const [updated] = await db
    .update(reportView)
    .set({
      ...patch,
      revision: sql`${reportView.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reportView.id, id),
        eq(reportView.userId, userId),
        eq(reportView.revision, expectedRevision)
      )
    )
    .returning();
  return updated ?? null;
}

export async function migrateReportViewToLatest({
  expectedRevision,
  id,
  state,
  userId,
}: {
  expectedRevision: number;
  id: string;
  state: ReportViewState;
  userId: string;
}) {
  const [updated] = await db
    .update(reportView)
    .set({
      columns: state.columns,
      filters: state.filters,
      groupBy: state.groupBy,
      revision: sql`${reportView.revision} + 1`,
      schemaVersion: state.schemaVersion,
      sort: state.sort,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reportView.id, id),
        eq(reportView.userId, userId),
        eq(reportView.revision, expectedRevision),
        lt(reportView.schemaVersion, REPORT_VIEW_SCHEMA_VERSION)
      )
    )
    .returning();
  return updated ?? null;
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));
    await db.delete(reportView).where(inArray(reportView.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      isUpvoted: type === "up",
      messageId,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        content,
        createdAt: new Date(),
        id,
        kind,
        title,
        userId,
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const docs = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const [latest] = docs;
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveUploadedFile({
  contentType,
  name,
  pathname,
  size,
  userId,
  extractedText,
  textStatus,
}: {
  contentType: string;
  name: string;
  pathname: string;
  size: number;
  userId: string;
  extractedText: string | null;
  textStatus: "ready" | "unsupported" | "failed";
}) {
  try {
    const [file] = await db
      .insert(uploadedFile)
      .values({
        contentType,
        extractedText,
        name,
        pathname,
        size,
        textStatus,
        userId,
      })
      .returning();
    return file;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getKnowledgeContextForUser({
  query,
  userId,
}: {
  query: string;
  userId: string;
}) {
  // Legacy uploads have no farm binding. Do not expose them to an isolated farm agent.
  if (process.env.FARM_ACTIVE_ID) return "";
  const files = await db
    .select({
      extractedText: uploadedFile.extractedText,
      name: uploadedFile.name,
    })
    .from(uploadedFile)
    .where(eq(uploadedFile.userId, userId));

  const terms = Array.from(
    new Set(query.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  ).slice(0, 20);

  return files
    .filter((file) => file.extractedText)
    .map((file) => {
      const haystack = `${file.name}\n${file.extractedText}`.toLocaleLowerCase(
        "ru"
      );
      const score = terms.reduce(
        (sum, term) => sum + (haystack.includes(term) ? 1 : 0),
        0
      );
      return { ...file, score };
    })
    .filter((file) => terms.length === 0 || file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((file) => `## ${file.name}\n${file.extractedText?.slice(0, 18_000)}`)
    .join("\n\n");
}

export async function getUploadedFileById({ id }: { id: string }) {
  try {
    const [file] = await db
      .select()
      .from(uploadedFile)
      .where(eq(uploadedFile.id, id))
      .limit(1);
    return file ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export function getUploadedFilesByUserId({
  userId,
  limit = 20,
}: {
  userId: string;
  limit?: number;
}) {
  return db
    .select({
      contentType: uploadedFile.contentType,
      createdAt: uploadedFile.createdAt,
      id: uploadedFile.id,
      name: uploadedFile.name,
      size: uploadedFile.size,
      textStatus: uploadedFile.textStatus,
    })
    .from(uploadedFile)
    .where(eq(uploadedFile.userId, userId))
    .orderBy(desc(uploadedFile.createdAt))
    .limit(limit);
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ chatId, createdAt: new Date(), id: streamId });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}
