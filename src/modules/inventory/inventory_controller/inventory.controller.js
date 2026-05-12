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
      manufacturer_id, // ✅ IMPROVEMENT: Added manufacturer_id for tracking
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
      return res.status(400).json({
        success: false,
        message: "Product ya Warehouse active nahi hai.",
      });
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
          return res.status(400).json({
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
        manufacturer_id, // ✅ IMPROVEMENT: Saves manufacturer info
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

    // Update Stock Level
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
    const absFinalQty = Math.abs(finalQty);

    if (["INWARD", "RETURN", "ADJUSTMENT"].includes(finalType)) {
      currentQty += finalQty;
    } else {
      if (currentQty < absFinalQty) {
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Insufficient stock for update." });
      }
      currentQty -= absFinalQty;
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

/**
 * 4. BULK PROCESS STOCK MOVEMENT
 */
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
        productId,
        warehouseId,
        quantity,
        type,
        batch_number,
        reference_no,
        partner_id,
        manufacturer_id, // ✅ IMPROVEMENT: Extract manufacturer_id
        unit_price,
      } = item;

      if (!productId || !warehouseId || !quantity || !type) {
        throw new Error(`Invalid data for product ${productId}`);
      }

      let stockRecord = await db.StockLevel.findOne({
        where: { ProductId: productId, WarehouseId: warehouseId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!stockRecord) {
        stockRecord = await db.StockLevel.create(
          {
            ProductId: productId,
            WarehouseId: warehouseId,
            current_quantity: 0,
          },
          { transaction: t },
        );
      }

      let currentQty = Number(stockRecord.current_quantity);
      const moveQty = Number(quantity);
      const absQty = Math.abs(moveQty); // ✅ IMPROVEMENT: Added Math.abs for safety

      if (["INWARD", "RETURN", "ADJUSTMENT"].includes(type.toUpperCase())) {
        currentQty += moveQty;
      } else {
        if (currentQty < absQty) {
          // ✅ IMPROVEMENT: Used absQty to prevent bugs
          throw new Error(`Insufficient stock for Product ID: ${productId}`);
        }
        currentQty -= absQty; // ✅ IMPROVEMENT: Used absQty
      }

      await stockRecord.update(
        { current_quantity: currentQty },
        { transaction: t },
      );

      processedTransactions.push({
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id,
        manufacturer_id, // ✅ IMPROVEMENT: Push to bulk create array
        type: type.toUpperCase(),
        quantity: moveQty,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
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
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * 5. GET TRANSACTION HISTORY
 */
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
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
      if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await db.StockTransaction.findAndCountAll({
      where: whereClause,
      include: [
        { model: db.Product, attributes: ["name", "sku_code"] },
        { model: db.Warehouse, attributes: ["name"] },
        // ✅ IMPROVEMENT: Added Partner includes so frontend can show who supplied/manufactured
        { model: db.Partner, as: "partner", attributes: ["id", "name"] },
        {
          model: db.Partner,
          as: "originManufacturer",
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
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

// 6. ALL EXPORTS ADDED HERE
module.exports = {
  processStockMovement,
  updateStockMovement,
  getInventoryDashboard,
  bulkProcessStockMovement,
  getTransactionHistory,
};
