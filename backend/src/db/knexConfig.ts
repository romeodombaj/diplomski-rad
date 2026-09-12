import type { Knex } from "knex";
import { mkdirSync } from "fs";
import { join } from "path";

const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, "data");
mkdirSync(dataDir, { recursive: true });

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
        seeds: { directory: seedsDir },
    },
};

export default knexConfig;
