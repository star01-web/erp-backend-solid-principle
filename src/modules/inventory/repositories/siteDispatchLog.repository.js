const { fn, literal } = require("sequelize");
const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * Data access for the Site Dispatch ledger (`inventory_site_dispatch_logs`).
 *
 * Extends BaseRepository (generic CRUD) and adds the one domain-specific query
 * the reporting flow needs. Keeping the raw SQL/aggregation HERE — not in the
 * service — is the SRP split: the repository owns "how data is fetched", the
 * service owns "what the numbers mean".
 */
class SiteDispatchLogRepository extends BaseRepository {
  /**
   * Net consumption for one site, aggregated per item in a SINGLE grouped query.
   * No raw ledger rows are ever pulled into Node.
   *
   * IMPORTANT: all sums are on `base_quantity` (already normalised to the item's
   * base UOM), NOT the entered `quantity` — so movements entered in Bundle and
   * in Meter aggregate correctly against one another.
   *
   * The pivot uses conditional SUM(CASE WHEN …) so one pass over the ledger
   * yields both movement directions:
   *   SUM(CASE WHEN type='DISPATCH' THEN base_quantity ELSE 0 END) -> total_dispatched
   *   SUM(CASE WHEN type='RETURN'   THEN base_quantity ELSE 0 END) -> total_returned
   *   (dispatched) - (returned)                                    -> net_consumed_in_base_uom
   *
   * GROUP BY item_id collapses to one row per item; JOINs bring in item_name,
   * base_uom and the site's project_name. Indexes on (site_id) and (item_id)
   * keep this fast on large ledgers.
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
              "CASE WHEN transaction_type = 'DISPATCH' THEN base_quantity ELSE 0 END",
            ),
          ),
          "total_dispatched",
        ],
        [
          fn(
            "SUM",
            literal(
              "CASE WHEN transaction_type = 'RETURN' THEN base_quantity ELSE 0 END",
            ),
          ),
          "total_returned",
        ],
        [
          literal(
            "SUM(CASE WHEN transaction_type = 'DISPATCH' THEN base_quantity ELSE 0 END) - " +
              "SUM(CASE WHEN transaction_type = 'RETURN' THEN base_quantity ELSE 0 END)",
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
      // Every non-aggregated selected column must be grouped so the query stays
      // valid under MySQL's ONLY_FULL_GROUP_BY mode.
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
}

module.exports = SiteDispatchLogRepository;
