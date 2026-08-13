import type { Knex } from "knex";

const knexConfig: Record<string, Knex.Config> = {
    development: {
        client: "better-sqlite3",
        connection: { filename: "./data/dev.sqlite3" },
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
        seeds: { directory: "./src/db/seeds" },
    },
    test: {
        client: "better-sqlite3",
        connection: ":memory:",
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
    },
    production: {
        client: "better-sqlite3",
        connection: { filename: "./data/prod.sqlite3" },
        useNullAsDefault: true,
        migrations: {
            directory: "./src/db/migrations",
            loadExtensions: [".js"],
        },
    },
};

export default knexConfig;
