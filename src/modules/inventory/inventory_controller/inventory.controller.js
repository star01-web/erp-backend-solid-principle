const db = require("../../../common/index.db");
const { Op } = require("sequelize");
// Dual-UOM funnel — SAME conversion the dispatch ledger uses. quantity+uom
// (e.g. "2 Bundle") -> base_quantity (200 mtr); all stock math on base.
const uomService = require("../services/uom.service");
const { round3 } = uomService;

// 1. PRODUCT MANAGEMENT (Master Data)

const createProduct = async (req, res) => {
  try {
    const {
      sku_code,
      name,
      color, // Note: Color abhi bhi yahan request mein aa sakta hai agar future mein default color save karna ho, lekin model mein nahi hai.
      hsn_code,
      manufacturer_ids, // Array of Manufacturer IDs (Many-to-Many)
      category,
      unit,
      min_stock_level,
      max_stock_level,
    } = req.body;

    // 1. Basic Validation
    if (!sku_code || !name) {
      return res.status(400).json({
        success: false,
        message: "SKU Code aur Product Name mandatory hain.",
      });
    }

    const standardizedSKU = sku_code.trim().toUpperCase();
    const cleanName = name.trim();

    // 2. Strict Duplicate Checks
    const existingSku = await db.Product.findOne({
      where: { sku_code: standardizedSKU },
    });
    if (existingSku) {
      return res.status(400).json({
        success: false,
        message: `SKU '${standardizedSKU}' pehle se maujud hai (${
          existingSku.is_active ? "Active" : "Inactive"
        }).`,
      });
    }

    const duplicateProduct = await db.Product.findOne({
      where: { name: cleanName }, // Color check hata diya kyunki ab Color StockLevel par hai
    });

    if (duplicateProduct) {
      return res.status(400).json({
        success: false,
        message: "Yeh Product Name pehle se database mein hai.",
      });
    }

    // 3. Create Product
    const product = await db.Product.create({
      sku_code: standardizedSKU,
      name: cleanName,
      hsn_code: hsn_code ? hsn_code.trim() : null,
      category: category ? category.trim() : null,
      unit: unit || "pcs",
      min_stock_level: min_stock_level || 5,
      max_stock_level: max_stock_level || 1000,
      is_active: true,
    });

    // 4. Pivot Table mein Manufacturers Map Karein
    if (
      manufacturer_ids &&
      Array.isArray(manufacturer_ids) &&
      manufacturer_ids.length > 0
    ) {
      await product.setManufacturers(manufacturer_ids);
    }

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const bulkCreateProducts = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Products ka array required hai.",
      });
    }

    const createdProducts = [];
    const payloadSkus = new Set();

    for (const [index, item] of products.entries()) {
      const {
        sku_code,
        name,
        hsn_code,
        manufacturer_ids,
        category,
        unit,
        min_stock_level,
        max_stock_level,
      } = item;

      if (!sku_code || !name) {
        throw new Error(
          `Row ${index + 1}: SKU Code aur Product Name mandatory hain.`,
        );
      }

      const standardizedSKU = sku_code.trim().toUpperCase();
      const cleanName = name.trim();

      if (payloadSkus.has(standardizedSKU)) {
        throw new Error(
          `Row ${index + 1}: Duplicate SKU '${standardizedSKU}' aapki file mein ek se zyada baar hai.`,
        );
      }
      payloadSkus.add(standardizedSKU);

      const existingSku = await db.Product.findOne({
        where: { sku_code: standardizedSKU },
        transaction: t,
      });
      if (existingSku) {
        throw new Error(
          `Row ${index + 1}: SKU '${standardizedSKU}' database mein pehle se maujud hai.`,
        );
      }

      const duplicateProduct = await db.Product.findOne({
        where: { name: cleanName },
        transaction: t,
      });
      if (duplicateProduct) {
        throw new Error(
          `Row ${index + 1}: '${cleanName}' pehle se database mein hai.`,
        );
      }

      const product = await db.Product.create(
        {
          sku_code: standardizedSKU,
          name: cleanName,
          hsn_code: hsn_code ? hsn_code.trim() : null,
          category: category ? category.trim() : null,
          unit: unit || "pcs",
          min_stock_level: min_stock_level || 5,
          max_stock_level: max_stock_level || 1000,
          is_active: true,
        },
        { transaction: t },
      );

      if (
        manufacturer_ids &&
        Array.isArray(manufacturer_ids) &&
        manufacturer_ids.length > 0
      ) {
        await product.setManufacturers(manufacturer_ids, { transaction: t });
      }

      createdProducts.push(product);
    }

    await t.commit();
    return res.status(201).json({
      success: true,
      message: `${createdProducts.length} products successfully add ho gaye.`,
    });
  } catch (error) {
    if (t) await t.rollback();
    return res.status(400).json({ success: false, message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const { status } = req.query;
    let where = {};
    if (status === "active") where.is_active = true;
    if (status === "inactive") where.is_active = false;

    const products = await db.Product.findAll({
      where,
      include: [
        {
          model: db.Partner,
          as: "manufacturers",
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
      ],
    });
    return res
      .status(200)
      .json({ success: true, count: products.length, products });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { manufacturer_ids, ...updateData } = req.body;

    const product = await db.Product.findByPk(id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }

    if (updateData.is_active === false && product.is_active === true) {
      const totalStock = await db.StockLevel.sum("current_quantity", {
        where: { ProductId: id },
      });

      if (totalStock > 0) {
        return res.status(400).json({
          success: false,
          message: `Is product ka ${totalStock} unit stock abhi warehouses mein bacha hai. Ise Inactive nahi kiya ja sakta.`,
        });
      }
    }

    const stringFields = ["name", "category", "unit", "hsn_code"];
    stringFields.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    await product.update(updateData);

    if (manufacturer_ids && Array.isArray(manufacturer_ids)) {
      await product.setManufacturers(manufacturer_ids);
    }

    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. STOCK MOVEMENT (Transactions & Core Inventory)

/**
 * Frontend se aane wala `site_id` do jagah ka id ho sakta hai:
 *   1. `inventory_sites` (Site) ka id  — dispatch ledger/stock isi par anchor hai
 *   2. HRM `ProjectSite` (geofence) ka id — site creation par dono rows saath
 *      banti hain lekin IDs ALAG hote hain, aur UI aksar ProjectSite id bhejta hai.
 * Ye helper dono handle karta hai: pehle inventory Site pk se, warna ProjectSite
 * pk se locationName nikaal kar same naam ki inventory Site dhundta hai.
 * Return: inventory `Site` row ya null.
 */
const resolveInventorySite = async (site_id, t) => {
  let site = await db.Site.findByPk(site_id, { transaction: t });
  if (site) return site;

  const projSite = await db.ProjectSite.findByPk(site_id, {
    transaction: t,
  }).catch(() => null);
  if (projSite?.locationName) {
    site = await db.Site.findOne({
      where: { site_name: projSite.locationName },
      transaction: t,
    });
  }
  return site;
};

const processStockMovement = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const {
      date,
      productId,
      warehouseId,
      partner_id,
      manufacturer_id,
      color,
      quantity,
      uom, // OPTIONAL: entered unit — base_uom ya purchase_uom (missing => base)
      unit_price,
      type,
      batch_number,
      reference_no,
      vehicle_number,
      movement_date,
      remarks,
      site_id, // OPTIONAL: OUTWARD/DISPATCH ke saath aaye toh site ledger + site stock bhi sync hoga
    } = req.body;
    const userId = req.user.id;

    if (!productId || !warehouseId || quantity === undefined || !type) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields." });
    }

    const moveQty = Number(quantity);
    if (isNaN(moveQty)) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Quantity must be a number." });
    }

    const [product, warehouse] = await Promise.all([
      db.Product.findByPk(productId),
      db.Warehouse.findByPk(warehouseId),
    ]);

    if (!product?.is_active || !warehouse?.is_active) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Product ya Warehouse active nahi hai.",
      });
    }

    const moveType = type.toUpperCase();
    const absQty = Math.abs(moveQty);

    // --- DUAL-UOM CONVERSION (single funnel, same as dispatch ledger) ---
    // Entered quantity+uom -> base quantity. "2 Bundle" (factor 100) becomes
    // 200 mtr; "120 mtr" stays 120; missing uom => base UOM (factor 1,
    // backward compatible). SAARA stock math neeche base UOM me hota hai —
    // StockLevel.current_quantity strictly base UOM ka counter hai.
    let uomInfo;
    try {
      uomInfo = uomService.toBaseQuantity(product, absQty, uom);
    } catch (uomError) {
      await t.rollback();
      return res.status(uomError.statusCode || 400).json({
        success: false,
        message: uomError.message,
      });
    }
    const baseQty = uomInfo.baseQty; // positive magnitude, base UOM
    // ADJUSTMENT apna sign rakhta hai (signed delta), baaki types ka sign
    // `type` se aata hai.
    const signedBaseQty = moveQty < 0 ? -baseQty : baseQty;

    const isDeduction = ["OUTWARD", "SCRAP", "DISPATCH"].includes(moveType);
    const isAddition = ["INWARD", "RETURN"].includes(moveType);

    // Variant the StockTransaction log will record. For deductions it is refined
    // below to the ACTUAL source bucket the stock was taken from.
    let logManufacturerId = manufacturer_id || null;
    let logColor = color || "Standard";

    if (isDeduction) {
      // --- BUGFIX: find WHERE the stock actually is; never create an empty
      // bucket for an outward. Stock is keyed by (product, warehouse,
      // manufacturer_id, color). Earlier this used findOrCreate with
      // `manufacturer_id || null` / `color || "Standard"`, so an outward that
      // omitted the manufacturer/color looked at an EMPTY (null/Standard)
      // bucket, created it with qty 0, and falsely returned "Insufficient
      // stock" even though the product had stock under another variant.
      //
      // Fix: constrain manufacturer_id / color ONLY when the caller actually
      // supplied them, then deduct from the matching bucket(s). ---
      const variantWhere = { ProductId: productId, WarehouseId: warehouseId };
      if (manufacturer_id) variantWhere.manufacturer_id = manufacturer_id;
      if (color) variantWhere.color = color;

      const stockRows = await db.StockLevel.findAll({
        where: variantWhere,
        order: [["current_quantity", "DESC"]], // drain the fullest bucket first
        transaction: t,
        lock: t.LOCK.UPDATE, // SELECT … FOR UPDATE: no concurrent oversell
      });

      const totalAvailable = round3(
        stockRows.reduce((sum, r) => sum + Number(r.current_quantity), 0),
      );

      // Guard against negative stock — with the REAL available number so the
      // caller can see the stock exists (just under a different variant).
      // Comparison BASE UOM me hoti hai (entered "2 Bundle" => 200 base units
      // chahiye).
      if (totalAvailable < baseQty) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message:
            `Insufficient stock. Available: ${totalAvailable} ${product.base_uom || product.unit || ""}`.trim() +
            `, Requested: ${absQty} ${uomInfo.uom} (= ${baseQty} ${product.base_uom || product.unit || "base units"}).`,
        });
      }

      // Greedy deduction across the matched buckets (largest first), so a
      // quantity split over several manufacturer/color rows can still be filled.
      let remaining = baseQty;
      for (const row of stockRows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(row.current_quantity), remaining);
        await row.update(
          {
            current_quantity: round3(Number(row.current_quantity) - take),
            last_updated_at: new Date(),
          },
          { transaction: t },
        );
        remaining = round3(remaining - take);
      }

      // Reflect a real source bucket on the transaction log.
      logManufacturerId = manufacturer_id || stockRows[0].manufacturer_id;
      logColor = color || stockRows[0].color;
    } else if (isAddition || moveType === "ADJUSTMENT") {
      // Additions / adjustments: create-or-get the EXACT bucket, then apply.
      const [stockRecord] = await db.StockLevel.findOrCreate({
        where: {
          ProductId: productId,
          WarehouseId: warehouseId,
          manufacturer_id: manufacturer_id || null,
          color: color || "Standard",
        },
        defaults: { current_quantity: 0 },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const currentQty = Number(stockRecord.current_quantity);
      // INWARD/RETURN add the (base) qty; ADJUSTMENT applies the signed base delta.
      const newQuantity = round3(
        moveType === "ADJUSTMENT"
          ? currentQty + signedBaseQty
          : currentQty + baseQty,
      );

      if (newQuantity < 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Adjustment leads to negative stock.",
        });
      }

      await stockRecord.update(
        { current_quantity: newQuantity, last_updated_at: new Date() },
        { transaction: t },
      );
    } else {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid transaction type." });
    }

    const transactionLog = await db.StockTransaction.create(
      {
        date: date || new Date(),
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id,
        manufacturer_id: logManufacturerId,
        color: logColor,
        type: moveType,
        quantity: moveQty,
        // Dual-UOM audit trio: entered unit (normalized spelling), factor
        // frozen at transaction time, and the base amount stock math used.
        // ADJUSTMENT ka base signed save hota hai (wahi uska matlab hai).
        uom: uomInfo.uom,
        conversion_factor: uomInfo.factor,
        base_quantity:
          moveType === "ADJUSTMENT" ? signedBaseQty : baseQty,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
        vehicle_number,
        movement_date: movement_date || date || new Date(),
        remarks,
        created_by: userId,
      },
      { transaction: t },
    );

    // --- SITE SYNC (optional) ---
    // Agar OUTWARD/DISPATCH ke saath site_id aaya hai, toh usi transaction me:
    //   1. SiteDispatchLog me ek immutable DISPATCH ledger row likho, aur
    //   2. SiteStockLevel.inHandQty me quantity add karo (find-or-create).
    // Isse warehouse OUTWARD aur site-side stock hamesha ek saath move hote
    // hain — koi bhi step fail ho toh poora movement rollback ho jata hai.
    let siteDispatchLog = null;
    let siteStockLevel = null;
    if (site_id && isDeduction && moveType !== "SCRAP") {
      // site_id inventory Site ka bhi ho sakta hai aur HRM ProjectSite ka bhi —
      // resolver dono handle karta hai.
      const site = await resolveInventorySite(site_id, t);
      if (!site) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Site not found." });
      }

      // 1) Site dispatch ledger entry — entered qty/uom verbatim, plus the
      // converted base_quantity (site stock math is strictly base UOM).
      siteDispatchLog = await db.SiteDispatchLog.create(
        {
          site_id: site.id,
          item_id: productId,
          transaction_type: "DISPATCH",
          quantity: absQty,
          uom: uomInfo.uom,
          base_quantity: baseQty,
          transaction_date: movement_date || date || new Date(),
          remarks: remarks || null,
          created_by: userId,
        },
        { transaction: t },
      );

      // 2) Site stock level update — same variant bucket jisse stock nikla.
      const siteStockWhere = {
        siteId: site.id,
        ProductId: productId,
        manufacturer_id: logManufacturerId || null,
        color: logColor || "Standard",
      };
      const [siteStock, created] = await db.SiteStockLevel.findOrCreate({
        where: siteStockWhere,
        defaults: { inHandQty: baseQty },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!created) {
        await siteStock.update(
          { inHandQty: round3(Number(siteStock.inHandQty) + baseQty) },
          { transaction: t },
        );
      }
      siteStockLevel = siteStock;
    }

    await t.commit();
    return res.status(201).json({
      success: true,
      data: transactionLog,
      site_dispatch_log: siteDispatchLog,
      site_current_stock: siteStockLevel
        ? Number(siteStockLevel.inHandQty)
        : undefined,
    });
  } catch (error) {
    if (t) await t.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateStockMovement = async (req, res) => {
  const { id } = req.params;
  const { quantity: newQty, type: newType, remarks, vehicle_number } = req.body;
  const t = await db.sequelize.transaction();

  try {
    const oldTx = await db.StockTransaction.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!oldTx) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found." });
    }

    const stockRecord = await db.StockLevel.findOne({
      where: {
        ProductId: oldTx.ProductId,
        WarehouseId: oldTx.WarehouseId,
        manufacturer_id: oldTx.manufacturer_id,
        color: oldTx.color,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!stockRecord) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Corresponding Stock Level not found.",
      });
    }

    let currentQty = Number(stockRecord.current_quantity);

    // --- STEP 1: Undo the OLD row's effect, in BASE UOM. Legacy rows (no
    // base_quantity) were single-UOM era: quantity WAS base. ADJUSTMENT ka
    // base signed store hota hai, isliye woh as-is reverse hota hai.
    const oldBase =
      oldTx.base_quantity !== null && oldTx.base_quantity !== undefined
        ? Number(oldTx.base_quantity)
        : Number(oldTx.quantity);

    if (oldTx.type === "ADJUSTMENT") {
      currentQty = round3(currentQty - oldBase);
    } else if (["INWARD", "RETURN"].includes(oldTx.type)) {
      currentQty = round3(currentQty - Math.abs(oldBase));
    } else {
      currentQty = round3(currentQty + Math.abs(oldBase));
    }

    // --- STEP 2: Apply the NEW values. New qty is interpreted in the SAME
    // uom as the original row (frozen factor) — the endpoint doesn't accept a
    // uom change, so entered * frozen-factor keeps the ledger consistent.
    const finalType = (newType || oldTx.type).toUpperCase();
    const finalQty =
      newQty !== undefined ? Number(newQty) : Number(oldTx.quantity);
    const oldFactor = Number(oldTx.conversion_factor) || 1;
    const finalBase = round3(finalQty * oldFactor);
    const absFinalBase = Math.abs(finalBase);

    if (["INWARD", "RETURN"].includes(finalType)) {
      currentQty = round3(currentQty + absFinalBase);
    } else if (finalType === "ADJUSTMENT") {
      currentQty = round3(currentQty + finalBase);
    } else {
      if (currentQty < absFinalBase) {
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Insufficient stock for update." });
      }
      currentQty = round3(currentQty - absFinalBase);
    }

    if (currentQty < 0) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Update results in negative stock." });
    }

    await oldTx.update(
      {
        quantity: finalQty,
        base_quantity: finalType === "ADJUSTMENT" ? finalBase : absFinalBase,
        type: finalType,
        remarks: remarks || oldTx.remarks,
        vehicle_number:
          vehicle_number !== undefined ? vehicle_number : oldTx.vehicle_number,
        updated_by: req.user.id,
      },
      { transaction: t },
    );

    await stockRecord.update(
      {
        current_quantity: currentQty,
        last_updated_at: new Date(),
      },
      { transaction: t },
    );

    await t.commit();
    return res
      .status(200)
      .json({ success: true, message: "Stock updated successfully." });
  } catch (error) {
    if (t) await t.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /movement/:id — transaction delete with automatic REVERSE ACCOUNTING.
 *
 * Rule (sab kuch BASE UOM me, `COALESCE(base_quantity, quantity)` se):
 *   - OUTWARD / SCRAP / DISPATCH delete  -> base qty StockLevel me WAPAS ADD
 *   - INWARD / RETURN delete             -> base qty StockLevel se MINUS
 *     (agar minus se available < 0 hota ho -> 400, kuch bhi delete nahi hota)
 *   - ADJUSTMENT delete                  -> signed base delta reverse hota hai
 *
 * Row soft-delete hoti hai (paranoid: true -> deletedAt stamp), isliye audit
 * trail hamesha preserved hai aur reconcile ka `deletedAt IS NULL` filter ise
 * ledger math se bahar kar deta hai. Saara kaam EK sequelize.transaction me,
 * row-level UPDATE locks ke saath — koi bhi step fail ho toh poora rollback.
 */
const deleteStockMovement = async (req, res) => {
  const { id } = req.params;
  const t = await db.sequelize.transaction();

  try {
    const tx = await db.StockTransaction.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!tx) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found." });
    }

    const product = await db.Product.findByPk(tx.ProductId, {
      transaction: t,
      paranoid: false, // deleted product ki row bhi reverse ho sakti hai
    });
    const baseUom = product?.base_uom || product?.unit || "base units";

    // Base amount this row moved. Legacy rows (base_quantity NULL) single-UOM
    // era ki hain — quantity hi base tha (kuch OUTWARD negative sign ke saath).
    const rawBase =
      tx.base_quantity !== null && tx.base_quantity !== undefined
        ? Number(tx.base_quantity)
        : Number(tx.quantity);

    // Reverse delta on StockLevel:
    //   deduction types ne stock GHATAYA tha -> delete par ADD (+abs)
    //   addition types ne stock BADHAYA tha  -> delete par MINUS (-abs)
    //   ADJUSTMENT signed tha               -> delete par -signed
    const isDeduction = ["OUTWARD", "SCRAP", "DISPATCH"].includes(tx.type);
    const reverseDelta =
      tx.type === "ADJUSTMENT"
        ? -rawBase
        : isDeduction
          ? Math.abs(rawBase)
          : -Math.abs(rawBase);

    // Variant buckets of this (product, warehouse, manufacturer) — same
    // matching rule the create-side uses. Row-lock so parallel movements
    // can't race the reversal.
    const variantWhere = {
      ProductId: tx.ProductId,
      WarehouseId: tx.WarehouseId,
    };
    if (tx.manufacturer_id) variantWhere.manufacturer_id = tx.manufacturer_id;

    const stockRows = await db.StockLevel.findAll({
      where: variantWhere,
      order: [["current_quantity", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (reverseDelta >= 0) {
      // ADD back (deleting an OUTWARD/SCRAP/DISPATCH or negative ADJUSTMENT).
      if (stockRows.length > 0) {
        const target = stockRows[0]; // largest bucket
        await target.update(
          {
            current_quantity: round3(
              Number(target.current_quantity) + reverseDelta,
            ),
            last_updated_at: new Date(),
          },
          { transaction: t },
        );
      } else {
        // Bucket hi nahi bacha — recreate so the stock isn't lost.
        await db.StockLevel.create(
          {
            ProductId: tx.ProductId,
            WarehouseId: tx.WarehouseId,
            manufacturer_id: tx.manufacturer_id || null,
            color: "Standard",
            current_quantity: reverseDelta,
            last_updated_at: new Date(),
          },
          { transaction: t },
        );
      }
    } else {
      // SUBTRACT (deleting an INWARD/RETURN or positive ADJUSTMENT) — strict
      // negative-stock guard FIRST, then greedy drain (fullest bucket first).
      const needed = Math.abs(reverseDelta);
      const totalAvailable = round3(
        stockRows.reduce((sum, r) => sum + Number(r.current_quantity), 0),
      );

      if (totalAvailable < needed) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message:
            `Cannot delete this ${tx.type} transaction: reversing it would drive stock negative. ` +
            `Available: ${totalAvailable} ${baseUom}, needs to remove: ${needed} ${baseUom}. ` +
            `Stock pehle hi consume/outward ho chuka hai — pehle un movements ko handle karein.`,
        });
      }

      let remaining = needed;
      for (const row of stockRows) {
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

    // Soft delete — paranoid model sirf deletedAt stamp karta hai; row audit
    // ke liye table me hi rehti hai aur reconcile use ignore karta hai.
    await tx.destroy({ transaction: t });

    await t.commit();

    // Heads-up: /movement ke site-synced OUTWARDs ne SiteDispatchLog +
    // SiteStockLevel bhi likha tha; un tables me StockTransaction ka back-link
    // nahi hai, isliye site-side reversal manually (ya site-return se) hota hai.
    const siteSyncWarning =
      isDeduction && tx.type !== "SCRAP"
        ? "Note: agar ye movement kisi site ko sync hua tha, toh site-side stock (SiteStockLevel) alag se adjust karna hoga."
        : undefined;

    return res.status(200).json({
      success: true,
      message: `Transaction deleted. Stock reverse-adjusted by ${reverseDelta > 0 ? "+" : ""}${reverseDelta} ${baseUom}.`,
      data: {
        deleted_transaction_id: tx.id,
        type: tx.type,
        reversed_base_quantity: reverseDelta,
        base_uom: baseUom,
        ...(siteSyncWarning ? { warning: siteSyncWarning } : {}),
      },
    });
  } catch (error) {
    await t.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

const bulkProcessStockMovement = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { movements } = req.body;

    if (!Array.isArray(movements) || movements.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid data format." });
    }

    const processedTransactions = [];

    for (const item of movements) {
      const {
        date,
        productId,
        warehouseId,
        quantity,
        uom, // OPTIONAL: entered unit — base_uom ya purchase_uom (missing => base)
        type,
        batch_number,
        reference_no,
        vehicle_number,
        movement_date,
        partner_id,
        manufacturer_id,
        color,
        unit_price,
        remarks,
        site_id, // OPTIONAL: OUTWARD/DISPATCH ke saath aaye toh site ledger + site stock bhi sync hoga
      } = item;

      if (!productId || !warehouseId || !quantity || !type) {
        throw new Error(`Invalid data for product ${productId}`);
      }

      const movementType = type.toUpperCase();
      const moveQty = Number(quantity);
      const absQty = Math.abs(moveQty);

      // --- DUAL-UOM CONVERSION (same funnel as single /movement) ---
      // Product row chahiye conversion ke liye; missing/invalid uom par
      // toBaseQuantity khud descriptive error throw karta hai (poora bulk
      // rollback hota hai — all-or-nothing).
      const product = await db.Product.findByPk(productId, { transaction: t });
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      const uomInfo = uomService.toBaseQuantity(product, absQty, uom);
      const baseQty = uomInfo.baseQty;
      const signedBaseQty = moveQty < 0 ? -baseQty : baseQty;

      // --- SMART WHERE CLAUSE BUILDER ---
      // Agar UI se color/manufacturer aayega tabhi match karega, warna sirf Product aur Warehouse dekhega
      const whereCondition = {
        ProductId: productId,
        WarehouseId: warehouseId,
      };

      if (manufacturer_id !== undefined && manufacturer_id !== null) {
        whereCondition.manufacturer_id = manufacturer_id;
      }
      if (color !== undefined && color !== "") {
        whereCondition.color = color;
      }

      let stockRecord = await db.StockLevel.findOne({
        where: whereCondition,
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      const isInwardType = ["INWARD", "RETURN", "ADJUSTMENT"].includes(movementType);

      // --- LOGIC FOR OUTWARD / DISPATCH ---
      if (!isInwardType) {
        // Agar Outward me stock mila hi nahi, toh turant error do (Faltu row create mat karo)
        if (!stockRecord) {
          throw new Error(`Stock not found in selected warehouse for Product ID: ${productId}`);
        }

        let currentQty = Number(stockRecord.current_quantity || 0);

        // Comparison/deduction BASE UOM me — "2 Bundle" => 200 base units.
        if (currentQty < baseQty) {
          throw new Error(
            `Insufficient stock! Available: ${currentQty} ${product.base_uom || ""}`.trim() +
              `, Requested: ${absQty} ${uomInfo.uom} (= ${baseQty}) (Product ID: ${productId})`,
          );
        }

        currentQty = round3(currentQty - baseQty);
        await stockRecord.update({ current_quantity: currentQty }, { transaction: t });
      }

      // --- LOGIC FOR INWARD / RETURN ---
      else {
        // ADJUSTMENT signed base delta apply karta hai; INWARD/RETURN positive add.
        const delta = movementType === "ADJUSTMENT" ? signedBaseQty : baseQty;
        if (!stockRecord) {
          if (delta < 0) {
            throw new Error(
              `Adjustment leads to negative stock (no existing stock) for Product ID: ${productId}`,
            );
          }
          // Inward hai aur record nahi hai, tab nayi row create karna banta hai
          stockRecord = await db.StockLevel.create(
            {
              ProductId: productId,
              WarehouseId: warehouseId,
              manufacturer_id: manufacturer_id || null,
              color: color || "Standard",
              current_quantity: delta,
            },
            { transaction: t }
          );
        } else {
          const currentQty = round3(
            Number(stockRecord.current_quantity || 0) + delta,
          );
          if (currentQty < 0) {
            throw new Error(
              `Adjustment leads to negative stock for Product ID: ${productId}`,
            );
          }
          await stockRecord.update({ current_quantity: currentQty }, { transaction: t });
        }
      }

      // --- SITE SYNC (optional, same pattern as processStockMovement) ---
      // Agar OUTWARD/DISPATCH item ke saath site_id aaya hai, toh usi bulk
      // transaction me site dispatch ledger + site stock level bhi update karo.
      if (site_id && !isInwardType && movementType !== "SCRAP") {
        // site_id inventory Site ka bhi ho sakta hai aur HRM ProjectSite ka
        // bhi — resolver dono handle karta hai.
        const site = await resolveInventorySite(site_id, t);
        if (!site) {
          throw new Error(`Site not found for site_id: ${site_id}`);
        }

        // 1) Immutable DISPATCH ledger row — entered qty/uom verbatim plus
        // converted base_quantity (site stock math strictly base UOM me hai).
        await db.SiteDispatchLog.create(
          {
            site_id: site.id,
            item_id: productId,
            transaction_type: "DISPATCH",
            quantity: absQty,
            uom: uomInfo.uom,
            base_quantity: baseQty,
            transaction_date: movement_date || date || new Date(),
            remarks: remarks || null,
            created_by: req.user.id,
          },
          { transaction: t },
        );

        // 2) Site stock level — same variant bucket jisse warehouse stock nikla.
        const siteStockWhere = {
          siteId: site.id,
          ProductId: productId,
          manufacturer_id:
            manufacturer_id || stockRecord.manufacturer_id || null,
          color: color || stockRecord.color || "Standard",
        };
        const [siteStock, created] = await db.SiteStockLevel.findOrCreate({
          where: siteStockWhere,
          defaults: { inHandQty: baseQty },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!created) {
          await siteStock.update(
            { inHandQty: round3(Number(siteStock.inHandQty) + baseQty) },
            { transaction: t },
          );
        }
      }

      processedTransactions.push({
        date: date || new Date(),
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id: partner_id || null,
        manufacturer_id: manufacturer_id || null,
        color: color || "Standard",
        type: movementType,
        quantity: moveQty,
        // Dual-UOM audit trio (see processStockMovement).
        uom: uomInfo.uom,
        conversion_factor: uomInfo.factor,
        base_quantity:
          movementType === "ADJUSTMENT" ? signedBaseQty : baseQty,
        unit_price: unit_price || 0,
        batch_number: batch_number || null,
        reference_no: reference_no || null,
        vehicle_number: vehicle_number || null,
        movement_date: movement_date || date || new Date(),
        created_by: req.user.id,
      });
    }

    await db.StockTransaction.bulkCreate(processedTransactions, {
      transaction: t,
    });
    
    await t.commit();
    return res
      .status(201)
      .json({ success: true, message: "Bulk stock updated successfully." });
  } catch (error) {
    await t.rollback();
    console.error("Bulk Stock Movement Error:", error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
};

//  3. DASHBOARDS & REPORTING

const getInventoryDashboard = async (req, res) => {
  try {
    const stockStatus = await db.StockLevel.findAll({
      include: [
        {
          model: db.Product,
          attributes: [
            "name",
            "sku_code",
            "unit",
            "min_stock_level",
            "base_uom",
            "purchase_uom",
            "conversion_factor",
          ],
        },
        { model: db.Warehouse, attributes: ["name"] },
      ],
    });

    const lowStock = stockStatus.filter(
      (s) =>
        Number(s.current_quantity) <= Number(s.Product?.min_stock_level || 0),
    );

    // Dual-UOM display per bucket: "4 Bundle & 45 mtr (445 mtr Total)".
    const data = stockStatus.map((s) => {
      const row = s.toJSON();
      row.display_stock = uomService.formatDualStock(
        Number(s.current_quantity),
        s.Product,
      );
      return row;
    });

    return res.status(200).json({
      success: true,
      data,
      alerts: lowStock,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Available Stock (Product-wise total): har product ek hi baar, uska total stock
// sabhi warehouses / manufacturers / colors ka jodh kar. Dashboard per-bucket
// deta hai (product baar-baar aata hai); yeh usko product ke hisaab se aggregate
// karke single row deta hai.
const getAvailableStock = async (req, res) => {
  try {
    // includeZero=true dene par jinke total 0 hai woh bhi aayenge; default only >0.
    const includeZero = req.query.includeZero === "true";

    // Fetch all StockLevel rows WITH related Product, Warehouse, and
    // Manufacturer (Partner via manufacturer_id). We aggregate per Product in
    // JS so that we can also collect the distinct Warehouse names (godowns)
    // and Manufacturer names (brands) for each product as comma-separated
    // lists — the frontend needs these for the Godown and Brand columns.
    const rows = await db.StockLevel.findAll({
      attributes: [
        "id",
        "ProductId",
        "WarehouseId",
        "manufacturer_id",
        "color",
        "current_quantity",
        "reserved_quantity",
      ],
      include: [
        {
          model: db.Product,
          attributes: [
            "name",
            "sku_code",
            "unit",
            "min_stock_level",
            "base_uom",
            "purchase_uom",
            "conversion_factor",
          ],
        },
        {
          model: db.Warehouse,
          attributes: ["name"],
        },
      ],
      order: [[db.sequelize.col("Product.name"), "ASC"]],
    });

    // --- Build a lookup map: manufacturer_id -> Partner.name ---
    // Collect all unique non-null manufacturer_ids from the StockLevel rows,
    // then batch-fetch their names from the Partner table.
    const mfrIds = [
      ...new Set(
        rows
          .map((r) => r.manufacturer_id)
          .filter((id) => id != null),
      ),
    ];
    const mfrMap = new Map();
    if (mfrIds.length > 0) {
      const partners = await db.Partner.findAll({
        where: { id: { [Op.in]: mfrIds } },
        attributes: ["id", "name"],
      });
      for (const p of partners) mfrMap.set(p.id, p.name);
    }

    // --- Aggregate per Product (key = ProductId + name + sku_code) ---
    const productMap = new Map();

    for (const r of rows) {
      const pid = r.ProductId;
      const pName = r.Product?.name || "";
      const pSku = r.Product?.sku_code || "";
      const key = `${pid}|${pName}|${pSku}`;
      if (!productMap.has(key)) {
        productMap.set(key, {
          productId: pid,
          name: r.Product?.name || null,
          sku_code: r.Product?.sku_code || null,
          unit: r.Product?.unit || null,
          base_uom: r.Product?.base_uom || null,
          purchase_uom: r.Product?.purchase_uom || null,
          conversion_factor: Number(r.Product?.conversion_factor) || 1,
          min_stock_level: Number(r.Product?.min_stock_level || 0),
          _product: r.Product, // keep reference for formatDualStock
          _total: 0,
          _reserved: 0,
          _warehouses: new Set(),
          _manufacturers: new Set(),
          _colors: new Set(),
        });
      }

      const agg = productMap.get(key);
      agg._total += Number(r.current_quantity) || 0;
      agg._reserved += Number(r.reserved_quantity) || 0;

      // Collect distinct warehouse names
      if (r.Warehouse?.name) agg._warehouses.add(r.Warehouse.name);

      // Collect distinct manufacturer/brand names
      if (r.manufacturer_id && mfrMap.has(r.manufacturer_id)) {
        agg._manufacturers.add(mfrMap.get(r.manufacturer_id));
      }

      // Collect distinct colors
      if (r.color && r.color !== "Standard") agg._colors.add(r.color);
    }

    // --- Build final response array ---
    const data = [];
    for (const agg of productMap.values()) {
      const total = round3(agg._total);
      const reserved = round3(agg._reserved);

      if (!includeZero && total <= 0) continue;

      data.push({
        productId: agg.productId,
        name: agg.name,
        sku_code: agg.sku_code,
        unit: agg.unit,
        base_uom: agg.base_uom,
        purchase_uom: agg.purchase_uom,
        conversion_factor: agg.conversion_factor,
        total_quantity: total,
        reserved_quantity: reserved,
        available_quantity: round3(total - reserved),
        // UI-ready dual-UOM string: "4 Bundle & 45 mtr (445 mtr Total)".
        display_stock: uomService.formatDualStock(total, agg._product),
        min_stock_level: agg.min_stock_level,
        is_low_stock: total <= agg.min_stock_level,
        // Comma-separated warehouse/godown names for this product
        godown_names: agg._warehouses.size > 0
          ? [...agg._warehouses].sort().join(", ")
          : null,
        // Comma-separated manufacturer/brand names for this product
        brand_names: agg._manufacturers.size > 0
          ? [...agg._manufacturers].sort().join(", ")
          : null,
        // Comma-separated variant colors (excluding 'Standard')
        colors: agg._colors.size > 0
          ? [...agg._colors].sort().join(", ")
          : "Standard",
      });
    }

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getTransactionHistory = async (req, res) => {
  try {
    const {
      productId,
      warehouseId,
      type,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const offset = (page - 1) * limit;
    const whereClause = {};

    if (productId) whereClause.ProductId = productId;
    if (warehouseId) whereClause.WarehouseId = warehouseId;
    if (type) whereClause.type = type;
    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date[Op.gte] = new Date(startDate);
      if (endDate) whereClause.date[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await db.StockTransaction.findAndCountAll({
      where: whereClause,
      include: [
        { model: db.Product, attributes: ["name", "sku_code"] },
        { model: db.Warehouse, attributes: ["name"] },
        { model: db.Partner, as: "partner", attributes: ["id", "name"] },
        {
          model: db.Partner,
          as: "originManufacturer",
          attributes: ["id", "name"],
        },
      ],
      order: [
        ["createdAt", "DESC"],
        ["date", "DESC"],
        ["id", "DESC"],
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      success: true,
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// EXPORTS

module.exports = {
  // Product Management
  createProduct,
  bulkCreateProducts,
  getAllProducts,
  updateProduct,

  // Stock Movement
  processStockMovement,
  updateStockMovement,
  deleteStockMovement,
  bulkProcessStockMovement,

  // Reports
  getInventoryDashboard,
  getAvailableStock,
  getTransactionHistory,

  // Helpers (siteReturn.controller bhi same site-id resolution use karta hai)
  resolveInventorySite,
};
