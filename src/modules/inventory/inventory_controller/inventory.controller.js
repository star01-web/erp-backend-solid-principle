const db = require("../../../common/index.db");
const { Op } = require("sequelize");

/**
 * Process Stock Movement (Industrial Version)
 */
const processStockMovement = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const {
      productId,
      warehouseId,
      partner_id, // Naya field: Supplier/Customer ke liye
      quantity,
      unit_price, // Naya field: Valuation ke liye
      type,
      batch_number,
      reference_no,
      remarks,
    } = req.body;
    const userId = req.user.id;

    // 1. Validation Logic
    if (!productId || !warehouseId || !quantity || !type) {
      return res
        .status(400)
        .json({ success: false, message: "Required fields missing." });
    }

    // 2. Industrial Check: Product aur Warehouse Active hone chahiye
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

    // 3. Create Transaction Log
    const transaction = await db.StockTransaction.create(
      {
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id: partner_id || null,
        type,
        quantity,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
        remarks,
        created_by: userId,
      },
      { transaction: t },
    );

    // 4. Update Stock Level (Locking active hai)
    // Industrial Tip: Agar batch-wise tracking chahiye toh where mein batch_number add karein
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

    let newQuantity = Number(stockRecord.current_quantity);
    const moveQty = Number(quantity);

    if (["INWARD", "RETURN", "ADJUSTMENT"].includes(type)) {
      newQuantity += moveQty;
    } else {
      if (newQuantity < moveQty) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Stock kam hai. Process nahi ho sakta.",
        });
      }
      newQuantity -= moveQty;
    }

    await stockRecord.update(
      {
        current_quantity: newQuantity,
        last_updated_at: new Date(),
      },
      { transaction: t },
    );

    await t.commit();
    return res
      .status(201)
      .json({ success: true, message: "Stock updated", data: transaction });
  } catch (error) {
    await t.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Inventory Dashboard with Industrial Metadata
 */
const getInventoryDashboard = async (req, res) => {
  try {
    const stockStatus = await db.StockLevel.findAll({
      include: [
        {
          model: db.Product,
          attributes: ["name", "sku_code", "unit", "min_stock_level", "color"], // Color bhi add kiya
        },
        { model: db.Warehouse, attributes: ["name", "type"] }, // Warehouse type bhi add kiya
      ],
    });

    // Low Stock Alerts based on model defaults
    const alerts = stockStatus.filter(
      (item) =>
        Number(item.current_quantity) <= Number(item.Product.min_stock_level),
    );

    return res.status(200).json({
      success: true,
      data: stockStatus,
      lowStockAlerts: alerts,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
const bulkProcessStockMovement = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { movements } = req.body; // Array of movement objects

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
        unit_price,
      } = item;

      // 1. Validation for each item
      if (!productId || !warehouseId || !quantity || !type) {
        throw new Error(`Invalid data for product ${productId}`);
      }

      // 2. Lock and Update Stock (Ek-ek karke process zaroori hai for concurrency safety)
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

      if (["INWARD", "RETURN", "ADJUSTMENT"].includes(type)) {
        currentQty += moveQty;
      } else {
        if (currentQty < moveQty) {
          throw new Error(`Insufficient stock for Product ID: ${productId}`);
        }
        currentQty -= moveQty;
      }

      // Update current stock
      await stockRecord.update(
        { current_quantity: currentQty },
        { transaction: t },
      );

      // Prepare data for bulk insertion
      processedTransactions.push({
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id,
        type,
        quantity,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
        created_by: req.user.id,
      });
    }

    // 3. Bulk Insert into Transaction Log
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
 * Get Transaction History with Filters & Pagination
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

    // Dynamic filtering
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

module.exports = {
  processStockMovement,
  getInventoryDashboard,
  bulkProcessStockMovement,
  getTransactionHistory,
};
