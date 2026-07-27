/**
 * Migration: bring `inventory_sites` up to the current Site model schema.
 *
 * Usage:  node scripts/migrate-inventory-sites-columns.js
 *
 * Production tables were created from the OLD Site model
 * (name / location / projectId). The current model writes
 * site_name / manager_name / contact_number / site_location, and
 * server.js runs sync({ alter: false }) globally, so the new columns are
 * never applied automatically — inserts fail with
 * "Unknown column 'site_name'".
 *
 * This script (idempotent — safe to re-run):
 *   1. adds the missing new columns,
 *   2. copies data from the old columns (name -> site_name,
 *      location -> site_location),
 *   3. makes old NOT NULL columns nullable so new inserts don't fail.
 * Old columns are NOT dropped (no data loss). ⚠️  Back up before running
 * against production.
 */
require("dotenv").config();
const { DataTypes } = require("sequelize");
const db = require("../src/common/index.db");

const sequelize = db.sequelize;
const qi = sequelize.getQueryInterface();
const DB_NAME = process.env.DB_NAME;

async function findActualTableName(candidate) {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = :db AND LOWER(TABLE_NAME) = LOWER(:name)`,
    { replacements: { db: DB_NAME, name: candidate } },
  );
  return rows.length ? rows[0].name : null;
}

async function getColumns(table) {
  const desc = await qi.describeTable(table);
  return desc; // { columnName: { allowNull, type, ... } }
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    const table = await findActualTableName("inventory_sites");
    if (!table) {
      // Table doesn't exist yet — model sync creates it with the new schema.
      await db.Site.sync();
      console.log("✅ Created `inventory_sites` with the current schema.");
      process.exit(0);
    }

    const cols = await getColumns(table);
    const has = (c) =>
      Object.keys(cols).some((k) => k.toLowerCase() === c.toLowerCase());

    // 1. Add missing NEW columns (site_name nullable first; data copy ke baad
    //    NOT NULL enforce karenge).
    const newColumns = [
      ["site_name", { type: DataTypes.STRING, allowNull: true }],
      [
        "manager_name",
        { type: DataTypes.STRING, allowNull: true, defaultValue: "Unassigned" },
      ],
      ["contact_number", { type: DataTypes.STRING(100), allowNull: true }],
      ["site_location", { type: DataTypes.TEXT, allowNull: true }],
      ["project_name", { type: DataTypes.STRING, allowNull: true }],
    ];
    for (const [col, def] of newColumns) {
      if (has(col)) {
        console.log(`ℹ️  \`${col}\` already exists — skipped.`);
      } else {
        await qi.addColumn(table, col, def);
        console.log(`✅ Added \`${col}\`.`);
      }
    }

    // 2. Copy data from old columns where the new ones are still empty.
    if (has("name")) {
      const [, meta] = await sequelize.query(
        `UPDATE \`${table}\` SET site_name = name
          WHERE site_name IS NULL AND name IS NOT NULL`,
      );
      console.log(
        `✅ Copied name -> site_name (${meta?.affectedRows ?? 0} rows).`,
      );
    }
    if (has("location")) {
      const [, meta] = await sequelize.query(
        `UPDATE \`${table}\` SET site_location = location
          WHERE site_location IS NULL AND location IS NOT NULL`,
      );
      console.log(
        `✅ Copied location -> site_location (${meta?.affectedRows ?? 0} rows).`,
      );
    }

    // 3. Enforce NOT NULL on site_name now that data is copied.
    await qi.changeColumn(table, "site_name", {
      type: DataTypes.STRING,
      allowNull: false,
    });
    console.log("✅ `site_name` is now NOT NULL.");

    // 4. Old NOT NULL columns ko nullable banao taaki naye inserts (jo sirf
    //    model attributes bhejte hain) fail na ho. Columns drop NahI karte —
    //    data safe rehta hai.
    if (has("name") && cols.name.allowNull === false) {
      await qi.changeColumn(table, "name", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      console.log("✅ Old `name` column is now nullable (data preserved).");
    }

    console.log("\n🎉 inventory_sites schema migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
