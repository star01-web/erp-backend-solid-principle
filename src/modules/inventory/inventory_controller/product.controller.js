const db = require("../../../common/index.db");
const { Op } = require("sequelize");

const createProduct = async (req, res) => {
  try {
    const {
      sku_code,
      name,
      // color, <-- YAHAN SE HATA DIYA
      hsn_code,
      manufacturer_ids,
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
    // SKU Check
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

    // Name Check (Color hata diya gaya hai)
    const duplicateProduct = await db.Product.findOne({
      where: { name: cleanName },
    });

    if (duplicateProduct) {
      return res.status(400).json({
        success: false,
        message: "Yeh Product Name pehle se database mein hai.",
      });
    }

    // 3. Create Product (Bina color ke)
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

    // 4. Pivot Table mein Manufacturers Map Karein (Many-to-Many)
    if (manufacturer_ids && manufacturer_ids.length > 0) {
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
        // color, <-- YAHAN SE HATA DIYA
        hsn_code,
        manufacturer_ids,
        category,
        unit,
        min_stock_level,
        max_stock_level,
      } = item;

      // 1. Basic Row Validation
      if (!sku_code || !name) {
        throw new Error(
          `Row ${index + 1}: SKU Code aur Product Name mandatory hain.`,
        );
      }

      const standardizedSKU = sku_code.trim().toUpperCase();
      const cleanName = name.trim();

      // 2. Check for duplicate SKU within payload
      if (payloadSkus.has(standardizedSKU)) {
        throw new Error(
          `Row ${index + 1}: Duplicate SKU '${standardizedSKU}' aapki file/payload mein ek se zyada baar hai.`,
        );
      }
      payloadSkus.add(standardizedSKU);

      // 3. Check DB for existing SKU
      const existingSku = await db.Product.findOne({
        where: { sku_code: standardizedSKU },
        transaction: t,
      });
      if (existingSku) {
        throw new Error(
          `Row ${index + 1}: SKU '${standardizedSKU}' database mein pehle se maujud hai.`,
        );
      }

      // 4. Check DB for existing Name (Color hata diya)
      const duplicateProduct = await db.Product.findOne({
        where: { name: cleanName },
        transaction: t,
      });
      if (duplicateProduct) {
        throw new Error(
          `Row ${index + 1}: '${cleanName}' name pehle se database mein hai.`,
        );
      }

      // 5. Create Product (inside transaction)
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

      // 6. Map Manufacturers
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

    // INDUSTRIAL SAFETY CHECK
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

    // Trimming fields before update (Color ko stringFields se hata diya gaya hai)
    const stringFields = ["name", "category", "unit", "hsn_code"];
    stringFields.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    // 1. Basic Product Details Update
    await product.update(updateData);

    // 2. Relation update
    if (manufacturer_ids) {
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

/**
 * Toggle Product Status (Active/Inactive) — delete ki jagah use karein.
 * Safety: Inactive karne se pehle check karta hai ki warehouses mein stock to nahi bacha.
 */
const toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.Product.findByPk(id);

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }

    // Active -> Inactive karte waqt stock check
    if (product.is_active) {
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

    product.is_active = !product.is_active;
    await product.save();

    return res.status(200).json({
      success: true,
      message: `Product ab ${product.is_active ? "Active" : "Inactive"} hai.`,
      data: product,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createProduct,
  bulkCreateProducts,
  getAllProducts,
  updateProduct,
  toggleProductStatus,
};
