/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
    const existing = await knex("tenants")
        .where({ name: "Info Network" })
        .first();
    if (existing) return;

    const id =
        process.env.DEFAULT_TENANT_ID || "213e6988-e62d-47c5-9fe3-3a0331fa0eea";
    if (!id) throw new Error("DEFAULT_TENANT_ID is not set in .env");

    await knex("tenants").insert({ id, name: "Info Network" });

    console.log(`Seeded tenant "Info Network" with id: ${id}`);
};
