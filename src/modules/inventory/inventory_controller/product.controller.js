const db = require("../../../common/index.db");
const { Op } = require("sequelize");

const createProduct = async (req, res) => {
  try {
    const {
      sku_code,
      name,
      color,
      hsn_code,
      manufacturer_ids, // <-- Updated: Ab array expect karenge
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

    // Name + Color Combination Check (Manufacturer hata diya kyunki ab woh alag table mein hai)
    const duplicateProduct = await db.Product.findOne({
      where: {
        name: cleanName,
        color: color ? color.trim() : null,
      },
    });

    if (duplicateProduct) {
      return res.status(400).json({
        success: false,
        message: "Yeh Product (Name + Color) pehle se database mein hai.",
      });
    }

    // 3. Create Product (Bina manufacturer_id ke)
    const product = await db.Product.create({
      sku_code: standardizedSKU,
      name: cleanName,
      color: color ? color.trim() : null,
      hsn_code: hsn_code ? hsn_code.trim() : null,
      category: category ? category.trim() : null,
      unit: unit || "pcs",
      min_stock_level: min_stock_level || 5,
      max_stock_level: max_stock_level || 1000,
      is_active: true,
    });

    // 4. Pivot Table mein Manufacturers Map Karein (Many-to-Many)
    if (manufacturer_ids && manufacturer_ids.length > 0) {
      // 'setManufacturers' Sequelize ka auto-generated method hai aliases ke base par
      await product.setManufacturers(manufacturer_ids);
    }

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const bulkCreateProducts = async (req, res) => {
  // Transaction start karein taaki koi error aane par poora data rollback ho jaye
  const t = await db.sequelize.transaction();

  try {
    const { products } = req.body; // Expecting an array of products

    if (!Array.isArray(products) || products.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Products ka array required hai.",
      });
    }

    const createdProducts = [];
    const payloadSkus = new Set(); // Upload kiye gaye data ke andar duplicates check karne ke liye

    // Loop through all products
    for (const [index, item] of products.entries()) {
      const {
        sku_code,
        name,
        color,
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
      const cleanColor = color ? color.trim() : null;

      // 2. Check for duplicate SKU within the uploaded payload itself
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

      // 4. Check DB for existing Name + Color combination
      const duplicateProduct = await db.Product.findOne({
        where: { name: cleanName, color: cleanColor },
        transaction: t,
      });
      if (duplicateProduct) {
        throw new Error(
          `Row ${index + 1}: '${cleanName}' (${cleanColor || "No Color"}) combination pehle se database mein hai.`,
        );
      }

      // 5. Create Product (inside transaction)
      const product = await db.Product.create(
        {
          sku_code: standardizedSKU,
          name: cleanName,
          color: cleanColor,
          hsn_code: hsn_code ? hsn_code.trim() : null,
          category: category ? category.trim() : null,
          unit: unit || "pcs",
          min_stock_level: min_stock_level || 5,
          max_stock_level: max_stock_level || 1000,
          is_active: true,
        },
        { transaction: t },
      );

      // 6. Map Manufacturers (Many-to-Many)
      if (
        manufacturer_ids &&
        Array.isArray(manufacturer_ids) &&
        manufacturer_ids.length > 0
      ) {
        // yahan bhi transaction pass karna zaroori hai
        await product.setManufacturers(manufacturer_ids, { transaction: t });
      }

      createdProducts.push(product);
    }

    // Agar sab kuch bina kisi error ke successfully pass ho gaya, toh commit karein
    await t.commit();
    return res.status(201).json({
      success: true,
      message: `${createdProducts.length} products successfully add ho gaye.`,
      // data: createdProducts // (Optional: Agar list bohot lambi ho toh data return karna avoid karein)
    });
  } catch (error) {
    // Agar beech mein koi bhi Error throw hota hai, toh sab kuch undo (rollback) ho jayega
    if (t) await t.rollback();
    return res.status(400).json({ success: false, message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const { status } = req.query; // ?status=active/inactive/all
    let where = {};
    if (status === "active") where.is_active = true;
    if (status === "inactive") where.is_active = false;

    // Industrial Traceability: Manufacturers ke naam
    const products = await db.Product.findAll({
      where,
      include: [
        {
          model: db.Partner,
          as: "manufacturers", // <-- Updated: Alias ab plural 'manufacturers' hai
          attributes: ["id", "name"],
          through: { attributes: [] }, // Pivot table ka faltu data hide karne ke liye
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
    const { manufacturer_ids, ...updateData } = req.body; // manufacturer_ids ko alag kar liya

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

    // Trimming fields before update
    const stringFields = ["name", "category", "unit", "color", "hsn_code"];
    stringFields.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    // 1. Basic Product Details Update karein
    await product.update(updateData);

    // 2. Agar naye manufacturers aaye hain, toh relation update karein
    if (manufacturer_ids) {
      // setManufacturers purane links hatakar naye map kar dega
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

module.exports = {
  createProduct,
  bulkCreateProducts,
  getAllProducts,
  updateProduct,
};
