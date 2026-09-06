import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { productClient } from "@/lib/db/client";
import { getAccessibleFarms } from "@/lib/farm/scope";
import { getAuthorizedFieldRegistry } from "@/lib/farm/registry";
import {
  compileSemanticView,
  type ConfigureTableInput,
} from "@/lib/farm/semantic-view";
import { queryAnimals } from "@/lib/farm/queries";
import { REPORT_VIEW_SCHEMA_VERSION } from "@/lib/farm/types";
import { grantWelcomeFarmAccess } from "./access";

export const welcomeReports: {
  key: string;
  title: string;
  prompt: string;
  explanation: string;
  input: ConfigureTableInput;
}[] = [
  {
    key: "pregnancy",
    title: "Проверка стельности",
    prompt: "Кого нужно проверить на стельность?",
    explanation:
      "В таблице — осеменённые животные, у которых прошло не менее 32 дней после осеменения. Список сгруппирован по группе содержания.",
    input: {
      expectedRevision: null,
      filters: {
        combinator: "and",
        children: [
          { field: "isExited", operator: "eq", value: false },
          { field: "statusCode", operator: "eq", value: "INSEMINATED" },
          { field: "daysSinceInsemination", operator: "gte", value: 32 },
        ],
      },
      columns: [
        "primaryIdentifier",
        "name",
        "groupCode",
        "lactationNumber",
        "daysInMilk",
        "lastInseminationAt",
        "inseminationNumber",
        "lastBull",
      ],
      groupBy: [{ field: "groupCode", direction: "asc" }],
      sort: [{ field: "primaryIdentifier", direction: "asc" }],
    },
  },
  {
    key: "dry-off",
    title: "Запуск в сухостой",
    prompt: "Кого пора запускать в сухостой?",
    explanation:
      "Отобраны стельные коровы от 213 дней стельности без зарегистрированного запуска в текущей лактации. Первыми показаны животные с большим сроком стельности.",
    input: {
      expectedRevision: null,
      filters: {
        combinator: "and",
        children: [
          { field: "isExited", operator: "eq", value: false },
          { field: "lactationNumber", operator: "gt", value: 0 },
          { field: "isPregnant", operator: "eq", value: true },
          { field: "pregnancyDays", operator: "gte", value: 213 },
          { field: "lastDryOffDate", operator: "is_empty" },
          {
            field: "statusCode",
            operator: "not_in",
            value: ["FRESH", "DRY", "DO_NOT_INSEMINATE"],
          },
        ],
      },
      columns: [
        "primaryIdentifier",
        "name",
        "groupCode",
        "lactationNumber",
        "pregnancyDays",
        "expectedCalvingDate",
        "yesterdayMilkKg",
      ],
      groupBy: [],
      sort: [{ field: "pregnancyDays", direction: "desc" }],
    },
  },
  {
    key: "fresh",
    title: "Контроль новотельных",
    prompt: "Покажи новотельных для контроля",
    explanation:
      "Показаны животные в первые 14 дней после отёла: надой, последнее клиническое событие и комментарий.",
    input: {
      expectedRevision: null,
      filters: {
        combinator: "and",
        children: [
          { field: "isExited", operator: "eq", value: false },
          { field: "lactationNumber", operator: "gt", value: 0 },
          { field: "daysInMilk", operator: "between", value: [0, 14] },
        ],
      },
      columns: [
        "primaryIdentifier",
        "name",
        "daysInMilk",
        "lactationNumber",
        "yesterdayMilkKg",
        "lastClinicalEvent",
        "animalNote",
      ],
      groupBy: [],
      sort: [{ field: "daysInMilk", direction: "asc" }],
    },
  },
  {
    key: "protocols",
    title: "Животные на протоколах",
    prompt: "Покажи животных в работе",
    explanation:
      "В таблице — животные с активными назначениями: протокол, его текущий этап, следующая обработка и ответственный.",
    input: {
      expectedRevision: null,
      filters: {
        combinator: "and",
        children: [
          { field: "isExited", operator: "eq", value: false },
          { field: "activeProtocols", operator: "is_not_empty" },
        ],
      },
      columns: [
        "primaryIdentifier",
        "name",
        "groupCode",
        "activeProtocols",
        "protocolProgress",
        "nextProtocolDate",
        "protocolResponsible",
      ],
      groupBy: [],
      sort: [{ field: "nextProtocolDate", direction: "asc" }],
    },
  },
];

function reportId(userId: string, key: string) {
  const hash = createHash("sha256")
    .update(`arka-welcome-v1:${userId}:${key}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Seed only private, per-user reports. Existing edits and messages are never replaced. */
export async function ensureWelcomeWorkspace(userId: string) {
  await grantWelcomeFarmAccess(userId);
  const ids = welcomeReports.map((report) => reportId(userId, report.key));
  const existing = await productClient<
    { id: string }[]
  >`SELECT id FROM "Chat" WHERE "userId"=${userId} AND id=ANY(${ids}::uuid[])`;
  if (existing.length)
    return {
      chatId: ids.find((id) => existing.some((row) => row.id === id))!,
      created: false,
    };
  const farmId = process.env.FARM_ACTIVE_ID;
  const farm = (await getAccessibleFarms(userId)).find(
    (row) => row.id === farmId
  );
  if (!farm) throw new Error("FARM_ACCESS_DENIED");
  const registry = await getAuthorizedFieldRegistry(userId);
  const prepared: {
    report: (typeof welcomeReports)[number];
    patch: ReturnType<typeof compileSemanticView>;
    chatId: string;
    count: number;
    asOf: string;
  }[] = [];
  const requestedAt = new Date().toISOString();
  for (const [index, report] of welcomeReports.entries()) {
    const patch = compileSemanticView(
      report.input,
      farm.id,
      (id) => registry[id]?.type ?? "text"
    );
    const result = await queryAnimals({
      asOf: requestedAt,
      userId,
      filters: patch.filters!,
      columns: patch.columns!,
      sort: patch.sort!,
      groupBy: patch.groupBy!,
      limit: 1,
    });
    const asOf = new Date(result.asOf ?? requestedAt).toLocaleDateString(
      "ru-RU",
      {
        timeZone: farm.timezone,
      }
    );
    prepared.push({
      report,
      patch,
      chatId: ids[index],
      count: result.totalRows,
      asOf,
    });
  }
  return productClient.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`arka-welcome:${userId}`}))`;
    const concurrent = await tx<
      { id: string }[]
    >`SELECT id FROM "Chat" WHERE "userId"=${userId} AND id=ANY(${ids}::uuid[])`;
    if (concurrent.length)
      return {
        chatId: ids.find((id) => concurrent.some((row) => row.id === id))!,
        created: false,
      };
    for (const [index, item] of prepared.entries()) {
      const { report, patch, chatId, count, asOf } = item;
      const createdAt = new Date(Date.now() - index * 60_000).toISOString();
      await tx`INSERT INTO "Chat" (id,"userId",title,visibility,"createdAt") VALUES (${chatId},${userId},${report.title},'private',${createdAt})`;
      await tx`INSERT INTO "ReportView" (id,"chatId","userId","farmId","entityType","schemaVersion",revision,filters,columns,sort,"groupBy","createdAt","updatedAt") VALUES (${randomUUID()},${chatId},${userId},${farm.id},'animal',${REPORT_VIEW_SCHEMA_VERSION},0,${JSON.stringify(patch.filters)},${JSON.stringify(patch.columns)},${JSON.stringify(patch.sort)},${JSON.stringify(patch.groupBy)},${createdAt},${createdAt})`;
      const answer = `${report.explanation}\n\nНа ${asOf}: ${count} животных. Можно изменить условия в таблице или продолжить запрос в чате.`;
      for (const [role, text] of [
        ["user", report.prompt],
        ["assistant", answer],
      ]) {
        const messageCreatedAt = new Date(
          Date.parse(createdAt) + (role === "assistant" ? 1000 : 0)
        ).toISOString();
        await tx`INSERT INTO "Message_v2" (id,"chatId",role,parts,attachments,"createdAt") VALUES (${randomUUID()},${chatId},${role},${JSON.stringify([{ type: "text", text }])},'[]',${messageCreatedAt})`;
      }
    }
    return { chatId: ids[0], created: true };
  });
}
