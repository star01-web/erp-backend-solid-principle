/**
 * One-time / on-demand sync for the Site Management tables ONLY.
 *
 * Usage:  node scripts/sync-site-tables.js
 *
 * server.js deliberately runs sync({ alter: false }) globally, so new tables
 * and index changes are never applied automatically. This script targets just
 * the three site models so the rest of the schema is untouched.
 *
 * NOTE: alter:true can DROP/recreate indexes on these three tables (e.g. the
 * unique_site_stock_idx change from 2 to 4 columns). Take a backup before
 * running against a production database.
 */
require("dotenv").config();
const db = require("../src/common/index.db");

// Order matters: Site pehle, kyunki baaki dono uski FK use karte hain
const MODELS_TO_SYNC = ["Site", "SiteStockLevel", "SiteMaterialReturn"];

const syncSiteTables = async () => {
  try {
    await db.sequelize.authenticate();
    console.log("✅ Database connected.");

    for (const modelName of MODELS_TO_SYNC) {
      await db[modelName].sync({ alter: true });
      console.log(`✅ Synced: ${modelName} (${db[modelName].tableName})`);
    }

    console.log("🎉 All site management tables synced successfully.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Site table sync failed:", error.message);
    process.exit(1);
  }
};

syncSiteTables();
