import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  type FilterGroup,
  type GroupPath,
  type GroupRule,
  MAX_GROUP_RULES,
  type SortRule,
} from "./types";

const CURSOR_VERSION = 1 as const;
const processCursorSecret = randomBytes(32);

const cursorPayloadSchema = z
  .object({
    after: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    asOf: z.iso.datetime(),
    fingerprint: z.string().length(64),
    kind: z.enum(["groups", "rows"]),
    level: z.number().int().min(0).max(MAX_GROUP_RULES),
    revision: z.number().int().nonnegative(),
    snapshot: z.string().min(1).max(128),
    v: z.literal(CURSOR_VERSION),
    viewId: z.uuid(),
  })
  .strict();

export type FarmCursorPayload = z.infer<typeof cursorPayloadSchema>;

export class FarmCursorError extends Error {
  code: "CURSOR_INVALID" | "CURSOR_STALE" | "CURSOR_TAMPERED";

  constructor(code: FarmCursorError["code"], options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

function cursorSecret() {
  const configured = process.env.CURSOR_SECRET ?? process.env.AUTH_SECRET;
  return configured ? Buffer.from(configured, "utf8") : processCursorSecret;
}

function signature(encodedPayload: string) {
  return createHmac("sha256", cursorSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function encodeFarmCursor(payload: Omit<FarmCursorPayload, "v">) {
  const parsed = cursorPayloadSchema.parse({ ...payload, v: CURSOR_VERSION });
  const encoded = Buffer.from(canonicalJson(parsed), "utf8").toString(
    "base64url"
  );
  return `${encoded}.${signature(encoded)}`;
}

export function decodeFarmCursor(cursor: string): FarmCursorPayload {
  const [encoded, suppliedSignature, extra] = cursor.split(".");
  if (!(encoded && suppliedSignature) || extra !== undefined) {
    throw new FarmCursorError("CURSOR_INVALID");
  }
  const expectedSignature = signature(encoded);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new FarmCursorError("CURSOR_TAMPERED");
  }
  try {
    return cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    );
  } catch (cause) {
    throw new FarmCursorError("CURSOR_INVALID", { cause });
  }
}

export function hashSnapshotMarker(marker: {
  refreshedAt: Date | string;
  revision: bigint | number | string;
}) {
  return createHash("sha256")
    .update(`${marker.revision}:${new Date(marker.refreshedAt).toISOString()}`)
    .digest("hex");
}

export function reportQueryFingerprint(input: {
  columns: string[];
  farmIds: string[];
  filters: FilterGroup;
  groupBy: GroupRule[];
  groupPath: GroupPath;
  kind: "groups" | "rows";
  revision: number;
  sort: SortRule[];
  viewId: string;
}) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function groupPathKey(path: GroupPath) {
  return createHash("sha256").update(canonicalJson(path)).digest("base64url");
}

export function assertCursorMatches(
  payload: FarmCursorPayload,
  expected: {
    fingerprint: string;
    kind: FarmCursorPayload["kind"];
    level: number;
    revision: number;
    snapshot: string;
    viewId: string;
  }
) {
  if (
    payload.fingerprint !== expected.fingerprint ||
    payload.kind !== expected.kind ||
    payload.level !== expected.level ||
    payload.revision !== expected.revision ||
    payload.snapshot !== expected.snapshot ||
    payload.viewId !== expected.viewId
  ) {
    throw new FarmCursorError("CURSOR_STALE");
  }
}
