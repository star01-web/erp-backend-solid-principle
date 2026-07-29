const { reconcileStock } = require("../services/reconcile.service");

/**
 * POST /reconcile-stock
 * "1-click reset": inventory_stock_levels ko inventory_transactions ledger
 * ke hisaab se recompute karke reset karta hai (details service me).
 *
 * Body / Query:
 *   dryRun=true            -> sirf report banao, DB ko haath mat lagao (rollback)
 *   syncProductTotal=false -> Product.total_stock sync skip karo (default: sync hota hai)
 *
 * Ye destructive operation hai, isliye route par canManageInventory guard
 * zaroori hai (route file me lagta hai).
 */
const runStockReconciliation = async (req, res) => {
  // Query aur body dono se flag uthao — UI button aksar bina body ke
  // ?dryRun=true bhejta hai. String "false" ko bhi sahi parse karo.
  const asBool = (v, fallback) => {
    if (v === undefined || v === null || v === "") return fallback;
    return v === true || v === "true" || v === "1" || v === 1;
  };

  const dryRun = asBool(req.body?.dryRun ?? req.query?.dryRun, false);
  const syncProductTotal = asBool(
    req.body?.syncProductTotal ?? req.query?.syncProductTotal,
    true,
  );

  const report = await reconcileStock({ dryRun, syncProductTotal });

  return res.status(200).json({
    success: true,
    message: dryRun
      ? "Dry run complete — koi data change nahi hua. Report neeche hai."
      : "Stock reconciliation complete. Stock levels ledger se reset ho gaye.",
    data: report,
  });
};

module.exports = { runStockReconciliation };
