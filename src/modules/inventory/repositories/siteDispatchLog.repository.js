const { fn, literal } = require("sequelize");
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
   * 1. NEW: Transaction-safe Outward Dispatch Logging
   * Automatically injects 'DISPATCH' transaction_type and handles UOM normalization.
   * 
   * @param {Object} logData - { site_id, item_id, quantity, base_quantity, challan_number, etc. }
   * @param {Object} options - Sequelize options (must include { transaction: t })
   */
  async logDispatch(logData, options = {}) {
    return this.create(
      {
        ...logData,
        transaction_type: "DISPATCH",
        dispatch_date: logData.dispatch_date || new Date(),
      },
      options
    );
  }

  /**
   * 2. NEW: Transaction-safe Material Return Logging
   * Automatically injects 'RETURN' transaction_type for inward flows from site.
   * 
   * @param {Object} logData - { site_id, item_id, quantity, base_quantity, return_challan, etc. }
   * @param {Object} options - Sequelize options (must include { transaction: t })
   */
  async logReturn(logData, options = {}) {
    return this.create(
      {
        ...logData,
        transaction_type: "RETURN",
        return_date: logData.return_date || new Date(),
      },
      options
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
        // project_name (from inventory_sites)
        { model: db.Site, as: "site", attributes: ["project_name", "name"] },
      ],
      // Every non-aggregated selected column is grouped to satisfy MySQL's ONLY_FULL_GROUP_BY mode.
      group: [
        "SiteDispatchLog.item_id",
        "item.id",
        "item.name",
        "item.base_uom",
        "site.id",
        "site.project_name",
        "site.name",
      ],
      order: [[literal("net_consumed_in_base_uom"), "DESC"]], // heaviest consumers first
      raw: true,
      nest: true,
      ...options,
    });
  }

  /**
   * 4. NEW: Fetch Ledger History for a specific Site & Item (Useful for stock audit)
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