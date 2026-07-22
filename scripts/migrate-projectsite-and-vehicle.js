/**
 * One-time migration for two changes:
 *   1. Rename the `OfficeLocation` table  ->  `ProjectSite`  (data preserved).
 *   2. Add `vehicle_number` column to the `inventory_transactions` table.
 *
 * Usage:  node scripts/migrate-projectsite-and-vehicle.js
 *
 * server.js runs sync({ alter: false }) globally, so these schema changes are
 * NOT applied automatically. Run this script once against each environment.
 *
 * The script is IDEMPOTENT — re-running it is safe. Every step checks the
 * current DB state before acting, so a partial run can simply be re-run.
 *
 * NOTE (MySQL/InnoDB): `RENAME TABLE` automatically carries over foreign keys
 * that reference the table, so EmployeeMaster.location_id keeps pointing at the
 * renamed `ProjectSite` table. No FK rebuild is needed.
 *
 * ⚠️  Take a database backup before running against production.
 */
require("dotenv").config();
const { DataTypes } = require("sequelize");
const db = require("../src/common/index.db");

const sequelize = db.sequelize;
const qi = sequelize.getQueryInterface();
const DB_NAME = process.env.DB_NAME;

/**
 * Case-insensitive lookup of a table's actual stored name (MySQL on Windows may
 * fold table names to lowercase). Returns the real name, or null if not found.
 */
async function findActualTableName(candidate) {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = :db
        AND LOWER(TABLE_NAME) = LOWER(:name)`,
    { replacements: { db: DB_NAME, name: candidate } },
  );
  return rows.length ? rows[0].name : null;
}

async function columnExists(table, column) {
  try {
    const desc = await qi.describeTable(table);
    return Object.keys(desc).some((c) => c.toLowerCase() === column.toLowerCase());
  } catch {
    return false;
  }
}

async function rowCount(table) {
  const [[r]] = await sequelize.query("SELECT COUNT(*) AS n FROM `" + table + "`");
  return Number(r.n);
}

// --- Step 1: OfficeLocation -> ProjectSite ---------------------------------
async function renameOfficeLocationTable() {
  const projectSite = await findActualTableName("ProjectSite");
  const office = await findActualTableName("OfficeLocation");

  // Both exist: a prior sync() auto-created an empty `ProjectSite` while the
  // real data is still in `OfficeLocation`. Reconcile by dropping the empty
  // table and renaming the data table into its place. In InnoDB the incoming
  // foreign keys (EmployeeMaster.location_id) follow the rename automatically.
  if (projectSite && office) {
    const psRows = await rowCount(projectSite);
    const olRows = await rowCount(office);
    if (psRows === 0) {
      await sequelize.query(`DROP TABLE \`${projectSite}\``);
      await sequelize.query(`RENAME TABLE \`${office}\` TO \`ProjectSite\``);
      console.log(
        `✅ Step 1: Dropped empty \`${projectSite}\` and renamed \`${office}\` -> \`ProjectSite\` (${olRows} row(s) preserved).`,
      );
    } else {
      console.log(
        `⚠️  Step 1: Both \`${projectSite}\` (${psRows} rows) and \`${office}\` (${olRows} rows) hold data. Manual merge required — no automatic action taken.`,
      );
    }
    return;
  }

  if (projectSite) {
    console.log("ℹ️  Step 1: `ProjectSite` table already exists — rename skipped.");
    return;
  }

  if (office) {
    await sequelize.query(`RENAME TABLE \`${office}\` TO \`ProjectSite\``);
    console.log(`✅ Step 1: Renamed \`${office}\` -> \`ProjectSite\` (data preserved).`);
    return;
  }

  // Neither table exists yet — create ProjectSite fresh from the model.
  await db.ProjectSite.sync();
  console.log("✅ Step 1: No existing table found — created `ProjectSite` fresh.");
}

// --- Step 2: add vehicle_number to inventory_transactions ------------------
async function addVehicleNumberColumn() {
  const txTable = await findActualTableName("inventory_transactions");

  if (!txTable) {
    // Transactions table not created yet — sync the model to create it.
    await db.StockTransaction.sync();
    console.log(
      "✅ Step 2: `inventory_transactions` did not exist — created it (includes vehicle_number).",
    );
    return;
  }

  if (await columnExists(txTable, "vehicle_number")) {
    console.log("ℹ️  Step 2: `vehicle_number` column already exists — skipped.");
    return;
  }

  await qi.addColumn(txTable, "vehicle_number", {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Vehicle number used for the material movement (transport)",
  });
  console.log(`✅ Step 2: Added \`vehicle_number\` column to \`${txTable}\`.`);
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    await renameOfficeLocationTable();
    await addVehicleNumberColumn();

    console.log("\n🎉 Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  }
})();
