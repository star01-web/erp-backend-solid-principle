const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * Data access for per-project stock balances (`inventory_project_stock_levels`).
 *
 * SRP: owns HOW project stock rows are located, locked, read, and updated.
 */
class ProjectStockRepository extends BaseRepository {
  constructor(model = db.ProjectStockLevel) {
    super(model);
  }

  /** Normalise variant key parameters. */
  variantKey({ projectId, productId, manufacturerId, color }) {
    return {
      project_id: projectId,
      ProductId: productId,
      manufacturer_id: manufacturerId || null,
      color: color || "Standard",
    };
  }

  /**
   * Fetch ONE project stock row under a row-level UPDATE lock.
   */
  findForUpdate(key, transaction) {
    return this.model.findOne({
      where: this.variantKey(key),
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /**
   * Create the first stock row for a (project, item, variant) bucket.
   */
  createForProject(key, current_quantity, transaction) {
    return this.model.create(
      { ...this.variantKey(key), current_quantity },
      { transaction }
    );
  }

  /**
   * Fetch ALL variant buckets for a (project, product) under UPDATE lock, fullest first.
   */
  findAllForProductForUpdate({ projectId, productId }, transaction) {
    return this.model.findAll({
      where: { project_id: projectId, ProductId: productId },
      order: [["current_quantity", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /**
   * Project stock visibility: items currently held at a project with Product info joined.
   */
  getStockByProject(projectId, options = {}) {
    return this.model.findAll({
      where: { project_id: projectId },
      include: [
        {
          model: db.Product,
          attributes: ["id", "name", "sku_code", "base_uom", "category"],
        },
      ],
      order: [["updatedAt", "DESC"]],
      ...options,
    });
  }
}

module.exports = ProjectStockRepository;
