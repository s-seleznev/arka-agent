import { type InferSelectModel, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  FilterGroup,
  GroupRuleList,
  RuleContext,
  SortRule,
} from "@/lib/farm/types";
import type {
  NormalizedRule,
  RuleBinding,
  RuleDiagnostic,
} from "@/lib/rules/source-types";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const reportView = pgTable(
  "ReportView",
  {
    chatId: uuid("chatId").notNull(),
    columns: jsonb("columns").$type<string[]>().notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    entityType: varchar("entityType", { enum: ["animal"] })
      .notNull()
      .default("animal"),
    farmId: uuid("farmId").notNull(),
    filters: jsonb("filters").$type<FilterGroup>().notNull(),
    groupBy: jsonb("groupBy").$type<GroupRuleList>().notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    revision: integer("revision").notNull().default(0),
    ruleContext: jsonb("ruleContext").$type<RuleContext>(),
    schemaVersion: integer("schemaVersion").notNull().default(6),
    sort: jsonb("sort").$type<SortRule[]>().notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    check(
      "ReportView_groupBy_single_check",
      sql`jsonb_typeof(${table.groupBy}) = 'array' AND jsonb_array_length(${table.groupBy}) <= 1`
    ),
  ]
);

export type ReportView = InferSelectModel<typeof reportView>;

export const ruleSourceSnapshot = pgTable(
  "RuleSourceSnapshot",
  {
    id: uuid("id").primaryKey(),
    importedAt: timestamp("importedAt").notNull().defaultNow(),
    parserVersion: text("parserVersion").notNull(),
    rowCount: integer("rowCount").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex("RuleSourceSnapshot_source_version_uq").on(
      table.sha256,
      table.parserVersion
    ),
  ]
);

export const ruleDefinition = pgTable(
  "RuleDefinition",
  {
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    description: text("description").notNull(),
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    normalized: jsonb("normalized").$type<NormalizedRule>().notNull(),
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => ruleSourceSnapshot.id),
    sourceCompanyId: text("sourceCompanyId").notNull(),
    sourceListId: text("sourceListId").notNull(),
    version: text("version").notNull(),
  },
  (table) => [
    uniqueIndex("RuleDefinition_source_key_uq").on(
      table.snapshotId,
      table.sourceCompanyId,
      table.sourceListId
    ),
    index("RuleDefinition_name_idx").on(table.name),
  ]
);

export const ruleBinding = pgTable(
  "RuleBinding",
  {
    config: jsonb("config").$type<RuleBinding>().notNull(),
    diagnostics: jsonb("diagnostics").$type<RuleDiagnostic[]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    farmId: uuid("farmId").notNull(),
    id: uuid("id").primaryKey(),
    provenance: text("provenance").notNull(),
    ruleId: uuid("ruleId")
      .notNull()
      .references(() => ruleDefinition.id),
    version: text("version").notNull(),
  },
  (table) => [
    uniqueIndex("RuleBinding_version_uq").on(
      table.ruleId,
      table.farmId,
      table.version
    ),
    index("RuleBinding_farm_idx").on(table.farmId, table.enabled),
  ]
);

export const uploadedFile = pgTable("UploadedFile", {
  contentType: varchar("contentType", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  extractedText: text("extractedText"),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  pathname: text("pathname").notNull().unique(),
  size: integer("size").notNull(),
  textStatus: varchar("textStatus", {
    enum: ["ready", "unsupported", "failed"],
  })
    .notNull()
    .default("unsupported"),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type UploadedFile = InferSelectModel<typeof uploadedFile>;

export const message = pgTable("Message_v2", {
  attachments: json("attachments").notNull(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  parts: json("parts").notNull(),
  role: varchar("role").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    isUpvoted: boolean("isUpvoted").notNull(),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    content: text("content"),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    documentId: uuid("documentId").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    isResolved: boolean("isResolved").notNull().default(false),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
  },
  (table) => ({
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Stream = InferSelectModel<typeof stream>;
