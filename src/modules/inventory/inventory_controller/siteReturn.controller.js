const db = require("../../../common/index.db");
const { resolveInventorySite } = require("./inventory.controller");

/**
 * POST /site-return
 * Returns unused/scrap material from a Project Site back to a Warehouse.
 *
 * All writes run inside a single Sequelize transaction so that the site
 * ledger, the warehouse ledger, and the audit log can never diverge.
 * Both stock rows are read with a row-level UPDATE lock (same pattern as
 * processStockMovement) so concurrent returns cannot drive stock negative.
 */
const returnMaterialFromSite = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const {
      siteId,
      ProductId,
      WarehouseId,
      manufacturer_id,
      color,
      returnQty,
      returnDate,
      condition, // 'Good' | 'Damaged' | 'Scrap'
      remarks,
    } = req.body;
    const userId = req.user.id;

    // Variant identity — StockLevel/SiteStockLevel ki unique key ka hissa.
    // NOTE: yahan sirf normalise karte hain; lookup me constraint TABHI lagti
    // hai jab caller ne value bheji ho (warna "Blue" stock par "Standard"
    // bucket dhundh kar jhootha Insufficient-stock error aata hai — wahi bug
    // jo processStockMovement ke OUTWARD me fix hua tha).
    const variantManufacturerId = manufacturer_id || null;
    const variantColor = color || null;

    // --- Input validation (fail fast, before touching any rows) ---
    if (!siteId || !ProductId || !WarehouseId || returnQty === undefined) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "siteId, ProductId, WarehouseId aur returnQty required hain.",
      });
    }

    const qty = Number(returnQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "returnQty ek positive number hona chahiye.",
      });
    }

    const ALLOWED_CONDITIONS = ["Good", "Damaged", "Scrap"];
    if (condition && !ALLOWED_CONDITIONS.includes(condition)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `condition '${ALLOWED_CONDITIONS.join("' | '")}' mein se ek honi chahiye.`,
      });
    }

    // Site aur Warehouse dono active hone chahiye.
    // siteId inventory Site ka bhi ho sakta hai aur HRM ProjectSite (geofence)
    // ka bhi — UI aksar ProjectSite id bhejta hai. Resolver dono handle karta
    // hai; aage ke saare lookups RESOLVED inventory-site id par chalte hain
    // (SiteStockLevel rows usi id par bante hain).
    const [site, warehouse] = await Promise.all([
      resolveInventorySite(siteId, t),
      db.Warehouse.findByPk(WarehouseId),
    ]);
    if (!site?.is_active || !warehouse?.is_active) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Site ya Warehouse active nahi hai.",
      });
    }
    const inventorySiteId = site.id;

    // --- STEP 1: Validate site stock (locked so a parallel return can't read
    // the same balance and double-spend it). Variant constraints sirf tab
    // lagti hain jab caller ne bheji hon — warna site par jo bhi variant
    // bucket(s) hain unhi se milaan hota hai. ---
    const siteStockWhere = { siteId: inventorySiteId, ProductId };
    if (variantManufacturerId) {
      siteStockWhere.manufacturer_id = variantManufacturerId;
    }
    if (variantColor) siteStockWhere.color = variantColor;

    const siteStockRows = await db.SiteStockLevel.findAll({
      where: siteStockWhere,
      order: [["inHandQty", "DESC"]], // fullest bucket first (greedy drain)
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const totalAtSite = siteStockRows.reduce(
      (sum, r) => sum + Number(r.inHandQty),
      0,
    );

    if (totalAtSite < qty) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient site stock${
          variantColor ? ` for this variant (color: ${variantColor})` : ""
        }. Available: ${totalAtSite}, Requested: ${qty}.`,
      });
    }

    // Audit/ledger rows me REAL source bucket ki variant identity jaaye —
    // caller ne di ho toh wahi, warna jis bucket se sabse pehle kata us ki.
    const primaryBucket = siteStockRows[0];
    const logManufacturerId =
      variantManufacturerId || primaryBucket.manufacturer_id || null;
    const logColor = variantColor || primaryBucket.color || "Standard";

    // --- STEP 2: Log the return event (variant captured for audit) ---
    const materialReturn = await db.SiteMaterialReturn.create(
      {
        siteId: inventorySiteId,
        ProductId,
        WarehouseId,
        manufacturer_id: logManufacturerId,
        color: logColor,
        returnQty: qty,
        returnDate: returnDate || new Date(),
        condition: condition || "Good",
        remarks: remarks || null,
        created_by: userId,
      },
      { transaction: t },
    );

    // --- STEP 3: Audit-log the movement in the central transaction table.
    // type 'RETURN' (not 'INWARD'): StockTransaction ka partnerRequired
    // validator INWARD ke liye partner_id mandatory karta hai, aur site
    // koi Partner nahi hai. reference_no se SiteMaterialReturn link hota hai.
    await db.StockTransaction.create(
      {
        date: materialReturn.returnDate,
        ProductId,
        WarehouseId,
        manufacturer_id: logManufacturerId,
        color: logColor,
        type: "RETURN",
        quantity: qty,
        reference_no: "SITE_RETURN-" + materialReturn.id,
        remarks: remarks || null,
        created_by: userId,
      },
      { transaction: t },
    );

    // --- STEP 3b: Site dispatch ledger me bhi RETURN row — taaki site ki net
    // consumption report (DISPATCH - RETURN) is return ko bhi gine. ---
    const productRow = await db.Product.findByPk(ProductId, { transaction: t });
    await db.SiteDispatchLog.create(
      {
        site_id: inventorySiteId,
        item_id: ProductId,
        transaction_type: "RETURN",
        quantity: qty,
        uom: productRow?.base_uom || productRow?.unit || "pcs",
        base_quantity: qty,
        transaction_date: materialReturn.returnDate,
        remarks: remarks || null,
        created_by: userId,
      },
      { transaction: t },
    );

    // --- STEP 4: Deduct from the site ledger — greedy drain across the
    // matched bucket(s), fullest first (same pattern as OUTWARD deduction) ---
    let remaining = qty;
    for (const row of siteStockRows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.inHandQty), remaining);
      if (take <= 0) continue;
      await row.decrement("inHandQty", { by: take, transaction: t });
      remaining -= take;
    }

    // --- STEP 5: Add to main warehouse stock for the SAME variant, so the
    // material lands back in the exact (Product, Manufacturer, Color) bucket
    // it was issued from ---
    const [stockRecord] = await db.StockLevel.findOrCreate({
      where: {
        ProductId,
        WarehouseId,
        manufacturer_id: logManufacturerId,
        color: logColor,
      },
      defaults: { current_quantity: 0 },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    await stockRecord.increment("current_quantity", {
      by: qty,
      transaction: t,
    });
    await stockRecord.update(
      { last_updated_at: new Date() },
      { transaction: t },
    );

    // --- STEP 6: All writes succeeded together ---
    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Material return processed successfully.",
      data: materialReturn,
    });
  } catch (error) {
    await t.rollback();
    return res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { returnMaterialFromSite };
