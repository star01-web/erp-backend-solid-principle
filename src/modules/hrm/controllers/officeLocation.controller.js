const AppError = require("../../../common/AppError");

/**
 * HTTP layer for office locations. Preserves each endpoint's exact envelope
 * (including the mixed English/Spanish messages from the original controller).
 */
class OfficeLocationController {
  constructor({ officeLocationService }) {
    this.service = officeLocationService;
  }

  createOfficeLocation = async (req, res) => {
    try {
      const { locationName, latitude, longitude, radiusInMeters } = req.body;
      const data = await this.service.create({
        locationName,
        latitude,
        longitude,
        radiusInMeters,
      });
      return res.status(201).json({
        success: true,
        message: "Office Location created successfully",
        data,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Error creating office location:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create office location",
        error: error.message,
      });
    }
  };

  getAllLocations = async (req, res) => {
    try {
      const locations = await this.service.getAll();
      return res.status(200).json(locations);
    } catch (error) {
      if (error instanceof AppError)
        return res.status(error.statusCode).json({ message: error.message });
      console.error("Error al obtener ubicaciones:", error);
      return res
        .status(500)
        .json({ message: "Error interno del servidor", error: error.message });
    }
  };

  updateOfficeLocation = async (req, res) => {
    try {
      const { locationName, latitude, longitude, radiusInMeters } = req.body;
      const location = await this.service.update(req.params.id, {
        locationName,
        latitude,
        longitude,
        radiusInMeters,
      });
      return res.status(200).json({
        success: true,
        message: "Office location updated successfully",
        data: location,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Error updating location:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update location",
        error: error.message,
      });
    }
  };

  deleteOfficeLocation = async (req, res) => {
    try {
      const data = await this.service.remove(req.params.id);
      return res.status(200).json({
        success: true,
        message: "Ubicación eliminada correctamente.",
        data,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Error en deleteOfficeLocation:", error);
      return res.status(500).json({
        success: false,
        message: "Error interno al intentar eliminar la ubicación.",
        error: error.message,
      });
    }
  };
}

module.exports = OfficeLocationController;
