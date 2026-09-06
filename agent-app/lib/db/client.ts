import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export const productClient = postgres(process.env.POSTGRES_URL ?? "");
export const productDb = drizzle(productClient);
