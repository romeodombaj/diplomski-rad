import type { Knex } from "knex";
import { mkdirSync } from "fs";
import { join } from "path";

// __dirname, not import.meta.url: this project compiles to CommonJS, where
// import.meta does not exist. tsx tolerated it in dev and tsc emitted it
// verbatim, so a built image would only fail at runtime, on the first DB call.
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, "data");
mkdirSync(dataDir, { recursive: true });

// Resolved from this file, not from process.cwd(). The migration directory used
// to be the relative "./src/db/migrations", which only works when the process
// happens to be started from the backend root — in a container it silently
// finds nothing and the app boots against an empty database.
const migrationsDir = join(__dirname, "migrations");
const seedsDir = join(__dirname, "seeds");

const knexConfig: Record<string, Knex.Config> = {
    development: {
        client: "better-sqlite3",
        connection: { filename: join(dataDir, "dev.sqlite3") },
        useNullAsDefault: true,
        migrations: {
            directory: migrationsDir,
            loadExtensions: [".js"],
        },
        seeds: { directory: seedsDir },
    },
    test: {
        client: "better-sqlite3",
        connection: { filename: ":memory:" },
        useNullAsDefault: true,
        migrations: {
            directory: migrationsDir,
            loadExtensions: [".js"],
        },
        seeds: { directory: seedsDir },
    },
    production: {
        client: "better-sqlite3",
        connection: { filename: join(dataDir, "prod.sqlite3") },
        useNullAsDefault: true,
        migrations: {
            directory: migrationsDir,
            loadExtensions: [".js"],
        },
        // Was absent, so knex fell back to a cwd-relative "./seeds" and the
        // boot-time db.seed.run() crashed the container with ENOENT.
        seeds: { directory: seedsDir },
    },
};

export default knexConfig;
