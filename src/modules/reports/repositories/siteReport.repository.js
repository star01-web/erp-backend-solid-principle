const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * SiteReportRepository - Repository for generating Site-Wise Material Reports.
 *
 * Encapsulates optimized database aggregate queries using Sequelize raw SQL / ORM.
 */
class SiteReportRepository extends BaseRepository {
  constructor() {
    super(db.SiteDispatchLog);
  }

  /**
   * Generates Site Wise Material Summary aggregated data.
   *
   * @param {Object} filters
   * @param {string} [filters.siteId]
   * @param {string} [filters.productId]
   * @param {string} [filters.manufacturerId]
   * @param {string} [filters.fromDate]
   * @param {string} [filters.toDate]
   * @returns {Promise<Array>} Array of aggregated summary records
   */
  async getSiteMaterialSummary(filters = {}) {
    const { siteId, productId, manufacturerId, fromDate, toDate } = filters;

    // 1. Fetch dispatch and return movement aggregations from SiteDispatchLog
    let dateWhereClause = "";
    const replacements = {};

    if (siteId) {
      dateWhereClause += " AND l.site_id = :siteId";
      replacements.siteId = siteId;
    }
    if (productId) {
      dateWhereClause += " AND l.item_id = :productId";
      replacements.productId = productId;
    }
    if (fromDate) {
      dateWhereClause += " AND l.transaction_date >= :fromDate";
      replacements.fromDate = fromDate;
    }
    if (toDate) {
      dateWhereClause += " AND l.transaction_date <= :toDate";
      replacements.toDate = toDate;
    }

    const movementsQuery = `
      SELECT 
        l.item_id AS productId,
        p.name AS productName,
        p.base_uom AS uom,
        SUM(CASE WHEN l.transaction_type = 'DISPATCH' THEN l.base_quantity ELSE 0 END) AS issued,
        SUM(CASE WHEN l.transaction_type = 'RETURN' THEN l.base_quantity ELSE 0 END) AS returned
      FROM inventory_site_dispatch_logs l
      INNER JOIN inventory_products p ON p.id = l.item_id
      WHERE 1=1 ${dateWhereClause}
      GROUP BY l.item_id, p.name, p.base_uom
    `;

    const movements = await db.sequelize.query(movementsQuery, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    });

    // 2. Fetch live site stock balances from inventory_site_stock_levels
    let stockWhereClause = "";
    const stockReplacements = {};
    if (siteId) {
      stockWhereClause += " AND s.siteId = :siteId";
      stockReplacements.siteId = siteId;
    }
    if (productId) {
      stockWhereClause += " AND s.ProductId = :productId";
      stockReplacements.productId = productId;
    }
    if (manufacturerId) {
      stockWhereClause += " AND s.manufacturer_id = :manufacturerId";
      stockReplacements.manufacturerId = manufacturerId;
    }

    const stockQuery = `
      SELECT 
        s.ProductId AS productId,
        s.manufacturer_id AS manufacturerId,
        m.name AS manufacturerName,
        SUM(s.inHandQty) AS currentSiteStock
      FROM inventory_site_stock_levels s
      LEFT JOIN inventory_partners m ON m.id = s.manufacturer_id
      WHERE 1=1 ${stockWhereClause}
      GROUP BY s.ProductId, s.manufacturer_id, m.name
    `;

    const stockLevels = await db.sequelize.query(stockQuery, {
      replacements: stockReplacements,
      type: db.Sequelize.QueryTypes.SELECT,
    });

    // 3. Fetch product manufacturer relationships as fallback
    let productPartnerQuery = `
      SELECT 
        pm.ProductId AS productId,
        p.id AS manufacturerId,
        p.name AS manufacturerName
      FROM product_manufacturers pm
      INNER JOIN inventory_partners p ON p.id = pm.PartnerId
    `;
    if (manufacturerId) {
      productPartnerQuery += ` WHERE pm.PartnerId = :manufacturerId`;
    }
    const productPartners = await db.sequelize.query(productPartnerQuery, {
      replacements: { manufacturerId },
      type: db.Sequelize.QueryTypes.SELECT,
    });

    // Build lookup maps for stock levels and manufacturers
    const stockMap = new Map();
    for (const row of stockLevels) {
      const key = `${row.productId}`;
      if (!stockMap.has(key)) {
        stockMap.set(key, []);
      }
      stockMap.get(key).push(row);
    }

    const productPartnerMap = new Map();
    for (const row of productPartners) {
      if (!productPartnerMap.has(row.productId)) {
        productPartnerMap.set(row.productId, []);
      }
      productPartnerMap.get(row.productId).push(row);
    }

    // 4. Merge movement data with manufacturer & site stock data
    const resultMap = new Map();

    // Process movements
    for (const m of movements) {
      const prodId = m.productId;
      const stocks = stockMap.get(prodId) || [];
      const partners = productPartnerMap.get(prodId) || [];

      let manufacturerName = "N/A";
      let stockQty = 0;

      if (stocks.length > 0) {
        manufacturerName = [...new Set(stocks.map((s) => s.manufacturerName || "N/A"))].join(", ");
        stockQty = stocks.reduce((sum, s) => sum + Number(s.currentSiteStock || 0), 0);
      } else if (partners.length > 0) {
        manufacturerName = partners.map((p) => p.manufacturerName).join(", ");
      }

      // Filter by manufacturerId if provided
      if (manufacturerId) {
        const matchesStock = stocks.some((s) => s.manufacturerId === manufacturerId);
        const matchesPartner = partners.some((p) => p.manufacturerId === manufacturerId);
        if (!matchesStock && !matchesPartner) {
          continue; // Skip if filter doesn't match
        }
      }

      const issued = Number(m.issued || 0);
      const returned = Number(m.returned || 0);
      const currentSiteStock = Number(stockQty);
      const consumed = Math.max(0, issued - returned - currentSiteStock);

      resultMap.set(prodId, {
        productId: prodId,
        product: m.productName,
        manufacturer: manufacturerName,
        issued,
        returned,
        consumed,
        currentSiteStock,
        uom: m.uom || "pcs",
      });
    }

    // Include stock level rows if there were no movements in date range but site holds stock
    for (const [prodId, stocks] of stockMap.entries()) {
      if (resultMap.has(prodId)) continue;
      if (productId && prodId !== productId) continue;

      const product = await db.Product.findByPk(prodId, {
        attributes: ["id", "name", "base_uom"],
        raw: true,
      });

      if (!product) continue;

      const manufacturerName = stocks
        .map((s) => s.manufacturerName || "N/A")
        .join(", ");
      const currentSiteStock = stocks.reduce(
        (sum, s) => sum + Number(s.currentSiteStock || 0),
        0,
      );

      resultMap.set(prodId, {
        productId: prodId,
        product: product.name,
        manufacturer: manufacturerName || "N/A",
        issued: 0,
        returned: 0,
        consumed: 0,
        currentSiteStock,
        uom: product.base_uom || "pcs",
      });
    }

    // Convert map to array and sort by Product ASC
    const rows = Array.from(resultMap.values());
    rows.sort((a, b) => a.product.localeCompare(b.product));

    return rows;
  }

  /**
   * Helper to resolve site details by siteId or projectId.
   */
  async getSiteInfo(siteId) {
    if (!siteId) return null;
    const site = await db.Site.findByPk(siteId, { raw: true });
    if (site) return site;

    // Cross-module resolution with ProjectSite
    const projSite = await db.ProjectSite.findByPk(siteId, { raw: true }).catch(() => null);
    if (projSite?.locationName) {
      return db.Site.findOne({
        where: { site_name: projSite.locationName },
        raw: true,
      });
    }
    return null;
  }
}

module.exports = SiteReportRepository;
