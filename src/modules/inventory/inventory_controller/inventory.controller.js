const db = require("../../../common/index.db");
const { Op } = require("sequelize");

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
      unit_price,
      type,
      batch_number,
      reference_no,
      vehicle_number,
      movement_date,
      remarks,
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

      const totalAvailable = stockRows.reduce(
        (sum, r) => sum + Number(r.current_quantity),
        0,
      );

      // Guard against negative stock — with the REAL available number so the
      // caller can see the stock exists (just under a different variant).
      if (totalAvailable < absQty) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${totalAvailable}, Requested: ${absQty}.`,
        });
      }

      // Greedy deduction across the matched buckets (largest first), so a
      // quantity split over several manufacturer/color rows can still be filled.
      let remaining = absQty;
      for (const row of stockRows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(row.current_quantity), remaining);
        await row.update(
          {
            current_quantity: Number(row.current_quantity) - take,
            last_updated_at: new Date(),
          },
          { transaction: t },
        );
        remaining -= take;
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
      // INWARD/RETURN add the absolute qty; ADJUSTMENT applies the signed delta.
      const newQuantity =
        moveType === "ADJUSTMENT" ? currentQty + moveQty : currentQty + absQty;

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

    await t.commit();
    return res.status(201).json({ success: true, data: transactionLog });
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

    if (["INWARD", "RETURN", "ADJUSTMENT"].includes(oldTx.type)) {
      currentQty -= Number(oldTx.quantity);
    } else {
      currentQty += Number(oldTx.quantity);
    }

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

    await oldTx.update(
      {
        quantity: finalQty,
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
        type,
        batch_number,
        reference_no,
        vehicle_number,
        movement_date,
        partner_id,
        manufacturer_id,
        color,
        unit_price,
      } = item;

      if (!productId || !warehouseId || !quantity || !type) {
        throw new Error(`Invalid data for product ${productId}`);
      }

      let stockRecord = await db.StockLevel.findOne({
        where: {
          ProductId: productId,
          WarehouseId: warehouseId,
          manufacturer_id: manufacturer_id || null,
          color: color || "Standard",
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!stockRecord) {
        stockRecord = await db.StockLevel.create(
          {
            ProductId: productId,
            WarehouseId: warehouseId,
            manufacturer_id: manufacturer_id || null,
            color: color || "Standard",
            current_quantity: 0,
          },
          { transaction: t },
        );
      }

      let currentQty = Number(stockRecord.current_quantity);
      const moveQty = Number(quantity);
      const absQty = Math.abs(moveQty);

      if (["INWARD", "RETURN", "ADJUSTMENT"].includes(type.toUpperCase())) {
        currentQty += moveQty;
      } else {
        if (currentQty < absQty) {
          throw new Error(`Insufficient stock for Product ID: ${productId}`);
        }
        currentQty -= absQty;
      }

      await stockRecord.update(
        { current_quantity: currentQty },
        { transaction: t },
      );

      processedTransactions.push({
        date: date || new Date(),
        ProductId: productId,
        WarehouseId: warehouseId,
        partner_id,
        manufacturer_id,
        color: color || "Standard",
        type: type.toUpperCase(),
        quantity: moveQty,
        unit_price: unit_price || 0,
        batch_number,
        reference_no,
        vehicle_number,
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

// Available Stock (Product-wise total): har product ek hi baar, uska total stock
// sabhi warehouses / manufacturers / colors ka jodh kar. Dashboard per-bucket
// deta hai (product baar-baar aata hai); yeh usko product ke hisaab se aggregate
// karke single row deta hai.
const getAvailableStock = async (req, res) => {
  try {
    // includeZero=true dene par jinke total 0 hai woh bhi aayenge; default only >0.
    const includeZero = req.query.includeZero === "true";

    const rows = await db.StockLevel.findAll({
      attributes: [
        "ProductId",
        [
          db.sequelize.fn("SUM", db.sequelize.col("current_quantity")),
          "total_quantity",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("reserved_quantity")),
          "total_reserved",
        ],
      ],
      include: [
        {
          model: db.Product,
          attributes: ["name", "sku_code", "unit", "min_stock_level"],
        },
      ],
      group: ["ProductId", "Product.id"],
      order: [[db.sequelize.col("Product.name"), "ASC"]],
    });

    const data = rows
      .map((r) => {
        const total = Number(r.get("total_quantity")) || 0;
        const reserved = Number(r.get("total_reserved")) || 0;
        const minLevel = Number(r.Product?.min_stock_level || 0);
        return {
          productId: r.ProductId,
          name: r.Product?.name,
          sku_code: r.Product?.sku_code,
          unit: r.Product?.unit,
          total_quantity: total,
          reserved_quantity: reserved,
          available_quantity: total - reserved,
          min_stock_level: minLevel,
          is_low_stock: total <= minLevel,
        };
      })
      .filter((p) => includeZero || p.total_quantity > 0);

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
  bulkProcessStockMovement,

  // Reports
  getInventoryDashboard,
  getAvailableStock,
  getTransactionHistory,
};
