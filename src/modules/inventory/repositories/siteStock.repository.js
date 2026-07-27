const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * Data access for per-site stock balances (`inventory_site_stock_levels`).
 *
 * SRP: this repository owns HOW site stock rows are located, locked and read.
 * The DispatchService owns WHAT the numbers mean (validation, UOM math) and
 * the transaction lifecycle — every mutating call here receives the service's
 * transaction handle via `options`.
 *
 * Variant identity: the table's unique key is (siteId, ProductId,
 * manufacturer_id, color), so every lookup must use the SAME normalised
 * variant values or two "identical" movements would target different rows.
 */
class SiteStockRepository extends BaseRepository {
  constructor(model = db.SiteStockLevel) {
    super(model);
  }

  /** Normalise the optional variant part of the key so lookups are stable. */
  variantKey({ siteId, productId, manufacturerId, color }) {
    return {
      siteId,
      ProductId: productId,
      manufacturer_id: manufacturerId || null,
      color: color || "Standard",
    };
  }

  /**
   * Fetch ONE site-stock row under a row-level UPDATE lock (SELECT … FOR
   * UPDATE). Must be called inside a transaction; concurrent movements on the
   * same row will serialise here instead of double-spending the balance.
   */
  findForUpdate(key, transaction) {
    return this.model.findOne({
      where: this.variantKey(key),
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /** Create the first stock row for a (site, item, variant) bucket. */
  createForSite(key, inHandQty, transaction) {
    return this.model.create(
      { ...this.variantKey(key), inHandQty },
      { transaction },
    );
  }

  /**
   * Fetch EVERY variant bucket of one (site, product) under an UPDATE lock,
   * fullest first. Returns need this because dispatched stock can sit across
   * multiple (manufacturer_id, color) buckets — a single-bucket lookup on the
   * normalised (null, 'Standard') key misses them and reports 0 available.
   */
  findAllForProductForUpdate({ siteId, productId }, transaction) {
    return this.model.findAll({
      where: { siteId, ProductId: productId },
      order: [["inHandQty", "DESC"]], // fullest bucket first (greedy drain)
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /**
   * Site-specific stock visibility: every item currently held at one site,
   * with the product's name/UOM joined in for display.
   */
  getStockBySite(siteId, options = {}) {
    return this.model.findAll({
      where: { siteId },
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

module.exports = SiteStockRepository;
