const db = require("../../../common/index.db");
const { Op } = require("sequelize");

/**
 * 1. Naya Partner Create Karna (Supplier/Manufacturer/Customer)
 */
const createPartner = async (req, res) => {
  try {
    const { name, type, gst_number, address, contact_person, phone } = req.body;

    // 1. Basic Validation
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message:
          "Partner Name aur Type (SUPPLIER/MANUFACTURER/etc.) zaroori hain.",
      });
    }

    const cleanName = name.trim();
    const cleanGst = gst_number ? gst_number.trim().toUpperCase() : null;

    // 2. Duplicate Check - GST Number (Industrial Identity)
    if (cleanGst) {
      const existingGst = await db.Partner.findOne({
        where: { gst_number: cleanGst },
        paranoid: false, // Deleted partners ko bhi check karein
      });
      if (existingGst) {
        return res.status(400).json({
          success: false,
          message: `GST Number '${cleanGst}' pehle se register hai.`,
        });
      }
    }

    // 3. Duplicate Check - Name + Type
    const existingPartner = await db.Partner.findOne({
      where: { name: cleanName, type: type },
    });
    if (existingPartner) {
      return res.status(400).json({
        success: false,
        message: `Is naam ka ${type} pehle se maujud hai.`,
      });
    }

    // Partner Create Karna
    const partner = await db.Partner.create({
      name: cleanName,
      type: type,
      gst_number: cleanGst,
      address: address ? address.trim() : null,
      contact_person: contact_person ? contact_person.trim() : null,
      phone: phone ? phone.trim() : null,
      is_active: true,
    });

    return res.status(201).json({
      success: true,
      message: "Partner successfully create ho gaya.",
      data: partner,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Partners ki List Fetch Karna (Filters ke saath)
 */
const getPartners = async (req, res) => {
  try {
    const { type, status } = req.query; // Query: ?type=SUPPLIER&status=active
    let whereClause = {};

    if (type) whereClause.type = type;
    if (status === "active") whereClause.is_active = true;
    if (status === "inactive") whereClause.is_active = false;

    const partners = await db.Partner.findAll({ where: whereClause });
    return res.status(200).json({
      success: true,
      count: partners.length,
      partners,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Partner Update Karna
 */
const updatePartner = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const partner = await db.Partner.findByPk(id);
    if (!partner) {
      return res
        .status(404)
        .json({ success: false, message: "Partner nahi mila." });
    }

    // GST Unique check agar badla ja raha hai
    if (
      updateData.gst_number &&
      updateData.gst_number.trim().toUpperCase() !== partner.gst_number
    ) {
      const existing = await db.Partner.findOne({
        where: { gst_number: updateData.gst_number.trim().toUpperCase() },
      });
      if (existing) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Yeh GST Number kisi aur partner ka hai.",
          });
      }
    }

    // Data cleaning aur update
    const fieldsToTrim = [
      "name",
      "address",
      "contact_person",
      "phone",
      "gst_number",
    ];
    fieldsToTrim.forEach((field) => {
      if (updateData[field]) updateData[field] = updateData[field].trim();
    });

    await partner.update(updateData);

    return res.status(200).json({
      success: true,
      message: "Partner details update ho gayi hain.",
      data: partner,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Toggle Partner Status (Active/Inactive)
 */
const togglePartnerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const partner = await db.Partner.findByPk(id);

    if (!partner) {
      return res
        .status(404)
        .json({ success: false, message: "Partner nahi mila." });
    }

    // Industrial Safety Check:
    // Agar kisi Supplier se pending transactions hain, toh use inactive karne se pehle warn karein
    if (partner.is_active) {
      const hasTransactions = await db.StockTransaction.findOne({
        where: { partner_id: id },
      });

      // Note: Industry mein sirf warning dete hain ya block karte hain.
      // Filhal hum sirf status badal rahe hain kyunki transactions audit ke liye record rahengi.
    }

    partner.is_active = !partner.is_active;
    await partner.save();

    return res.status(200).json({
      success: true,
      message: `Partner ab ${partner.is_active ? "Active" : "Inactive"} hai.`,
      data: partner,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createPartner,
  getPartners,
  updatePartner,
  togglePartnerStatus,
};
