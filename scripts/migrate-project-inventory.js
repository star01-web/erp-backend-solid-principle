/**
 * Migration Script: Project Inventory Layer (Sprint 1)
 *
 * Usage: node scripts/migrate-project-inventory.js
 *
 * Phase 1: DDL — Create inventory_projects & inventory_project_stock_levels,
 *          add project_id columns, update ENUMs and nullability.
 * Phase 2: Data Backfill — Create Project entries from existing Site.project_name
 *          and link sites + dispatch logs to project_id.
 *
 * Idempotent — safe to re-run.
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
    { replacements: { db: DB_NAME, name: candidate } }
  );
  return rows.length ? rows[0].name : null;
}

async function columnExists(table, column) {
  try {
    const desc = await qi.describeTable(table);
    return Object.keys(desc).some(
      (c) => c.toLowerCase() === column.toLowerCase()
    );
  } catch {
    return false;
  }
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.\n");

    console.log("--- PHASE 1: DDL STRUCTURE CHANGES ---");

    // 1. Sync inventory_projects table
    await db.Project.sync();
    console.log("✅ Synchronized `inventory_projects` table.");

    // 2. Sync inventory_project_stock_levels table
    await db.ProjectStockLevel.sync();
    console.log("✅ Synchronized `inventory_project_stock_levels` table.");

    // 3. Add project_id to inventory_sites
    const sitesTable = await findActualTableName("inventory_sites");
    if (sitesTable && !(await columnExists(sitesTable, "project_id"))) {
      await qi.addColumn(sitesTable, "project_id", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log(`✅ Added \`project_id\` to \`${sitesTable}\`.`);
    } else {
      console.log("ℹ️  \`inventory_sites.project_id\` already exists — skipped.");
    }

    // 4. Add project_id to inventory_site_dispatch_logs
    const dispatchLogsTable = await findActualTableName("inventory_site_dispatch_logs");
    if (dispatchLogsTable && !(await columnExists(dispatchLogsTable, "project_id"))) {
      await qi.addColumn(dispatchLogsTable, "project_id", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log(`✅ Added \`project_id\` to \`${dispatchLogsTable}\`.`);
    } else {
      console.log("ℹ️  \`inventory_site_dispatch_logs.project_id\` already exists — skipped.");
    }

    // 5. Add project_id to inventory_transactions
    const txTable = await findActualTableName("inventory_transactions");
    if (txTable && !(await columnExists(txTable, "project_id"))) {
      await qi.addColumn(txTable, "project_id", {
        type: DataTypes.UUID,
        allowNull: true,
      });
      console.log(`✅ Added \`project_id\` to \`${txTable}\`.`);
    } else {
      console.log("ℹ️  \`inventory_transactions.project_id\` already exists — skipped.");
    }

    // 6. Alter WarehouseId to allowNull: true on inventory_site_material_returns
    const returnsTable = await findActualTableName("inventory_site_material_returns");
    if (returnsTable) {
      if (await columnExists(returnsTable, "WarehouseId")) {
        await qi.changeColumn(returnsTable, "WarehouseId", {
          type: DataTypes.UUID,
          allowNull: true,
        });
        console.log(`✅ Altered \`WarehouseId\` to allowNull: true on \`${returnsTable}\`.`);
      }
      if (!(await columnExists(returnsTable, "project_id"))) {
        await qi.addColumn(returnsTable, "project_id", {
          type: DataTypes.UUID,
          allowNull: true,
        });
        console.log(`✅ Added \`project_id\` to \`${returnsTable}\`.`);
      } else {
        console.log("ℹ️  \`inventory_site_material_returns.project_id\` already exists — skipped.");
      }
    }

    // 7. Update type ENUM on inventory_transactions
    if (txTable) {
      try {
        await sequelize.query(`
          ALTER TABLE ${txTable} 
          MODIFY COLUMN type ENUM(
            'INWARD','OUTWARD','RETURN','DAMAGE','ADJUSTMENT','SCRAP','DISPATCH','PROJECT_TRANSFER'
          ) NOT NULL;
        `);
        console.log("✅ Updated `inventory_transactions.type` ENUM to include 'PROJECT_TRANSFER'.");
      } catch (enumErr) {
        console.warn("⚠️ Could not modify ENUM on inventory_transactions (may already be updated):", enumErr.message);
      }
    }

    console.log("\n--- PHASE 2: DATA MIGRATION & BACKFILL ---");

    // Backfill Projects from Site.project_name
    const sites = await db.Site.findAll({
      where: sequelize.literal("project_name IS NOT NULL AND TRIM(project_name) != ''"),
    });

    let migratedProjectsCount = 0;
    let updatedSitesCount = 0;

    for (const site of sites) {
      const pName = site.project_name.trim();
      const [project] = await db.Project.findOrCreate({
        where: { project_name: pName },
        defaults: {
          project_name: pName,
          description: `Auto-created from site '${site.site_name}'`,
          is_active: true,
        },
      });
      migratedProjectsCount++;

      if (site.project_id !== project.id) {
        site.project_id = project.id;
        await site.save();
        updatedSitesCount++;
      }
    }

    console.log(`✅ Backfilled/Validated ${migratedProjectsCount} projects from existing sites.`);
    console.log(`✅ Linked ${updatedSitesCount} sites to their parent projects.`);

    // Backfill project_id into inventory_site_dispatch_logs
    const [backfillResult] = await sequelize.query(`
      UPDATE inventory_site_dispatch_logs l
      JOIN inventory_sites s ON s.id = l.site_id
      SET l.project_id = s.project_id
      WHERE l.project_id IS NULL AND s.project_id IS NOT NULL;
    `);

    console.log(`✅ Backfilled project_id into site dispatch logs.`);

    console.log("\n🎉 Project Inventory Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
})();
