/**
 * Migration: add `project_name` to `inventory_sites`.
 *
 * Usage:  node scripts/migrate-site-project-name.js
 *
 * server.js runs sync({ alter: false }) globally, so new columns are NOT applied
 * automatically. This script adds the denormalised `project_name` column that
 * the site consumption report reads.
 *
 * Idempotent — safe to re-run. ⚠️  Back up before running against production.
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

async function columnExists(table, column) {
  try {
    const desc = await qi.describeTable(table);
    return Object.keys(desc).some(
      (c) => c.toLowerCase() === column.toLowerCase(),
    );
  } catch {
    return false;
  }
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    const sites = await findActualTableName("inventory_sites");
    if (!sites) {
      // Table doesn't exist yet — model sync creates it with project_name.
      await db.Site.sync();
      console.log("✅ Created `inventory_sites` (includes project_name).");
    } else if (await columnExists(sites, "project_name")) {
      console.log("ℹ️  `project_name` column already exists — skipped.");
    } else {
      await qi.addColumn(sites, "project_name", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      console.log(`✅ Added \`project_name\` to \`${sites}\`.`);
    }

    console.log("\n🎉 Site project_name migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
