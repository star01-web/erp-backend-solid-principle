const AppError = require("../../../common/AppError");

/**
 * HTTP layer for project sites. Preserves each endpoint's exact envelope
 * (including the mixed English/Spanish messages from the original controller).
 */
class ProjectSiteController {
  constructor({ projectSiteService }) {
    this.service = projectSiteService;
  }

  createProjectSite = async (req, res) => {
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
        message: "Project Site created successfully",
        data,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Error creating project site:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create project site",
        error: error.message,
      });
    }
  };

  getAllProjectSites = async (req, res) => {
    try {
      const sites = await this.service.getAll();
      return res.status(200).json(sites);
    } catch (error) {
      if (error instanceof AppError)
        return res.status(error.statusCode).json({ message: error.message });
      console.error("Error al obtener ubicaciones:", error);
      return res
        .status(500)
        .json({ message: "Error interno del servidor", error: error.message });
    }
  };

  updateProjectSite = async (req, res) => {
    try {
      const { locationName, latitude, longitude, radiusInMeters } = req.body;
      const site = await this.service.update(req.params.id, {
        locationName,
        latitude,
        longitude,
        radiusInMeters,
      });
      return res.status(200).json({
        success: true,
        message: "Project site updated successfully",
        data: site,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Error updating project site:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update project site",
        error: error.message,
      });
    }
  };

  deleteProjectSite = async (req, res) => {
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
      console.error("Error en deleteProjectSite:", error);
      return res.status(500).json({
        success: false,
        message: "Error interno al intentar eliminar la ubicación.",
        error: error.message,
      });
    }
  };
}

module.exports = ProjectSiteController;
