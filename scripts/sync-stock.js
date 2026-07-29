/**
 * Stock Reconciliation CLI — StockLevel ko inventory_transactions ledger se
 * recompute karke sync karta hai (same engine as POST /reconcile-stock).
 *
 * Usage:
 *   node scripts/sync-stock.js --dry-run          # report only, DB untouched (SAFE)
 *   node scripts/sync-stock.js                    # actually commit the sync
 *   node scripts/sync-stock.js --no-product-total # Product.total_stock sync skip
 *   node scripts/sync-stock.js --json             # machine-readable output
 *
 * Formula (per Product/Warehouse/Manufacturer key, BASE quantity):
 *   expected = SUM(INWARD + RETURN)
 *            - SUM(OUTWARD + DAMAGE + SCRAP + DISPATCH)
 *            + SUM(ADJUSTMENT as-signed)
 *   (sirf COMPLETED, non-deleted rows; COALESCE(base_quantity, quantity))
 *
 * Poora kaam EK sequelize.transaction() me hota hai — koi bhi update fail
 * hua toh pura rollback (partial corruption impossible). --dry-run par
 * calculations chal kar report banti hai lekin end me hamesha ROLLBACK.
 *
 * ⚠️  Destructive (bina --dry-run ke). Production par pehle --dry-run dekhein.
 */
require("dotenv").config();
const db = require("../src/common/index.db");
const { reconcileStock } = require("../src/modules/inventory/services/reconcile.service");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

if (has("--help") || has("-h")) {
  console.log(`
Stock Reconciliation CLI

  node scripts/sync-stock.js [options]

Options:
  --dry-run           Calculate + report only; transaction is rolled back,
                      database is NOT touched. Always run this first.
  --no-product-total  Skip syncing Product.total_stock to SUM(StockLevel).
  --json              Print the raw report as JSON (for piping/automation).
  --help, -h          Show this help.
`);
  process.exit(0);
}

const unknown = args.filter(
  (a) => !["--dry-run", "--no-product-total", "--json"].includes(a),
);
if (unknown.length) {
  console.error(`❌ Unknown option(s): ${unknown.join(", ")} (see --help)`);
  process.exit(1);
}

const dryRun = has("--dry-run");
const syncProductTotal = !has("--no-product-total");
const asJson = has("--json");

(async () => {
  try {
    await db.sequelize.authenticate();
    if (!asJson) {
      console.log("✅ Database connected.");
      console.log(
        dryRun
          ? "🔎 DRY RUN — report only, sab kuch rollback hoga.\n"
          : "⚠️  LIVE RUN — StockLevel ledger ke hisaab se reset hoga.\n",
      );
    }

    const report = await reconcileStock({ dryRun, syncProductTotal });

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    }

    console.log(`Ledger keys checked : ${report.ledger_keys_checked}`);
    console.log(`Buckets unchanged   : ${report.buckets_unchanged}`);
    console.log(`Buckets changed     : ${report.buckets_changed}`);
    console.log(`Product totals sync : ${report.product_totals_synced}`);

    if (report.changes.length) {
      console.log("\nChanges:");
      for (const c of report.changes) {
        const key =
          `Product ${c.productId} / Warehouse ${c.warehouseId}` +
          (c.manufacturerId ? ` / Mfr ${c.manufacturerId}` : "") +
          (c.color ? ` / ${c.color}` : "");
        const sign = c.delta > 0 ? "+" : "";
        console.log(
          `  • ${key}: ${c.old_quantity} → ${c.new_quantity} (${sign}${c.delta})` +
            (c.reason ? `  [${c.reason}]` : ""),
        );
      }
    }

    if (report.warnings.length) {
      console.log("\n⚠️  Warnings:");
      for (const w of report.warnings) console.log(`  • ${w}`);
    }

    console.log(
      dryRun
        ? "\n🔎 Dry run complete — database untouched (rolled back)."
        : "\n🎉 Stock sync committed successfully.",
    );
    process.exit(0);
  } catch (error) {
    // reconcileStock apna rollback khud karta hai; yahan sirf report + exit 1.
    console.error("\n❌ Stock sync failed (rolled back):", error.message);
    process.exit(1);
  }
})();
