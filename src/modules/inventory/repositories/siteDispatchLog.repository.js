const { fn, literal, Op } = require("sequelize");
const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * Data access for the Site Dispatch ledger (`inventory_site_dispatch_logs`).
 *
 * Extends BaseRepository (generic CRUD) and adds domain-specific queries
 * for material movement logging and consumption aggregation.
 * 
 * Keeping the raw SQL/aggregation HERE — not in the service — preserves the SRP split: 
 * the repository owns "how data is fetched/stored", the service owns "what the numbers mean".
 */
class SiteDispatchLogRepository extends BaseRepository {
  constructor() {
    // Assuming BaseRepository accepts the Sequelize model instance
    super(db.SiteDispatchLog);
  }

  /**
   * 1. Transaction-safe Outward Dispatch Logging
   * Automatically injects 'DISPATCH' transaction_type.
   *
   * @param {Object} logData - { site_id, item_id, quantity, uom, base_quantity, remarks, created_by }
   * @param {Object} options - Sequelize options (must include { transaction: t })
   */
  async logDispatch(logData, options = {}) {
    return this.create(
      {
        ...logData,
        transaction_type: "DISPATCH",
        transaction_date: logData.transaction_date || new Date(),
      },
      options,
    );
  }

  /**
   * 2. Transaction-safe Material Return Logging
   * Automatically injects 'RETURN' transaction_type for inward flows from site.
   *
   * @param {Object} logData - { site_id, item_id, quantity, uom, base_quantity, remarks, created_by }
   * @param {Object} options - Sequelize options (must include { transaction: t })
   */
  async logReturn(logData, options = {}) {
    return this.create(
      {
        ...logData,
        transaction_type: "RETURN",
        transaction_date: logData.transaction_date || new Date(),
      },
      options,
    );
  }

  /**
   * 3. EXISTING & POLISHED: Net consumption for one site, aggregated per item in a SINGLE grouped query.
   * No raw ledger rows are ever pulled into Node.
   *
   * IMPORTANT: all sums are on `base_quantity` (already normalised to the item's
   * base UOM), NOT the entered `quantity` — so movements entered in Bundle and
   * in Meter aggregate correctly against one another.
   *
   * The pivot uses conditional SUM(CASE WHEN …) so one pass over the ledger yields both directions:
   *   SUM(CASE WHEN transaction_type='DISPATCH' THEN base_quantity ELSE 0 END) -> total_dispatched
   *   SUM(CASE WHEN transaction_type='RETURN'   THEN base_quantity ELSE 0 END) -> total_returned
   *   (dispatched) - (returned)                                                -> net_consumed_in_base_uom
   */
  getConsumptionBySite(siteId, options = {}) {
    return this.model.findAll({
      where: { site_id: siteId },
      attributes: [
        "item_id",
        [
          fn(
            "SUM",
            literal(
              "CASE WHEN transaction_type = 'DISPATCH' THEN base_quantity ELSE 0 END"
            )
          ),
          "total_dispatched",
        ],
        [
          fn(
            "SUM",
            literal(
              "CASE WHEN transaction_type = 'RETURN' THEN base_quantity ELSE 0 END"
            )
          ),
          "total_returned",
        ],
        [
          literal(
            "SUM(CASE WHEN transaction_type = 'DISPATCH' THEN base_quantity ELSE 0 END) - " +
              "SUM(CASE WHEN transaction_type = 'RETURN' THEN base_quantity ELSE 0 END)"
          ),
          "net_consumed_in_base_uom",
        ],
      ],
      include: [
        // item_name + base_uom (from inventory_products)
        { model: db.Product, as: "item", attributes: ["name", "base_uom"] },
        // project_name + site_name (from inventory_sites)
        {
          model: db.Site,
          as: "site",
          attributes: ["project_name", "site_name"],
        },
      ],
      // Every non-aggregated selected column is grouped to satisfy MySQL's ONLY_FULL_GROUP_BY mode.
      group: [
        "SiteDispatchLog.item_id",
        "item.id",
        "item.name",
        "item.base_uom",
        "site.id",
        "site.project_name",
        "site.site_name",
      ],
      order: [[literal("net_consumed_in_base_uom"), "DESC"]], // heaviest consumers first
      raw: true,
      nest: true,
      ...options,
    });
  }

  /**
   * 4. Fetch Ledger History with populated Site & Product (Item) details.
   */
  async getDispatchLogs(filters = {}, options = {}) {
    const where = {};
    if (filters.siteId) where.site_id = filters.siteId;
    if (filters.itemId) where.item_id = filters.itemId;

    if (filters.transaction_type) {
      const tType = String(filters.transaction_type).trim().toUpperCase();
      if (tType === "OUTWARD" || tType === "DISPATCH" || tType === "OUT") {
        where.transaction_type = "DISPATCH";
      } else if (tType === "RETURN" || tType === "INWARD" || tType === "IN") {
        where.transaction_type = "RETURN";
      } else if (tType !== "ALL") {
        where.transaction_type = tType;
      }
    }

    if (filters.startDate || filters.endDate) {
      where.transaction_date = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        if (!isNaN(start.getTime())) {
          start.setUTCHours(0, 0, 0, 0);
          where.transaction_date[Op.gte] = start;
        }
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        if (!isNaN(end.getTime())) {
          end.setUTCHours(23, 59, 59, 999);
          where.transaction_date[Op.lte] = end;
        }
      }
    }

    if (filters.search) {
      const searchClean = String(filters.search).trim().replace(/[%_\\]/g, "\\$&");
      if (searchClean) {
        where[Op.or] = [
          { reference_no: { [Op.like]: `%${searchClean}%` } },
          { remarks: { [Op.like]: `%${searchClean}%` } },
          { "$site.site_name$": { [Op.like]: `%${searchClean}%` } },
          { "$item.name$": { [Op.like]: `%${searchClean}%` } },
          { "$item.sku_code$": { [Op.like]: `%${searchClean}%` } },
        ];
      }
    }

    const queryConfig = {
      where,
      include: [
        {
          model: db.Site,
          as: "site",
          attributes: ["id", "site_name", "project_name"],
        },
        {
          model: db.Product,
          as: "item",
          attributes: ["id", "name", "sku_code", "base_uom"],
        },
      ],
      order: [["transaction_date", "DESC"], ["createdAt", "DESC"]],
      ...options,
    };

    if (options.limit !== undefined) {
      return this.model.findAndCountAll({
        ...queryConfig,
        distinct: true,
        col: "log_id",
      });
    }

    return this.model.findAll(queryConfig);
  }

  /**
   * 5. Fetch Ledger History for a specific Site & Item (Useful for stock audit)
   */
  getSiteItemLedger(siteId, itemId, options = {}) {
    return this.model.findAll({
      where: { site_id: siteId, item_id: itemId },
      order: [["createdAt", "DESC"]],
      raw: true,
      ...options,
    });
  }
}

module.exports = SiteDispatchLogRepository;