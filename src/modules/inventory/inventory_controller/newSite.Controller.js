const sequelize = require("../../../common/db.config");
const Site = require("../model/Site");
const ProjectSite = require("../../hrm/models/ProjectSite_model");

// 1. CREATE: Dono tables me ek sath data feed (Atomic Transaction)
const createSite = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      // Site model fields (inventory_sites)
      project_name,
      site_name,
      manager_name,
      contact_number,
      site_location,
      is_active,

      // ProjectSite model fields (project_sites)
      latitude,
      longitude,
      radiusInMeters,
    } = req.body;

    // Strict Mandatory Validation
    if (!site_name || site_name.trim() === "") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "site_name mandatory field hai.",
      });
    }

    // STEP 1: inventory_sites table me entry
    const newSite = await Site.create(
      {
        project_name: project_name ? project_name.trim() : null,
        site_name: site_name.trim(),
        manager_name: manager_name ? manager_name.trim() : "Unassigned",
        contact_number: contact_number || null,
        site_location: site_location || null,
        is_active: is_active !== undefined ? Boolean(is_active) : true,
      },
      { transaction: t },
    );

    // STEP 2: project_sites table me entry (site_name ko locationName me map kiya)
    const newProjectSite = await ProjectSite.create(
      {
        locationName: site_name.trim(),
        latitude: latitude || null,
        longitude: longitude || null,
        radiusInMeters: radiusInMeters ? parseInt(radiusInMeters, 10) : 100,
      },
      { transaction: t },
    );

    // Dono query successful hone par DB me commit karein
    await t.commit();

    return res.status(201).json({
      success: true,
      message:
        "Site aur Geofencing location dono tables me successfully save ho gaye.",
      data: {
        site: newSite,
        projectSite: newProjectSite,
      },
    });
  } catch (error) {
    // Kisi bhi ek table me error aane par pura transaction Rollback
    await t.rollback();
    console.error("Create Site Error:", error);

    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: error.errors.map((err) => err.message).join(", "),
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error! Data save nahi ho paya aur database rollback ho gaya.",
      error: error.message,
    });
  }
};

// 2. READ ALL: Saari sites fetch karne ke liye (With Optional Status Filter)
const getAllSites = async (req, res) => {
  try {
    const { active } = req.query;
    const whereCondition = {};

    if (active !== undefined) {
      whereCondition.is_active = active === "true";
    }

    const sites = await Site.findAll({
      where: whereCondition,
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: sites.length,
      data: sites,
    });
  } catch (error) {
    console.error("Get All Sites Error:", error);
    return res.status(500).json({
      success: false,
      message: "Sites fetch karne me server error aaya.",
      error: error.message,
    });
  }
};

// 3. READ BY ID: Single site ki detail dekhne ke liye
const getSiteById = async (req, res) => {
  try {
    const { id } = req.params;
    const site = await Site.findByPk(id);

    if (!site) {
      return res.status(404).json({
        success: false,
        message: "Site nahi mili ya delete ho chuki hai.",
      });
    }

    return res.status(200).json({
      success: true,
      data: site,
    });
  } catch (error) {
    console.error("Get Site By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error!",
      error: error.message,
    });
  }
};

// 4. UPDATE: Existing site ka data update karne ke liye
const updateSite = async (req, res) => {
  try {
    const { id } = req.params;
    const site = await Site.findByPk(id);

    if (!site) {
      return res.status(404).json({
        success: false,
        message: "Update karne ke liye site exist nahi karti.",
      });
    }

    await site.update(req.body);

    return res.status(200).json({
      success: true,
      message: "Site details successfully update ho gaye.",
      data: site,
    });
  } catch (error) {
    console.error("Update Site Error:", error);
    return res.status(500).json({
      success: false,
      message: "Update operation fail ho gaya.",
      error: error.message,
    });
  }
};

// 5. DELETE: Site ko Soft Delete karne ke liye (paranoid: true ke wajah se row wipe nahi hogi)
const deleteSite = async (req, res) => {
  try {
    const { id } = req.params;
    const site = await Site.findByPk(id);

    if (!site) {
      return res.status(404).json({
        success: false,
        message: "Site pehle se hi deleted hai ya exist nahi karti.",
      });
    }

    await site.destroy(); // deletedAt me timestamp add ho jayega

    return res.status(200).json({
      success: true,
      message: "Site successfully delete (soft-delete) ho gayi.",
    });
  } catch (error) {
    console.error("Delete Site Error:", error);
    return res.status(500).json({
      success: false,
      message: "Delete operation fail ho gaya.",
      error: error.message,
    });
  }
};

module.exports = {
  createSite,
  getAllSites,
  getSiteById,
  updateSite,
  deleteSite,
};
