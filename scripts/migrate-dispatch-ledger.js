/**
 * Migration for the Site Dispatch ledger feature.
 *
 * Usage:  node scripts/migrate-dispatch-ledger.js
 *
 * server.js runs sync({ alter: false }) globally, so new tables/columns are NOT
 * applied automatically. This script:
 *   1. Creates the `inventory_site_dispatch_logs` table (with its indexes + FKs).
 *   2. Adds the `total_stock` column to `inventory_products` if missing.
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

    // Step 1: add total_stock to inventory_products (dependency of the ledger flow).
    const products = await findActualTableName("inventory_products");
    if (!products) {
      await db.Product.sync();
      console.log("✅ Step 1: Created `inventory_products` (includes total_stock).");
    } else if (await columnExists(products, "total_stock")) {
      console.log("ℹ️  Step 1: `total_stock` column already exists — skipped.");
    } else {
      await qi.addColumn(products, "total_stock", {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: false,
        defaultValue: 0,
      });
      console.log(`✅ Step 1: Added \`total_stock\` to \`${products}\`.`);
    }

    // Step 2: create or update the ledger table
    const dispatchLogsTable = await findActualTableName("inventory_site_dispatch_logs");
    if (!dispatchLogsTable) {
      await db.SiteDispatchLog.sync();
      console.log(
        "✅ Step 2: Synced `inventory_site_dispatch_logs` (table + indexes + FKs).",
      );
    } else {
      if (!(await columnExists(dispatchLogsTable, "reference_no"))) {
        await qi.addColumn(dispatchLogsTable, "reference_no", {
          type: DataTypes.STRING,
          allowNull: true,
          comment: "Reference/Challan/Invoice number for dispatch or return",
        });
        console.log(`✅ Step 2: Added \`reference_no\` to \`${dispatchLogsTable}\`.`);
      } else {
        console.log("ℹ️  Step 2: `reference_no` column already exists in ledger table.");
      }
    }

    console.log("\n🎉 Dispatch ledger migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
