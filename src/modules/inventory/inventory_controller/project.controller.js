const AppError = require("../../../common/AppError");

class ProjectController {
  constructor({ projectService }) {
    this.service = projectService;
  }

  _fail(res, error, fallbackMessage, next = null) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    console.error(`${fallbackMessage}:`, error);
    if (typeof next === "function") return next(error);
    return res.status(500).json({
      success: false,
      message: fallbackMessage,
      error: process.env.NODE_ENV === "production" ? "Internal Server Error" : error.message,
    });
  }

  createProject = async (req, res, next) => {
    try {
      const project = await this.service.createProject(req.body);
      return res.status(201).json({
        success: true,
        message: "Project created successfully",
        data: project,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to create project", next);
    }
  };

  getAllProjects = async (req, res, next) => {
    try {
      const projects = await this.service.getAllProjects(req.query);
      return res.status(200).json({
        success: true,
        count: projects.length,
        data: projects,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to fetch projects", next);
    }
  };

  getProjectById = async (req, res, next) => {
    try {
      const project = await this.service.getProjectById(req.params.id);
      return res.status(200).json({
        success: true,
        data: project,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to fetch project detail", next);
    }
  };

  updateProject = async (req, res, next) => {
    try {
      const project = await this.service.updateProject(req.params.id, req.body);
      return res.status(200).json({
        success: true,
        message: "Project updated successfully",
        data: project,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to update project", next);
    }
  };

  toggleStatus = async (req, res, next) => {
    try {
      const result = await this.service.toggleProjectStatus(req.params.id);
      return res.status(200).json({
        success: true,
        message: `Project status changed to ${result.is_active ? "Active" : "Inactive"}`,
        data: result,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to toggle project status", next);
    }
  };

  getProjectStock = async (req, res, next) => {
    try {
      const stock = await this.service.getProjectStock(req.params.id);
      return res.status(200).json({
        success: true,
        count: stock.length,
        data: stock,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to fetch project stock", next);
    }
  };

  getProjectSites = async (req, res, next) => {
    try {
      const sites = await this.service.getProjectSites(req.params.id);
      return res.status(200).json({
        success: true,
        count: sites.length,
        data: sites,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to fetch project sites", next);
    }
  };
}

module.exports = ProjectController;
