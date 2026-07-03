const AppError = require("../../../common/AppError");

/**
 * Office location business logic (geofence master data).
 */
class OfficeLocationService {
  constructor({ officeLocationRepository }) {
    this.officeRepo = officeLocationRepository;
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

    const newLocation = await this.officeRepo.create({
      locationName,
      latitude,
      longitude,
      radiusInMeters: radiusInMeters || 100,
    });

    return {
      id: newLocation.id,
      name: newLocation.locationName,
      coords: [newLocation.latitude, newLocation.longitude],
    };
  }

  async getAll() {
    const locations = await this.officeRepo.findAll(
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
    if (locations.length === 0) {
      // Preserves the original Spanish 404 message
      throw new AppError("No se encontraron ubicaciones.", 404);
    }
    return locations;
  }

  async update(id, { locationName, latitude, longitude, radiusInMeters }) {
    const location = await this.officeRepo.findById(id);
    if (!location) {
      throw new AppError("Office location not found.", 404);
    }
    if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
      throw new AppError("Invalid latitude.", 400);
    }
    if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
      throw new AppError("Invalid longitude.", 400);
    }

    await location.update({
      locationName: locationName || location.locationName,
      latitude: latitude !== undefined ? latitude : location.latitude,
      longitude: longitude !== undefined ? longitude : location.longitude,
      radiusInMeters:
        radiusInMeters !== undefined ? radiusInMeters : location.radiusInMeters,
    });

    return location;
  }

  async remove(id) {
    const deletedRows = await this.officeRepo.destroy({ id });
    if (deletedRows === 0) {
      throw new AppError(
        "No se encontró la ubicación de la oficina con el ID proporcionado.",
        404,
      );
    }
    return { id };
  }
}

module.exports = OfficeLocationService;
