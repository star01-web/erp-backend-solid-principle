/**
 * Migration: Multi-UOM support.
 *
 * Usage:  node scripts/migrate-multi-uom.js
 *
 * server.js runs sync({ alter: false }) globally, so new columns are NOT applied
 * automatically. This script adds:
 *   1. base_uom, purchase_uom, conversion_factor  -> inventory_products
 *   2. uom, base_quantity                          -> inventory_site_dispatch_logs
 *
 * For existing ledger rows (single-UOM era) base_quantity is backfilled from
 * quantity and uom defaulted, so historical reports stay correct.
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

async function addColumnIfMissing(table, column, spec) {
  if (await columnExists(table, column)) {
    console.log(`ℹ️  \`${column}\` already on \`${table}\` — skipped.`);
    return false;
  }
  await qi.addColumn(table, column, spec);
  console.log(`✅ Added \`${column}\` to \`${table}\`.`);
  return true;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    // --- 1. inventory_products: UOM columns ---
    const products = await findActualTableName("inventory_products");
    if (!products) {
      await db.Product.sync();
      console.log("✅ Created `inventory_products` (includes UOM columns).");
    } else {
      await addColumnIfMissing(products, "base_uom", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pcs",
      });
      await addColumnIfMissing(products, "purchase_uom", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      await addColumnIfMissing(products, "conversion_factor", {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 1,
      });
    }

    // --- 2. inventory_site_dispatch_logs: uom + base_quantity ---
    const logs = await findActualTableName("inventory_site_dispatch_logs");
    if (!logs) {
      await db.SiteDispatchLog.sync();
      console.log(
        "✅ Created `inventory_site_dispatch_logs` (includes uom + base_quantity).",
      );
    } else {
      // Add nullable first, backfill, then the app enforces NOT NULL going forward.
      const addedUom = await addColumnIfMissing(logs, "uom", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      const addedBase = await addColumnIfMissing(logs, "base_quantity", {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: true,
      });

      if (addedBase) {
        // Historic rows were single-UOM: base_quantity == quantity.
        await sequelize.query(
          `UPDATE \`${logs}\` SET base_quantity = quantity WHERE base_quantity IS NULL`,
        );
        console.log("✅ Backfilled base_quantity = quantity on legacy rows.");
      }
      if (addedUom) {
        // Default legacy uom to each item's base_uom.
        await sequelize.query(
          `UPDATE \`${logs}\` l
             JOIN \`${products}\` p ON p.id = l.item_id
              SET l.uom = p.base_uom
            WHERE l.uom IS NULL`,
        );
        console.log("✅ Backfilled uom = item.base_uom on legacy rows.");
      }
    }

    console.log("\n🎉 Multi-UOM migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
