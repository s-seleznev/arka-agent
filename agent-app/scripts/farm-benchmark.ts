import { performance } from "node:perf_hooks";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

async function main() {
  const databaseUrl = process.env.FARM_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("FARM_DATABASE_URL is required");
  }

  const iterations = 40;
  const warmups = 5;
  const client = postgres(databaseUrl, { max: 1 });
  const subjectId = process.env.FARM_DEMO_SUBJECT_ID ?? "test-manager";

  const [farm] = await client<Array<{ id: string; name: string }>>`
  SELECT f.id, f.name
  FROM farm_access fa JOIN farm f ON f.id = fa.farm_id
  WHERE fa.subject_id = ${subjectId}
  ORDER BY f.name LIMIT 1`;

  if (!farm) {
    throw new Error("No benchmark farm is available");
  }

  const statuses = ["LACTATING", "PREGNANT", "HEIFER", "FRESH"];
  const timings: number[] = [];

  for (let index = 0; index < iterations + warmups; index += 1) {
    const status = statuses[index % statuses.length];
    const startedAt = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: sequential samples measure one request without self-generated contention
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL ROLE arka_reader");
      await transaction`SELECT set_config('arka.farm_id', ${farm.id}, true)`;
      await transaction`
      SELECT count(*) FROM animal_state_query
      WHERE farm_id = ${farm.id} AND status_code = ${status}`;
      await transaction`
      SELECT animal_id, primary_identifier, name, group_code, status_code,
             lactation_number, is_pregnant, last_milk_kg
      FROM animal_state_query
      WHERE farm_id = ${farm.id} AND status_code = ${status}
      ORDER BY primary_identifier ASC NULLS LAST, animal_id ASC
      LIMIT 51 OFFSET 0`;
    });
    if (index >= warmups) {
      timings.push(performance.now() - startedAt);
    }
  }

  await client.end();

  timings.sort((left, right) => left - right);
  const percentile = (value: number) =>
    timings[
      Math.min(timings.length - 1, Math.ceil(timings.length * value) - 1)
    ];
  const result = {
    farm: farm.name,
    iterations,
    p50Ms: Number(percentile(0.5).toFixed(1)),
    p95Ms: Number(percentile(0.95).toFixed(1)),
  };

  console.log(JSON.stringify(result));
  if (result.p95Ms > 1000) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
