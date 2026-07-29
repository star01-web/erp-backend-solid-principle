/**
 * Stock Reconciliation ("1-click reset") service.
 *
 * Truth source = `inventory_transactions` (StockTransaction ledger).
 * Ye service har (Product, Warehouse, Manufacturer) key ke liye ledger se
 * expected balance nikaalti hai:
 *
 *   expected = SUM( INWARD + RETURN )                    -> stock IN
 *            - SUM( OUTWARD + DAMAGE + SCRAP + DISPATCH ) -> stock OUT
 *            + SUM( ADJUSTMENT as-signed )                -> +/- correction
 *   (sirf status = 'COMPLETED', deletedAt IS NULL rows count hoti hain;
 *    math BASE quantity par — COALESCE(base_quantity, quantity))
 *
 * ...aur `inventory_stock_levels` ko us number par RESET kar deti hai.
 *
 * NOTE (color granularity): StockTransaction table me `color` column nahi hai,
 * isliye ledger se per-color split reconstruct nahi ho sakta. Reconciliation
 * (Product, Warehouse, Manufacturer) level par hota hai:
 *   - positive delta  -> sabse bade color bucket me add hota hai
 *   - negative delta  -> fullest bucket se greedy drain (floor 0)
 * Colors ke BEECH ka split preserve rehta hai; sirf TOTAL ledger se match hota hai.
 *
 * Iske baad `Product.total_stock` (dispatch-ledger counter, hamesha base UOM)
 * ko SUM(StockLevel.current_quantity) par sync kiya jaata hai, taaki dono
 * counters ek hi number par aa jayen.
 *
 * Poora kaam EK Sequelize transaction me hota hai; `dryRun: true` par saare
 * calculations chal kar report ban jaati hai lekin end me ROLLBACK hota hai —
 * database ko koi haath nahi lagta.
 */
const db = require("../../../common/index.db");

// DECIMAL(15,3) columns ke saath float drift na ho, isliye har math 3 dp par.
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

// Bucket-group key: manufacturer NULL bhi ho sakta hai (MySQL GROUP BY NULLs
// ko ek group manta hai, JS map me bhi wahi behaviour chahiye).
const keyOf = (productId, warehouseId, manufacturerId) =>
  `${productId}|${warehouseId}|${manufacturerId || "NULL"}`;

/**
 * Ledger ka aggregated expected balance — raw MySQL (1-click reconciliation
 * query).
 *
 * Dual-UOM: math BASE quantity par hota hai — COALESCE(base_quantity, qty).
 * Legacy rows (base_quantity NULL) single-UOM era ki hain jahan quantity hi
 * base tha. ABS isliye: kuch purani rows OUTWARD ko negative number ke saath
 * store karti hain; sign yahan type se decide hota hai, number se nahi.
 * ADJUSTMENT as-signed jaata hai (wahi uska matlab hai).
 *
 * SCRAP/DISPATCH bhi deductions hain — processStockMovement inhe StockLevel
 * se MINUS karta hai, isliye ledger me bhi minus, warna reconcile scrapped
 * stock ko wapas "heal" kar deta.
 *
 * deletedAt IS NULL: soft-deleted (reverse-accounted) rows ledger math se
 * bahar — sirf ACTIVE rows hi truth hain.
 */
const LEDGER_AGGREGATE_SQL = `
  SELECT
    ProductId        AS productId,
    WarehouseId      AS warehouseId,
    manufacturer_id  AS manufacturerId,
    SUM(
      CASE
        WHEN type IN ('INWARD', 'RETURN')
          THEN ABS(COALESCE(base_quantity, quantity))
        WHEN type IN ('OUTWARD', 'DAMAGE', 'SCRAP', 'DISPATCH')
          THEN -ABS(COALESCE(base_quantity, quantity))
        WHEN type = 'ADJUSTMENT'
          THEN COALESCE(base_quantity, quantity)
        ELSE 0
      END
    ) AS expected_qty
  FROM inventory_transactions
  WHERE status = 'COMPLETED'
    AND deletedAt IS NULL
  GROUP BY ProductId, WarehouseId, manufacturer_id
`;

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun            true => sab calculate karo, kuch save mat karo (rollback)
 * @param {boolean} opts.syncProductTotal  true => Product.total_stock ko bhi SUM(StockLevel) par reset karo
 * @returns reconciliation report (changes, warnings, totals)
 */
async function reconcileStock({ dryRun = false, syncProductTotal = true } = {}) {
  const t = await db.sequelize.transaction();

  try {
    // --- STEP 1: Ledger se expected balances (truth) ---
    const [ledgerRows] = await db.sequelize.query(LEDGER_AGGREGATE_SQL, {
      transaction: t,
    });

    const expectedByKey = new Map();
    for (const row of ledgerRows) {
      expectedByKey.set(
        keyOf(row.productId, row.warehouseId, row.manufacturerId),
        {
          productId: row.productId,
          warehouseId: row.warehouseId,
          manufacturerId: row.manufacturerId || null,
          expected: round3(row.expected_qty),
        },
      );
    }

    // --- STEP 2: Saare live stock buckets, row-lock ke saath (koi parallel
    // movement beech me stock na badal de) ---
    const stockRows = await db.StockLevel.findAll({
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const bucketsByKey = new Map();
    for (const row of stockRows) {
      const k = keyOf(row.ProductId, row.WarehouseId, row.manufacturer_id);
      if (!bucketsByKey.has(k)) bucketsByKey.set(k, []);
      bucketsByKey.get(k).push(row);
    }

    const changes = [];
    const warnings = [];
    let unchanged = 0;

    // --- STEP 3: Har ledger key ke liye stock ko expected par RESET karo ---
    for (const [k, info] of expectedByKey) {
      let expected = info.expected;

      // Ledger hi negative nikla (OUTWARD > INWARD) — data problem hai;
      // stock 0 par reset hoga aur warning report me aayegi.
      if (expected < 0) {
        warnings.push(
          `Ledger negative hai (${expected}) for Product ${info.productId} / ` +
            `Warehouse ${info.warehouseId} / Manufacturer ${info.manufacturerId || "-"} ` +
            `— stock 0 par reset kiya gaya. Ledger entries check karein.`,
        );
        expected = 0;
      }

      const buckets = (bucketsByKey.get(k) || []).sort(
        (a, b) => Number(b.current_quantity) - Number(a.current_quantity),
      );
      const actual = round3(
        buckets.reduce((sum, r) => sum + Number(r.current_quantity), 0),
      );
      const delta = round3(expected - actual);

      if (delta === 0) {
        unchanged += 1;
        continue;
      }

      if (buckets.length === 0) {
        // Ledger me stock hai lekin StockLevel row hi nahi — nayi row banao.
        if (expected > 0) {
          await db.StockLevel.create(
            {
              ProductId: info.productId,
              WarehouseId: info.warehouseId,
              manufacturer_id: info.manufacturerId,
              color: "Standard",
              current_quantity: expected,
              last_updated_at: new Date(),
            },
            { transaction: t },
          );
        }
      } else if (delta > 0) {
        // Kam stock dikh raha hai — sabse bade bucket me add karo.
        const target = buckets[0];
        await target.update(
          {
            current_quantity: round3(Number(target.current_quantity) + delta),
            last_updated_at: new Date(),
          },
          { transaction: t },
        );
      } else {
        // Zyada stock dikh raha hai — fullest bucket se greedy drain (floor 0).
        let remaining = Math.abs(delta);
        for (const row of buckets) {
          if (remaining <= 0) break;
          const take = Math.min(Number(row.current_quantity), remaining);
          if (take <= 0) continue;
          await row.update(
            {
              current_quantity: round3(Number(row.current_quantity) - take),
              last_updated_at: new Date(),
            },
            { transaction: t },
          );
          remaining = round3(remaining - take);
        }
      }

      changes.push({
        productId: info.productId,
        warehouseId: info.warehouseId,
        manufacturerId: info.manufacturerId,
        old_quantity: actual,
        new_quantity: expected,
        delta,
      });
    }

    // --- STEP 4: Orphan buckets — StockLevel me qty hai lekin ledger me us
    // key ki EK BHI transaction nahi. Inward ke hisaab se reset ka matlab:
    // bina ledger backing ke stock = 0. ---
    for (const [k, buckets] of bucketsByKey) {
      if (expectedByKey.has(k)) continue;
      for (const row of buckets) {
        const qty = Number(row.current_quantity);
        if (qty === 0) continue;
        await row.update(
          { current_quantity: 0, last_updated_at: new Date() },
          { transaction: t },
        );
        changes.push({
          productId: row.ProductId,
          warehouseId: row.WarehouseId,
          manufacturerId: row.manufacturer_id,
          color: row.color,
          old_quantity: round3(qty),
          new_quantity: 0,
          delta: round3(-qty),
          reason: "Ledger me is bucket ki koi transaction nahi mili (orphan stock).",
        });
      }
    }

    // --- STEP 5: Product.total_stock ko StockLevel ke total par sync karo.
    // (Dispatch ledger isi counter se deduct karta hai; reconcile ke baad
    // dono counters ek hi base-UOM number par hone chahiye.) ---
    let productTotalsSynced = 0;
    if (syncProductTotal) {
      const [result] = await db.sequelize.query(
        `
        UPDATE inventory_products p
        LEFT JOIN (
          SELECT ProductId, SUM(current_quantity) AS total_qty
          FROM inventory_stock_levels
          GROUP BY ProductId
        ) s ON s.ProductId = p.id
        SET p.total_stock = COALESCE(s.total_qty, 0)
        WHERE p.deletedAt IS NULL
          AND p.total_stock <> COALESCE(s.total_qty, 0)
        `,
        { transaction: t },
      );
      productTotalsSynced = result?.affectedRows ?? 0;
    }

    // --- STEP 6: dryRun => rollback (sirf report), warna commit ---
    if (dryRun) {
      await t.rollback();
    } else {
      await t.commit();
    }

    return {
      dryRun,
      ledger_keys_checked: expectedByKey.size,
      buckets_changed: changes.length,
      buckets_unchanged: unchanged,
      product_totals_synced: productTotalsSynced,
      changes,
      warnings,
    };
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

module.exports = { reconcileStock, round3 };
