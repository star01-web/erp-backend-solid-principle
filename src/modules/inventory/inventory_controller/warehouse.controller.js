const db = require("../../../common/index.db");
const { Op } = require("sequelize");

/**
 * 1. Naya Warehouse Create Karna
 * Includes: Strict name duplicate check (including inactive records)
 */
const createWarehouse = async (req, res) => {
  try {
    const {
      name,
      location,
      contact_person,
      contact_phone,
      contact_email,
      type,
      is_active,
    } = req.body;

    // Validation: Name mandatory hai
    if (!name || name.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Warehouse name zaroori hai." });
    }

    const standardizedName = name.trim();

    // Duplicate Check: Check karein ki kya ye naam pehle se hai (Active ya Inactive)
    const existingWarehouse = await db.Warehouse.findOne({
      where: { name: standardizedName },
      paranoid: false, // Deleted records ko bhi check karne ke liye
    });

    if (existingWarehouse) {
      return res.status(400).json({
        success: false,
        message: `Is naam ka Warehouse pehle se maujud hai (${existingWarehouse.is_active ? "Active" : "Inactive"}).`,
      });
    }

    // Naya record create karna
    const warehouse = await db.Warehouse.create({
      name: standardizedName,
      location: location ? location.trim() : null,
      contact_person: contact_person ? contact_person.trim() : null,
      contact_phone: contact_phone ? contact_phone.trim() : null,
      contact_email: contact_email ? contact_email.trim() : null,
      type: type || "MAIN", // Default type
      is_active: is_active !== undefined ? is_active : true,
    });

    return res
      .status(201)
      .json({
        success: true,
        message: "Warehouse successfully create ho gaya.",
        data: warehouse,
      });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Saare Warehouses ki List Fetch Karna
 */
const getWarehouses = async (req, res) => {
  try {
    const { status } = req.query; // Query param: ?status=active
    let filter = {};

    if (status === "active") filter.is_active = true;
    if (status === "inactive") filter.is_active = false;

    const warehouses = await db.Warehouse.findAll({ where: filter });
    return res
      .status(200)
      .json({ success: true, count: warehouses.length, warehouses });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Warehouse Update Karna (Partial Update Support)
 */
const updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const warehouse = await db.Warehouse.findByPk(id);
    if (!warehouse) {
      return res
        .status(404)
        .json({ success: false, message: "Warehouse nahi mila." });
    }

    // Agar naam badal raha hai toh uniqueness check karein
    if (updateData.name && updateData.name.trim() !== warehouse.name) {
      const existing = await db.Warehouse.findOne({
        where: { name: updateData.name.trim() },
        paranoid: false,
      });
      if (existing) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Naya naam pehle se kisi aur warehouse ka hai.",
          });
      }
    }

    // String fields ko trim karna
    const fieldsToTrim = [
      "name",
      "location",
      "contact_person",
      "contact_phone",
      "contact_email",
    ];
    fieldsToTrim.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    await warehouse.update(updateData);

    return res
      .status(200)
      .json({
        success: true,
        message: "Warehouse details update ho gayi hain.",
        data: warehouse,
      });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Toggle Warehouse Status (Delete ki jagah use karein)
 * Security: Band karne se pehle stock check karta hai
 */
const toggleWarehouseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const warehouse = await db.Warehouse.findByPk(id);

    if (!warehouse) {
      return res
        .status(404)
        .json({ success: false, message: "Warehouse nahi mila." });
    }

    // Safety Check: Agar warehouse active hai aur use band (Inactive) kiya ja raha hai
    if (warehouse.is_active) {
      // Check karein ki kya isme stock pada hai?
      const stockCheck = await db.StockLevel.findOne({
        where: {
          WarehouseId: id,
          current_quantity: { [Op.gt]: 0 },
        },
      });

      if (stockCheck) {
        return res.status(400).json({
          success: false,
          message:
            "Is Warehouse mein abhi stock bacha hua hai, isliye ise band nahi kiya ja sakta.",
        });
      }
    }

    warehouse.is_active = !warehouse.is_active;
    await warehouse.save();

    return res.status(200).json({
      success: true,
      message: `Warehouse ab ${warehouse.is_active ? "Active" : "Inactive"} ho gaya hai.`,
      data: warehouse,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createWarehouse,
  getWarehouses,
  updateWarehouse,
  toggleWarehouseStatus,
};
