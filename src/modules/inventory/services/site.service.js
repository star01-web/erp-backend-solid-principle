const AppError = require("../../../common/AppError");

/**
 * Site master-data business logic — owns the DUAL-TABLE atomic creation flow.
 *
 * Ek naya site banate waqt do alag modules ko sync me rehna hota hai:
 *   1. Inventory `Site` (inventory_sites)  -> stock/dispatch ledger ka anchor
 *   2. HRM `ProjectSite` (geofence master) -> attendance check-in radius
 *
 * SRP: yeh service business rules + transaction ownership sambhalti hai.
 * Controllers sirf DTO pass karte hain; repositories sirf queries chalati hain.
 * Dono `create` calls EK managed `sequelize.transaction(cb)` ke andar hain —
 * callback resolve hua to auto-commit, throw hua to auto-rollback. Isliye
 * "inventory me site hai par geofence nahi" wali half-written state kabhi
 * DB me land nahi ho sakti.
 */
class SiteService {
  constructor({ siteRepository, projectSiteRepository, sequelize }) {
    this.siteRepo = siteRepository;
    this.projectSiteRepo = projectSiteRepository;
    this.sequelize = sequelize;
  }

  _assertCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError(
        "latitude aur longitude valid numbers hone chahiye (geofence ke liye zaroori).",
        400,
      );
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new AppError("Invalid coordinates provided.", 400);
    }
    return { lat, lng };
  }

  /**
   * Create one site in BOTH tables atomically.
   *  - inventory_sites  : site_name, project_name, manager_name, contact_number, site_location, is_active
   *  - ProjectSite (HRM): locationName (<- site_name), latitude, longitude, radiusInMeters
   * Either both rows commit, or neither does.
   */
  async createSiteWithGeofence({
    projectName,
    siteName,
    managerName,
    contactNumber,
    siteLocation,
    isActive,
    latitude,
    longitude,
    radiusInMeters,
  }) {
    if (!siteName || !String(siteName).trim()) {
      throw new AppError("site_name mandatory field hai.", 400);
    }
    // ProjectSite.latitude/longitude are NOT NULL — fail fast with a clear
    // message instead of letting a SequelizeValidationError roll us back.
    const { lat, lng } = this._assertCoordinates(latitude, longitude);

    const cleanSiteName = String(siteName).trim();
    const radius = Number.parseInt(radiusInMeters, 10);

    return this.sequelize.transaction(async (t) => {
      // STEP 1: inventory_sites row (stock/dispatch anchor)
      const site = await this.siteRepo.create(
        {
          project_name: projectName ? String(projectName).trim() : null,
          site_name: cleanSiteName,
          manager_name: managerName ? String(managerName).trim() : "Unassigned",
          contact_number: contactNumber || null,
          site_location: siteLocation || null,
          is_active: isActive !== undefined ? Boolean(isActive) : true,
        },
        { transaction: t },
      );

      // STEP 2: HRM geofence row (site_name -> locationName mapping)
      const projectSite = await this.projectSiteRepo.create(
        {
          locationName: cleanSiteName,
          latitude: lat,
          longitude: lng,
          radiusInMeters: Number.isFinite(radius) ? radius : 100,
        },
        { transaction: t },
      );

      // Callback resolved -> managed transaction commits both rows together.
      return { site, projectSite };
    });
  }

  /** All sites, optionally filtered on is_active. */
  async getAll({ active } = {}) {
    const where = {};
    if (active !== undefined) {
      where.is_active = active === true || active === "true";
    }
    return this.siteRepo.findAll(where, { order: [["createdAt", "DESC"]] });
  }

  async getById(id) {
    const site = await this.siteRepo.findById(id);
    if (!site) {
      throw new AppError("Site nahi mili ya delete ho chuki hai.", 404);
    }
    return site;
  }

  async update(id, payload) {
    const site = await this.siteRepo.findById(id);
    if (!site) {
      throw new AppError("Update karne ke liye site exist nahi karti.", 404);
    }
    await site.update(payload);
    return site;
  }

  /** Soft delete (Site model is paranoid). */
  async remove(id) {
    const site = await this.siteRepo.findById(id);
    if (!site) {
      throw new AppError(
        "Site pehle se hi deleted hai ya exist nahi karti.",
        404,
      );
    }
    await site.destroy();
    return { id };
  }
}

module.exports = SiteService;
