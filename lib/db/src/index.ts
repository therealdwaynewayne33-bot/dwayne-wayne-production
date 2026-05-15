import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import * as schema from "./schema";
import { PG_LITE_BOOTSTRAP_SQL, PG_LITE_SCHEMA_MARKER_FILE } from "./pglite-init-sql";

const { Pool } = pg;

function isProductionDeploy(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveWorkspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 14; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.resolve(process.cwd(), "../..");
}

function getWorkspaceDataDir(): string {
  return path.join(resolveWorkspaceRoot(), ".data");
}

function getPgliteDataDir(): string {
  return path.join(getWorkspaceDataDir(), "pglite-dev");
}

function getPgliteSchemaMarkerPath(): string {
  return path.join(getWorkspaceDataDir(), PG_LITE_SCHEMA_MARKER_FILE);
}

async function ensurePgliteSchema(client: PGlite): Promise<void> {
  const marker = getPgliteSchemaMarkerPath();
  if (existsSync(marker)) {
    return;
  }
  await client.exec(PG_LITE_BOOTSTRAP_SQL);
  writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
}

async function createDb(): Promise<{
  db: ReturnType<typeof drizzlePg<typeof schema>>;
  pool: InstanceType<typeof Pool> | null;
}> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    return { db: drizzlePg(pool, { schema }), pool };
  }

  if (isProductionDeploy()) {
    throw new Error(
      "DATABASE_URL is required when NODE_ENV=production. Set it to your Postgres connection string.",
    );
  }

  mkdirSync(getWorkspaceDataDir(), { recursive: true });
  const dataDir = getPgliteDataDir();
  console.info(`[db] DATABASE_URL not set — using embedded PGlite dev database at ${dataDir}`);

  const client = new PGlite(dataDir);
  await client.waitReady;
  await ensurePgliteSchema(client);

  return {
    db: drizzlePglite(client, { schema }) as unknown as ReturnType<typeof drizzlePg<typeof schema>>,
    pool: null,
  };
}

const _db = await createDb();
export const db = _db.db;
export const pool = _db.pool;

export * from "./schema";
