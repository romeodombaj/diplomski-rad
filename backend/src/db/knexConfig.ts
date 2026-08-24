import type { Knex } from "knex";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = join(projectRoot, "data");
mkdirSync(dataDir, { recursive: true });

const knexConfig: Record<string, Knex.Config> = {
    development: {
        client: "better-sqlite3",
        connection: { filename: join(dataDir, "dev.sqlite3") },
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
        seeds: { directory: "./src/db/seeds" },
    },
    test: {
        client: "better-sqlite3",
        connection: { filename: ":memory:" },
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
    },
    production: {
        client: "better-sqlite3",
        connection: { filename: join(dataDir, "prod.sqlite3") },
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
    },
};

export default knexConfig;
