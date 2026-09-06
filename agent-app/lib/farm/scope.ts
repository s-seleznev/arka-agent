import "server-only";
import postgres from "postgres";
import type { FarmSummary } from "./types";

let farmClient: ReturnType<typeof postgres> | null = null;

export function getFarmClient() {
  if (!process.env.FARM_DATABASE_URL) {
    throw new Error("FARM_DATABASE_NOT_CONFIGURED");
  }
  farmClient ??= postgres(process.env.FARM_DATABASE_URL, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 5,
  });
  return farmClient;
}

function effectiveSubjectId(userId: string) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.FARM_DEMO_SUBJECT_ID
  ) {
    return process.env.FARM_DEMO_SUBJECT_ID;
  }
  return userId;
}

export function getAccessibleFarms(userId: string): Promise<FarmSummary[]> {
  const client = getFarmClient();
  const subjectId = effectiveSubjectId(userId);
  const activeFarmId = process.env.FARM_ACTIVE_ID?.trim();
  if (process.env.FARM_SKILL_PROFILE_ID === "lactis-prime-8" && !activeFarmId) {
    throw new Error("ACTIVE_FARM_NOT_CONFIGURED");
  }
  if (activeFarmId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeFarmId)) {
    throw new Error("INVALID_ACTIVE_FARM_CONFIGURATION");
  }
  return client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
    return transaction<FarmSummary[]>`
      SELECT f.id, f.name, f.timezone, fa.role
      FROM farm_access fa JOIN farm f ON f.id = fa.farm_id
      WHERE fa.subject_id = ${subjectId}
        AND fa.valid_from <= clock_timestamp()
        AND (fa.valid_to IS NULL OR fa.valid_to > clock_timestamp())
        AND f.status = 'ACTIVE'
        AND (${activeFarmId ?? null}::uuid IS NULL OR f.id = ${activeFarmId ?? null}::uuid)
      ORDER BY f.name, f.id`;
  });
}
