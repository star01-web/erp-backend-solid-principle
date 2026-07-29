/**
 * Migration: Dual-UOM columns + soft-delete on inventory_transactions.
 *
 * Usage:  node scripts/migrate-dual-uom-transactions.js
 *
 * server.js runs sync({ alter: false }) globally, so new columns are NOT
 * applied automatically. This script:
 *   1. inventory_transactions me add karta hai:
 *        - uom               VARCHAR NULL          (entered unit: 'Bundle'/'mtr')
 *        - conversion_factor DECIMAL(15,4) DEF 1   (transaction-time frozen factor)
 *        - base_quantity     DECIMAL(15,3) NULL    (qty * factor, base UOM — saara math isi par)
 *        - deletedAt         DATETIME NULL         (paranoid soft-delete; audit trail)
 *   2. type ENUM ko widen karta hai (+SCRAP, +DISPATCH) — controllers ye types
 *      pehle se accept karte hain lekin ENUM me nahi the (insert fail hota tha).
 *   3. Legacy rows backfill: purani rows single-UOM era ki hain — quantity
 *      hamesha base UOM tha. Isliye base_quantity = ABS(quantity) (kuch purani
 *      OUTWARD rows negative sign ke saath store hui thi; sign type se aata
 *      hai, number se nahi). ADJUSTMENT signed hi rehta hai — wahi uska matlab
 *      hai. uom ko product.base_uom se default kiya jaata hai.
 *
 * NOTE: base_quantity STORED GENERATED column nahi hai — app-computed hai.
 * Reason: (a) legacy negative rows ko ABS chahiye, generated qty*factor galat
 * hota; (b) factor transaction-time par FREEZE hona chahiye — Product ka
 * conversion_factor baad me badle to purani rows nahi badalni chahiye;
 * (c) Sequelize generated columns me INSERT nahi kar sakta. SiteDispatchLog
 * bhi same app-computed pattern use karta hai.
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

// Current ENUM values of a column padho (idempotency check ke liye).
async function getEnumValues(table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS colType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { db: DB_NAME, table, column } },
  );
  if (!rows.length) return [];
  // colType looks like: enum('INWARD','OUTWARD',...)
  const m = String(rows[0].colType).match(/^enum\((.*)\)$/i);
  if (!m) return [];
  return m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    const txTable = await findActualTableName("inventory_transactions");
    if (!txTable) {
      // Table hi nahi hai — model sync se fresh create hoga (saare naye
      // columns model me already defined hain).
      await db.StockTransaction.sync();
      console.log(
        "✅ Created `inventory_transactions` (includes dual-UOM columns).",
      );
      process.exit(0);
    }

    // --- 1. New columns ---
    await addColumnIfMissing(txTable, "uom", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfMissing(txTable, "conversion_factor", {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 1,
    });
    const addedBase = await addColumnIfMissing(txTable, "base_quantity", {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: true,
    });
    await addColumnIfMissing(txTable, "deletedAt", {
      type: DataTypes.DATE,
      allowNull: true,
    });

    // --- 2. Widen type ENUM (+SCRAP, +DISPATCH) ---
    const wanted = [
      "INWARD",
      "OUTWARD",
      "RETURN",
      "DAMAGE",
      "ADJUSTMENT",
      "SCRAP",
      "DISPATCH",
    ];
    const current = await getEnumValues(txTable, "type");
    const missing = wanted.filter((v) => !current.includes(v));
    if (missing.length) {
      // MODIFY COLUMN me table/values dynamic hain lekin hard-coded list se
      // aate hain (user input nahi) — injection risk nahi.
      const enumList = wanted.map((v) => `'${v}'`).join(",");
      await sequelize.query(
        `ALTER TABLE \`${txTable}\` MODIFY COLUMN \`type\` ENUM(${enumList}) NOT NULL`,
      );
      console.log(`✅ Widened \`type\` ENUM (+${missing.join(", +")}).`);
    } else {
      console.log("ℹ️  `type` ENUM already has SCRAP/DISPATCH — skipped.");
    }

    // --- 3. Backfill legacy rows ---
    if (addedBase) {
      // Legacy quantity hamesha base UOM tha. OUTWARD kuch rows negative
      // sign ke saath thin -> ABS. ADJUSTMENT signed hi sahi hai.
      await sequelize.query(
        `UPDATE \`${txTable}\`
            SET base_quantity = CASE
                                  WHEN type = 'ADJUSTMENT' THEN quantity
                                  ELSE ABS(quantity)
                                END,
                conversion_factor = 1
          WHERE base_quantity IS NULL`,
      );
      console.log(
        "✅ Backfilled base_quantity (ABS for non-ADJUSTMENT) + factor=1 on legacy rows.",
      );
    }

    // uom backfill — addedBase se independent chalao (partial past runs ke
    // against bhi idempotent: sirf NULL rows touch hoti hain).
    const products = await findActualTableName("inventory_products");
    if (products) {
      await sequelize.query(
        `UPDATE \`${txTable}\` tx
           JOIN \`${products}\` p ON p.id = tx.ProductId
            SET tx.uom = p.base_uom
          WHERE tx.uom IS NULL`,
      );
      console.log("✅ Backfilled uom = product.base_uom on legacy rows.");
    }

    console.log("\n🎉 Dual-UOM transactions migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
