import "server-only";
import { z } from "zod";
import { getFarmClient } from "@/lib/farm/scope";

/** Public demos grant a visitor read access only to an explicitly published farm. */
export async function grantWelcomeFarmAccess(userId: string) {
  const farmId = process.env.DEMO_PUBLIC_FARM_ID?.trim();
  if (!farmId) return;
  if (
    process.env.DEMO_WELCOME_ENABLED !== "1" ||
    farmId !== process.env.FARM_ACTIVE_ID?.trim() ||
    !z.uuid().safeParse(farmId).success
  ) {
    throw new Error("INVALID_PUBLIC_DEMO_CONFIGURATION");
  }
  const client = getFarmClient();
  await client.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`arka-demo-access:${userId}`}))`;
    const [farm] = await tx`
      SELECT id FROM farm
      WHERE id=${farmId} AND status='ACTIVE'
        AND settings @> '{"publicDemo":true}'::jsonb`;
    if (!farm) throw new Error("PUBLIC_DEMO_FARM_NOT_PUBLISHED");
    await tx`
      INSERT INTO farm_access (farm_id,subject_id,role,valid_from)
      SELECT ${farmId},${userId},'READER',clock_timestamp()
      WHERE NOT EXISTS (
        SELECT 1 FROM farm_access
        WHERE farm_id=${farmId} AND subject_id=${userId}
          AND valid_from <= clock_timestamp()
          AND (valid_to IS NULL OR valid_to > clock_timestamp())
      )`;
  });
}
