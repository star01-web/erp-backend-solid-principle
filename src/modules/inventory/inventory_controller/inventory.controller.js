const db = require("../../../common/index.db");
const { Op } = require("sequelize");

/**
 * 1. PROCESS NEW STOCK MOVEMENT
 * Use cases: Inward, Outward, Return, Scrap, Adjustment
 */
const processStockMovement = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const {
      date,
      productId,
      warehouseId,
      partner_id,
      quantity,
      unit_price,
      type,
      batch_number,
      reference_no,
      remarks,
    } = req.body;
    const userId = req.user.id;

    // Validation
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

    // Product & Warehouse check
    const [product, warehouse] = await Promise.all([
      db.Product.findByPk(productId),
      db.Warehouse.findByPk(warehouseId),
    ]);

    if (!product?.is_active || !warehouse?.is_active) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Product/Warehouse inactive." });
    }

    // Atomic Stock Update with Row Locking
    const [stockRecord] = await db.StockLevel.findOrCreate({
      where: { ProductId: productId, WarehouseId: warehouseId },
      defaults: { current_quantity: 0 },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let currentQty = Number(stockRecord.current_quantity);
    let newQuantity;
    const absQty = Math.abs(moveQty);

    // Business Logic based on type
    switch (type.toUpperCase()) {
      case "INWARD":
      case "RETURN":
        newQuantity = currentQty + absQty;
        break;
      case "OUTWARD":
      case "SCRAP":
      case "DISPATCH":
        if (currentQty < absQty) {
          await t.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Insufficient stock." });
        }
        newQuantity = currentQty - absQty;
        break;
      case "ADJUSTMENT":
        newQuantity = currentQty + moveQty; // Can be + or -
        if (newQuantity < 0) {
          await t.rollback();
          return res
            .status(400)
            .json({
              success: false,
              message: "Adjustment leads to negative stock.",
            });
        }
        break;
      default:
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Invalid transaction type." });
    }

    // Create Log and Update Level
    const transactionLog = await db.StockTransaction.create(
      {
        date: date || new Date(),
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id,
        type: type.toUpperCase(),
        quantity: moveQty,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
        remarks,
        created_by: userId,
      },
      { transaction: t },
    );

    await stockRecord.update(
      {
        current_quantity: newQuantity,
        last_updated_at: new Date(),
      },
      { transaction: t },
    );

    await t.commit();
    return res.status(201).json({ success: true, data: transactionLog });
  } catch (error) {
    if (t) await t.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. UPDATE EXISTING STOCK MOVEMENT (Reversal Logic)
 * Purani entry ka asar khatam karke naya asar apply karta hai.
 */
const updateStockMovement = async (req, res) => {
  const { id } = req.params;
  const { quantity: newQty, type: newType, remarks } = req.body;
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
      where: { ProductId: oldTx.ProductId, WarehouseId: oldTx.WarehouseId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let currentQty = Number(stockRecord.current_quantity);

    // Step A: Reverse old impact
    if (["INWARD", "RETURN", "ADJUSTMENT"].includes(oldTx.type)) {
      currentQty -= Number(oldTx.quantity);
    } else {
      currentQty += Number(oldTx.quantity);
    }

    // Step B: Apply new impact
    const finalType = (newType || oldTx.type).toUpperCase();
    const finalQty =
      newQty !== undefined ? Number(newQty) : Number(oldTx.quantity);

    if (["INWARD", "RETURN", "ADJUSTMENT"].includes(finalType)) {
      currentQty += finalQty;
    } else {
      if (currentQty < Math.abs(finalQty)) {
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Insufficient stock for update." });
      }
      currentQty -= Math.abs(finalQty);
    }

    if (currentQty < 0) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Update results in negative stock." });
    }

    // Final Updates
    await oldTx.update(
      {
        quantity: finalQty,
        type: finalType,
        remarks: remarks || oldTx.remarks,
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
 * 3. GET INVENTORY DASHBOARD
 */
const getInventoryDashboard = async (req, res) => {
  try {
    const stockStatus = await db.StockLevel.findAll({
      include: [
        {
          model: db.Product,
          attributes: ["name", "sku_code", "unit", "min_stock_level"],
        },
        { model: db.Warehouse, attributes: ["name"] },
      ],
    });

    const lowStock = stockStatus.filter(
      (s) =>
        Number(s.current_quantity) <= Number(s.Product?.min_stock_level || 0),
    );

    return res.status(200).json({
      success: true,
      data: stockStatus,
      alerts: lowStock,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  processStockMovement,
  updateStockMovement,
  getInventoryDashboard,
};
