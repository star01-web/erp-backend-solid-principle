const AppError = require("../../../common/AppError");

/**
 * Project site business logic (geofence master data).
 */
class ProjectSiteService {
  constructor({ projectSiteRepository }) {
    this.siteRepo = projectSiteRepository;
  }

  async create({ locationName, latitude, longitude, radiusInMeters }) {
    if (!locationName || latitude === undefined || longitude === undefined) {
      throw new AppError(
        "locationName, latitude, and longitude are required.",
        400,
      );
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new AppError("Invalid coordinates provided.", 400);
    }

    const newSite = await this.siteRepo.create({
      locationName,
      latitude,
      longitude,
      radiusInMeters: radiusInMeters || 100,
    });

    return {
      id: newSite.id,
      name: newSite.locationName,
      coords: [newSite.latitude, newSite.longitude],
    };
  }

  async getAll() {
    const sites = await this.siteRepo.findAll(
      {},
      {
        attributes: [
          "id",
          "locationName",
          "latitude",
          "longitude",
          "radiusInMeters",
        ],
      },
    );
    if (sites.length === 0) {
      // Preserves the original Spanish 404 message
      throw new AppError("No se encontraron ubicaciones.", 404);
    }
    return sites;
  }

  async update(id, { locationName, latitude, longitude, radiusInMeters }) {
    const site = await this.siteRepo.findById(id);
    if (!site) {
      throw new AppError("Project site not found.", 404);
    }
    if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
      throw new AppError("Invalid latitude.", 400);
    }
    if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
      throw new AppError("Invalid longitude.", 400);
    }

    await site.update({
      locationName: locationName || site.locationName,
      latitude: latitude !== undefined ? latitude : site.latitude,
      longitude: longitude !== undefined ? longitude : site.longitude,
      radiusInMeters:
        radiusInMeters !== undefined ? radiusInMeters : site.radiusInMeters,
    });

    return site;
  }

  async remove(id) {
    const deletedRows = await this.siteRepo.destroy({ id });
    if (deletedRows === 0) {
      throw new AppError(
        "No se encontró la ubicación de la oficina con el ID proporcionado.",
        404,
      );
    }
    return { id };
  }
}

module.exports = ProjectSiteService;
