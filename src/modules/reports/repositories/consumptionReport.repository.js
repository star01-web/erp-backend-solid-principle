const BaseRepository = require("../../../common/BaseRepository");
const db = require("../../../common/index.db");

/**
 * ConsumptionReportRepository - Database aggregation queries for Project & Site Consumption.
 */
class ConsumptionReportRepository extends BaseRepository {
  constructor() {
    super(db.SiteDispatchLog);
  }

  /**
   * Project-Wise Consumption Aggregation Report
   */
  async getProjectConsumptionReport({ projectId, fromDate, toDate } = {}) {
    const replacements = {};
    let projectFilter = "";
    if (projectId) {
      projectFilter = " WHERE p.id = :projectId ";
      replacements.projectId = projectId;
    }

    const projects = await db.sequelize.query(
      `SELECT id, project_name, project_code FROM inventory_projects p ${projectFilter} ORDER BY p.project_name ASC`,
      { replacements, type: db.Sequelize.QueryTypes.SELECT }
    );

    const reportRows = [];

    for (const proj of projects) {
      const projId = proj.id;
      const projReplacements = { projId };
      let dateFilterOpening = " AND l.transaction_date < :fromDate ";
      let dateFilterRange = "";

      if (fromDate) {
        projReplacements.fromDate = fromDate;
      }
      if (toDate) {
        dateFilterRange += " AND l.transaction_date <= :toDate ";
        projReplacements.toDate = toDate;
      }
      if (fromDate && toDate) {
        dateFilterRange += " AND l.transaction_date >= :fromDate ";
      }

      // 1. Warehouse Outward to Project
      let whOutwardQuery = `
        SELECT 
          SUM(CASE WHEN t.created_at < :fromDate THEN t.base_quantity ELSE 0 END) AS openingReceived,
          SUM(CASE WHEN 1=1 ${dateFilterRange} THEN t.base_quantity ELSE 0 END) AS received
        FROM inventory_transactions t
        WHERE t.project_id = :projId AND t.type = 'OUTWARD' AND t.deletedAt IS NULL
      `;

      if (!fromDate) {
        whOutwardQuery = `
          SELECT 
            0 AS openingReceived,
            SUM(t.base_quantity) AS received
          FROM inventory_transactions t
          WHERE t.project_id = :projId AND t.type = 'OUTWARD' AND t.deletedAt IS NULL ${dateFilterRange}
        `;
      }

      const [whOutward] = await db.sequelize.query(whOutwardQuery, {
        replacements: projReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      });

      // 2. Dispatches to Sites and Returns from Sites
      let siteLogQuery = `
        SELECT 
          SUM(CASE WHEN l.transaction_type = 'DISPATCH' AND l.transaction_date < :fromDate THEN l.base_quantity ELSE 0 END) AS openingDispatched,
          SUM(CASE WHEN l.transaction_type = 'RETURN' AND l.transaction_date < :fromDate THEN l.base_quantity ELSE 0 END) AS openingReturned,
          SUM(CASE WHEN l.transaction_type = 'DISPATCH' ${dateFilterRange} THEN l.base_quantity ELSE 0 END) AS distributed,
          SUM(CASE WHEN l.transaction_type = 'RETURN' ${dateFilterRange} THEN l.base_quantity ELSE 0 END) AS returned
        FROM inventory_site_dispatch_logs l
        WHERE l.project_id = :projId
      `;

      if (!fromDate) {
        siteLogQuery = `
          SELECT 
            0 AS openingDispatched,
            0 AS openingReturned,
            SUM(CASE WHEN l.transaction_type = 'DISPATCH' THEN l.base_quantity ELSE 0 END) AS distributed,
            SUM(CASE WHEN l.transaction_type = 'RETURN' THEN l.base_quantity ELSE 0 END) AS returned
          FROM inventory_site_dispatch_logs l
          WHERE l.project_id = :projId ${dateFilterRange}
        `;
      }

      const [siteLogs] = await db.sequelize.query(siteLogQuery, {
        replacements: projReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      });

      const openingRec = Number(whOutward?.openingReceived || 0);
      const openingDisp = Number(siteLogs?.openingDispatched || 0);
      const openingRet = Number(siteLogs?.openingReturned || 0);

      const openingStock = Math.max(0, openingRec - openingDisp + openingRet);
      const received = Number(whOutward?.received || 0);
      const distributed = Number(siteLogs?.distributed || 0);
      const returned = Number(siteLogs?.returned || 0);

      const consumed = Math.max(0, distributed - returned);
      const closingStock = Math.max(0, openingStock + received - distributed + returned);

      reportRows.push({
        projectId: proj.id,
        projectName: proj.project_name,
        projectCode: proj.project_code || "N/A",
        openingStock,
        receivedFromWarehouse: received,
        distributedToSites: distributed,
        returnedFromSites: returned,
        consumed,
        closingStock,
      });
    }

    return reportRows;
  }

  /**
   * Site-Wise Consumption Aggregation Report
   */
  async getSiteConsumptionReport({ siteId, projectId, fromDate, toDate } = {}) {
    const replacements = {};
    let whereClause = " WHERE 1=1 ";

    if (siteId) {
      whereClause += " AND s.id = :siteId ";
      replacements.siteId = siteId;
    }
    if (projectId) {
      whereClause += " AND s.project_id = :projectId ";
      replacements.projectId = projectId;
    }

    const sites = await db.sequelize.query(
      `SELECT s.id, s.site_name, s.project_id, p.project_name 
       FROM inventory_sites s 
       LEFT JOIN inventory_projects p ON p.id = s.project_id 
       ${whereClause} 
       ORDER BY s.site_name ASC`,
      { replacements, type: db.Sequelize.QueryTypes.SELECT }
    );

    const reportRows = [];

    for (const site of sites) {
      const sId = site.id;
      const siteReplacements = { sId };

      let dateFilterOpening = " AND l.transaction_date < :fromDate ";
      let dateFilterRange = "";

      if (fromDate) {
        siteReplacements.fromDate = fromDate;
      }
      if (toDate) {
        dateFilterRange += " AND l.transaction_date <= :toDate ";
        siteReplacements.toDate = toDate;
      }
      if (fromDate && toDate) {
        dateFilterRange += " AND l.transaction_date >= :fromDate ";
      }

      let query = `
        SELECT 
          SUM(CASE WHEN l.transaction_type = 'DISPATCH' AND l.transaction_date < :fromDate THEN l.base_quantity ELSE 0 END) AS openingReceived,
          SUM(CASE WHEN l.transaction_type = 'RETURN' AND l.transaction_date < :fromDate THEN l.base_quantity ELSE 0 END) AS openingReturned,
          SUM(CASE WHEN l.transaction_type = 'DISPATCH' ${dateFilterRange} THEN l.base_quantity ELSE 0 END) AS received,
          SUM(CASE WHEN l.transaction_type = 'RETURN' ${dateFilterRange} THEN l.base_quantity ELSE 0 END) AS returned
        FROM inventory_site_dispatch_logs l
        WHERE l.site_id = :sId
      `;

      if (!fromDate) {
        query = `
          SELECT 
            0 AS openingReceived,
            0 AS openingReturned,
            SUM(CASE WHEN l.transaction_type = 'DISPATCH' THEN l.base_quantity ELSE 0 END) AS received,
            SUM(CASE WHEN l.transaction_type = 'RETURN' THEN l.base_quantity ELSE 0 END) AS returned
          FROM inventory_site_dispatch_logs l
          WHERE l.site_id = :sId ${dateFilterRange}
        `;
      }

      const [logs] = await db.sequelize.query(query, {
        replacements: siteReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      });

      // Get current live site stock balance
      const [liveStock] = await db.sequelize.query(
        `SELECT SUM(inHandQty) AS inHand FROM inventory_site_stock_levels WHERE siteId = :sId`,
        { replacements: { sId }, type: db.Sequelize.QueryTypes.SELECT }
      );

      const openingRec = Number(logs?.openingReceived || 0);
      const openingRet = Number(logs?.openingReturned || 0);

      const openingStock = Math.max(0, openingRec - openingRet);
      const received = Number(logs?.received || 0);
      const returned = Number(logs?.returned || 0);
      const currentStock = Number(liveStock?.inHand || 0);

      const consumed = Math.max(0, openingStock + received - returned - currentStock);
      const closingStock = currentStock;

      reportRows.push({
        siteId: site.id,
        siteName: site.site_name,
        projectId: site.project_id || null,
        projectName: site.project_name || "Unassigned Project",
        openingStock,
        receivedFromProject: received,
        returnedToProject: returned,
        consumed,
        closingStock,
      });
    }

    return reportRows;
  }
}

module.exports = ConsumptionReportRepository;
