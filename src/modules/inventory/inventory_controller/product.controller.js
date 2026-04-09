const db = require("../../../common/index.db");
const { Op } = require("sequelize");

const createProduct = async (req, res) => {
  try {
    const {
      sku_code,
      name,
      color,
      hsn_code,
      manufacturer_id,
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

    // 2. Strict Duplicate Checks (Industrial Logic)
    // SKU Check
    const existingSku = await db.Product.findOne({
      where: { sku_code: standardizedSKU },
    });
    if (existingSku) {
      return res.status(400).json({
        success: false,
        message: `SKU '${standardizedSKU}' pehle se maujud hai (${existingSku.is_active ? "Active" : "Inactive"}).`,
      });
    }

    // Name + Color + Manufacturer Combination Check
    const duplicateProduct = await db.Product.findOne({
      where: {
        name: cleanName,
        color: color ? color.trim() : null,
        manufacturer_id: manufacturer_id || null,
      },
    });

    if (duplicateProduct) {
      return res.status(400).json({
        success: false,
        message:
          "Yeh Product combination (Name + Color + Manufacturer) pehle se database mein hai.",
      });
    }

    // 3. Create Product with all Industrial Fields
    const product = await db.Product.create({
      sku_code: standardizedSKU,
      name: cleanName,
      color: color ? color.trim() : null,
      hsn_code: hsn_code ? hsn_code.trim() : null,
      manufacturer_id: manufacturer_id || null,
      category: category ? category.trim() : null,
      unit: unit || "pcs",
      min_stock_level: min_stock_level || 5,
      max_stock_level: max_stock_level || 1000,
      is_active: true,
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const { status } = req.query; // ?status=active/inactive/all
    let where = {};
    if (status === "active") where.is_active = true;
    if (status === "inactive") where.is_active = false;

    // Industrial Traceability: Manufacturer ka naam bhi saath mein laayein
    const products = await db.Product.findAll({
      where,
      include: [
        { model: db.Partner, as: "manufacturer", attributes: ["id", "name"] },
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
    const updateData = req.body;

    const product = await db.Product.findByPk(id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }

    // INDUSTRIAL SAFETY CHECK: Agar user product ko INACTIVE kar raha hai
    if (updateData.is_active === false && product.is_active === true) {
      // Check karein ki kisi bhi warehouse mein stock bacha toh nahi?
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

    // Trimming fields before update
    const stringFields = ["name", "category", "unit", "color", "hsn_code"];
    stringFields.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    await product.update(updateData);

    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      data: product,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createProduct,
  getAllProducts,
  updateProduct,
};
