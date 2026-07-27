const db = require("../../../common/index.db");
const { Op } = require("sequelize");

/**
 * Multi-UOM trio parse + validate (create & bulk-create dono use karte hain).
 *
 * User product add karte waqt khud batata hai ki 1 purchase unit me kitne
 * base units hain — e.g. Rope 20mm: base 'Meter', purchase 'Bundle',
 * conversion_factor 100 (1 Bundle = 100 Meter); Rope 10mm: factor 220.
 * Yahi factor aage DispatchService ke saare dispatch/return calculations
 * me use hota hai, isliye yahin strict validate hota hai.
 *
 * Returns { values } on success, { error } (message string) on failure.
 */
const resolveUomFields = ({ base_uom, purchase_uom, conversion_factor }) => {
  const base = base_uom ? String(base_uom).trim() : "pcs";
  const purchase = purchase_uom ? String(purchase_uom).trim() : null;

  // Purchase unit nahi hai -> single-UOM item, factor hamesha 1.
  if (!purchase) {
    if (
      conversion_factor !== undefined &&
      conversion_factor !== null &&
      Number(conversion_factor) !== 1
    ) {
      return {
        error:
          "conversion_factor tabhi set karein jab purchase_uom bhi diya ho " +
          "(e.g. purchase_uom: 'Bundle', conversion_factor: 100).",
      };
    }
    return { values: { base_uom: base, purchase_uom: null, conversion_factor: 1 } };
  }

  if (purchase.toLowerCase() === base.toLowerCase()) {
    return {
      error: `purchase_uom aur base_uom same ('${base}') nahi ho sakte.`,
    };
  }

  // Purchase unit hai -> user ko batana hi hoga ki 1 purchase = kitne base.
  const factor = Number(conversion_factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    return {
      error:
        `conversion_factor mandatory hai jab purchase_uom set ho — ` +
        `batayein 1 ${purchase} me kitne ${base} hote hain (positive number).`,
    };
  }

  return {
    values: { base_uom: base, purchase_uom: purchase, conversion_factor: factor },
  };
};

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
      // --- Multi-UOM (free-hand per product) ---
      base_uom,
      purchase_uom,
      conversion_factor,
    } = req.body;

    // 1. Basic Validation
    if (!sku_code || !name) {
      return res.status(400).json({
        success: false,
        message: "SKU Code aur Product Name mandatory hain.",
      });
    }

    // 1b. Multi-UOM validation — factor product add karte waqt hi lock hota hai.
    const uomResult = resolveUomFields({ base_uom, purchase_uom, conversion_factor });
    if (uomResult.error) {
      return res.status(400).json({ success: false, message: uomResult.error });
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
      // Multi-UOM: e.g. Rope 20mm -> Meter/Bundle/100, Rope 10mm -> Meter/Bundle/220
      ...uomResult.values,
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
        // --- Multi-UOM (free-hand per product) ---
        base_uom,
        purchase_uom,
        conversion_factor,
      } = item;

      // 1. Basic Row Validation
      if (!sku_code || !name) {
        throw new Error(
          `Row ${index + 1}: SKU Code aur Product Name mandatory hain.`,
        );
      }

      // 1b. Multi-UOM row validation
      const uomResult = resolveUomFields({
        base_uom,
        purchase_uom,
        conversion_factor,
      });
      if (uomResult.error) {
        throw new Error(`Row ${index + 1}: ${uomResult.error}`);
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
          // Multi-UOM: har SKU apna khud ka factor rakhta hai
          ...uomResult.values,
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

    // MULTI-UOM SAFETY CHECK — total_stock aur saare ledger base_quantity
    // base_uom me stored hain. Stock bacha ho to base_uom ya conversion_factor
    // badalna purane numbers ka matlab hi badal dega (100 'Meter' achanak
    // 100 'Feet' ban jayega), isliye pehle stock zero karna zaroori hai.
    const uomTouched =
      updateData.base_uom !== undefined ||
      updateData.purchase_uom !== undefined ||
      updateData.conversion_factor !== undefined;

    if (uomTouched) {
      const uomResult = resolveUomFields({
        base_uom: updateData.base_uom ?? product.base_uom,
        purchase_uom:
          updateData.purchase_uom !== undefined
            ? updateData.purchase_uom
            : product.purchase_uom,
        conversion_factor:
          updateData.conversion_factor !== undefined
            ? updateData.conversion_factor
            : product.conversion_factor,
      });
      if (uomResult.error) {
        return res.status(400).json({ success: false, message: uomResult.error });
      }

      const baseUomChanging =
        uomResult.values.base_uom.toLowerCase() !==
        String(product.base_uom).toLowerCase();
      const factorChanging =
        Number(uomResult.values.conversion_factor) !==
        Number(product.conversion_factor);

      if ((baseUomChanging || factorChanging) && Number(product.total_stock) > 0) {
        return res.status(400).json({
          success: false,
          message:
            `Is product ka ${product.total_stock} ${product.base_uom} stock bacha hai. ` +
            `base_uom/conversion_factor badalne se pehle stock zero karein, ` +
            `warna purane stock/ledger numbers galat ho jayenge.`,
        });
      }

      Object.assign(updateData, uomResult.values);
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
