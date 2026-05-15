/** Written under `.data/` after bootstrap SQL succeeds (PGlite dev fallback). */
export const PG_LITE_SCHEMA_MARKER_FILE = ".pglite-schema-v1";

/**
 * PostgreSQL DDL aligned with Drizzle `pg-core` schema.
 * PGlite speaks Postgres; enums + tables match production Postgres definitions.
 */
export const PG_LITE_BOOTSTRAP_SQL = `
DO $$ BEGIN
  CREATE TYPE plan AS ENUM ('free', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('draft', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE video_gen_type AS ENUM ('text-to-video', 'image-to-video');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE video_style AS ENUM ('realistic', 'cartoon', 'animated-3d', 'cinematic');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE video_status AS ENUM ('queued', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM ('video_generated', 'character_added', 'project_created', 'style_applied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  plan plan NOT NULL DEFAULT 'free',
  credits integer NOT NULL DEFAULT 1000,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  thumbnail_url text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status project_status NOT NULL DEFAULT 'draft',
  thumbnail_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  prompt text NOT NULL,
  generation_type video_gen_type NOT NULL,
  style video_style NOT NULL DEFAULT 'realistic',
  status video_status NOT NULL DEFAULT 'queued',
  video_url text,
  thumbnail_url text,
  duration real,
  character_id integer REFERENCES characters(id),
  background_replaced boolean NOT NULL DEFAULT false,
  background_prompt text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type activity_type NOT NULL,
  description text NOT NULL,
  resource_id integer,
  resource_type text,
  created_at timestamp NOT NULL DEFAULT now()
);
`;
