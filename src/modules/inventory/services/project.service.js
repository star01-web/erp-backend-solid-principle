const AppError = require("../../../common/AppError");
const { Op } = require("sequelize");

class ProjectService {
  constructor({ projectRepository, projectStockRepository, siteRepository, sequelize }) {
    this.projectRepo = projectRepository;
    this.projectStockRepo = projectStockRepository;
    this.siteRepo = siteRepository;
    this.sequelize = sequelize;
  }

  async createProject(data) {
    // Check duplicate name
    const existing = await this.projectRepo.findOne({
      where: { project_name: data.project_name.trim() },
    });
    if (existing) {
      throw new AppError("Project with this name already exists", 400);
    }
    return this.projectRepo.create(data);
  }

  async getAllProjects(query = {}) {
    const where = {};
    if (query.is_active !== undefined) {
      where.is_active = query.is_active === "true" || query.is_active === true;
    }
    if (query.search) {
      where[Op.or] = [
        { project_name: { [Op.like]: `%${query.search}%` } },
        { project_code: { [Op.like]: `%${query.search}%` } },
        { client_name: { [Op.like]: `%${query.search}%` } },
      ];
    }
    return this.projectRepo.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });
  }

  async getProjectById(id) {
    const project = await this.projectRepo.findById(id, {
      include: [
        {
          association: "sites",
          attributes: ["id", "site_name", "manager_name", "contact_number", "is_active"],
        },
      ],
    });
    if (!project) {
      throw new AppError("Project not found", 404);
    }
    return project;
  }

  async updateProject(id, data) {
    const project = await this.getProjectById(id);

    if (data.project_name && data.project_name.trim() !== project.project_name) {
      const existing = await this.projectRepo.findOne({
        where: {
          project_name: data.project_name.trim(),
          id: { [Op.ne]: id },
        },
      });
      if (existing) {
        throw new AppError("Another project with this name already exists", 400);
      }
    }

    return this.projectRepo.update(id, data);
  }

  async toggleProjectStatus(id) {
    const project = await this.getProjectById(id);
    const newStatus = !project.is_active;
    await this.projectRepo.update(id, { is_active: newStatus });
    return { id, is_active: newStatus };
  }

  async getProjectStock(projectId) {
    await this.getProjectById(projectId); // verify existence
    return this.projectStockRepo.getStockByProject(projectId);
  }

  async getProjectSites(projectId) {
    await this.getProjectById(projectId);
    return this.siteRepo.findAll({
      where: { project_id: projectId },
      order: [["site_name", "ASC"]],
    });
  }
}

module.exports = ProjectService;
