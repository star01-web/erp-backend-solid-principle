const db = require("../../../common/index.db");

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

    // Variant identity — StockLevel/SiteStockLevel ki unique key ka hissa,
    // isliye dono jagah bilkul same values use hongi
    const variantManufacturerId = manufacturer_id || null;
    const variantColor = color || "Standard";

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

    // Site aur Warehouse dono active hone chahiye
    const [site, warehouse] = await Promise.all([
      db.Site.findByPk(siteId),
      db.Warehouse.findByPk(WarehouseId),
    ]);
    if (!site?.is_active || !warehouse?.is_active) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Site ya Warehouse active nahi hai.",
      });
    }

    // --- STEP 1: Validate site stock for the EXACT variant (locked so a
    // parallel return can't read the same balance and double-spend it) ---
    const siteStock = await db.SiteStockLevel.findOne({
      where: {
        siteId,
        ProductId,
        manufacturer_id: variantManufacturerId,
        color: variantColor,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!siteStock || Number(siteStock.inHandQty) < qty) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient site stock for this variant (color: ${variantColor}). Available: ${
          siteStock ? siteStock.inHandQty : 0
        }, Requested: ${qty}.`,
      });
    }

    // --- STEP 2: Log the return event (variant captured for audit) ---
    const materialReturn = await db.SiteMaterialReturn.create(
      {
        siteId,
        ProductId,
        WarehouseId,
        manufacturer_id: variantManufacturerId,
        color: variantColor,
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
        manufacturer_id: variantManufacturerId,
        color: variantColor,
        type: "RETURN",
        quantity: qty,
        reference_no: "SITE_RETURN-" + materialReturn.id,
        remarks: remarks || null,
        created_by: userId,
      },
      { transaction: t },
    );

    // --- STEP 4: Deduct from the site ledger (atomic SQL decrement) ---
    await siteStock.decrement("inHandQty", { by: qty, transaction: t });

    // --- STEP 5: Add to main warehouse stock for the SAME variant, so the
    // material lands back in the exact (Product, Manufacturer, Color) bucket
    // it was issued from ---
    const [stockRecord] = await db.StockLevel.findOrCreate({
      where: {
        ProductId,
        WarehouseId,
        manufacturer_id: variantManufacturerId,
        color: variantColor,
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
