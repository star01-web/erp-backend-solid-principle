/**
 * Diagnostic: check what's in the ProjectSite table and whether
 * OfficeLocation still exists with data.
 *
 * Usage:  node scripts/diagnose-geofence.js
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const db = require("../src/common/index.db");

const sequelize = db.sequelize;

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected\n");

    // 1. Check what tables exist related to locations/sites
    const [tables] = await sequelize.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = :db
         AND (LOWER(TABLE_NAME) LIKE '%office%'
           OR LOWER(TABLE_NAME) LIKE '%location%'
           OR LOWER(TABLE_NAME) LIKE '%projectsite%'
           OR LOWER(TABLE_NAME) LIKE '%project_site%'
           OR LOWER(TABLE_NAME) LIKE '%site%')`,
      { replacements: { db: process.env.DB_NAME } },
    );
    console.log("📋 Location/Site related tables in DB:");
    if (tables.length === 0) {
      console.log("   ❌ NONE FOUND!\n");
    } else {
      tables.forEach((t) => console.log(`   - ${t.TABLE_NAME}`));
      console.log();
    }

    // 2. Query ProjectSite table (what the code uses)
    try {
      const [rows] = await sequelize.query("SELECT * FROM `ProjectSite`");
      console.log(`📍 ProjectSite table: ${rows.length} row(s)`);
      rows.forEach((r) =>
        console.log(
          `   id=${r.id} | "${r.locationName}" | lat=${r.latitude} lng=${r.longitude} | radius=${r.radiusInMeters}m`,
        ),
      );
      if (rows.length === 0) console.log("   ⚠️  TABLE IS EMPTY — this is why geofence always fails!");
    } catch (e) {
      console.log(`❌ ProjectSite table error: ${e.message}`);
    }
    console.log();

    // 3. Check if old OfficeLocation table exists with data
    try {
      const [rows] = await sequelize.query("SELECT * FROM `OfficeLocation`");
      console.log(`📍 OfficeLocation (OLD) table: ${rows.length} row(s)`);
      rows.forEach((r) =>
        console.log(
          `   id=${r.id} | "${r.locationName}" | lat=${r.latitude} lng=${r.longitude} | radius=${r.radiusInMeters || "NULL"}m`,
        ),
      );
      if (rows.length > 0) {
        console.log("\n   🔴 DATA IS IN OLD TABLE! The code queries ProjectSite but data is in OfficeLocation.");
        console.log("   FIX: Run  node scripts/migrate-projectsite-and-vehicle.js");
      }
    } catch (e) {
      console.log(`   OfficeLocation table: does not exist (OK)`);
    }
    console.log();

    // 4. Also check inventory_sites (the inventory Site model)
    try {
      const [rows] = await sequelize.query("SELECT id, name, project_name, is_active FROM `inventory_sites` LIMIT 5");
      console.log(`📍 inventory_sites table: ${rows.length} row(s) (first 5)`);
      rows.forEach((r) => console.log(`   id=${r.id} | "${r.name}" | project=${r.project_name} | active=${r.is_active}`));
    } catch (e) {
      // ignore
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed:", error.message);
    process.exit(1);
  }
})();
