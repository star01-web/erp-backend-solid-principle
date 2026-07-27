const AppError = require("../../../common/AppError");

/**
 * HTTP layer for Site management (dual-table create + CRUD).
 *
 * SRP: this controller does exactly three things and nothing else —
 *   1. pull the DTO out of the HTTP request,
 *   2. delegate to the injected SiteService,
 *   3. shape a standardized JSON response.
 * It never touches Sequelize and never runs a transaction; the service owns
 * the atomic dual-table workflow. Expected failures arrive as `AppError`.
 */
class SiteController {
  constructor({ siteService }) {
    this.service = siteService;
  }

  /** Uniform failure envelope. AppError -> its status; anything else -> 500/next. */
  _fail(res, error, fallbackMessage, next = null) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: error.errors.map((err) => err.message).join(", "),
      });
    }

    console.error(`${fallbackMessage}:`, error);
    if (typeof next === "function") return next(error);

    return res.status(500).json({
      success: false,
      message: fallbackMessage,
      error:
        process.env.NODE_ENV === "production"
          ? "Internal Server Error"
          : error.message,
    });
  }

  // POST /site/create — atomic entry in inventory_sites + ProjectSite
  createSite = async (req, res, next) => {
    try {
      const {
        project_name,
        site_name,
        manager_name,
        contact_number,
        site_location,
        is_active,
        latitude,
        longitude,
        radiusInMeters,
      } = req.body;

      const data = await this.service.createSiteWithGeofence({
        projectName: project_name,
        siteName: site_name,
        managerName: manager_name,
        contactNumber: contact_number,
        siteLocation: site_location,
        isActive: is_active,
        latitude,
        longitude,
        radiusInMeters,
      });

      return res.status(201).json({
        success: true,
        message:
          "Site aur Geofencing location dono tables me successfully save ho gaye.",
        data,
      });
    } catch (error) {
      return this._fail(
        res,
        error,
        "Server error! Data save nahi ho paya aur database rollback ho gaya.",
        next,
      );
    }
  };

  // GET /site?active=true|false
  getAllSites = async (req, res, next) => {
    try {
      const sites = await this.service.getAll({ active: req.query.active });
      return res
        .status(200)
        .json({ success: true, count: sites.length, data: sites });
    } catch (error) {
      return this._fail(
        res,
        error,
        "Sites fetch karne me server error aaya.",
        next,
      );
    }
  };

  // GET /site/:id
  getSiteById = async (req, res, next) => {
    try {
      const site = await this.service.getById(req.params.id);
      return res.status(200).json({ success: true, data: site });
    } catch (error) {
      return this._fail(res, error, "Server error!", next);
    }
  };

  // PUT /site/update/:id
  updateSite = async (req, res, next) => {
    try {
      const site = await this.service.update(req.params.id, req.body);
      return res.status(200).json({
        success: true,
        message: "Site details successfully update ho gaye.",
        data: site,
      });
    } catch (error) {
      return this._fail(res, error, "Update operation fail ho gaya.", next);
    }
  };

  // DELETE /site/delete/:id (soft delete)
  deleteSite = async (req, res, next) => {
    try {
      await this.service.remove(req.params.id);
      return res.status(200).json({
        success: true,
        message: "Site successfully delete (soft-delete) ho gayi.",
      });
    } catch (error) {
      return this._fail(res, error, "Delete operation fail ho gaya.", next);
    }
  };
}

module.exports = SiteController;
