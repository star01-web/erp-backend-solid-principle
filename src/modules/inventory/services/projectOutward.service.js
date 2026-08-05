const AppError = require("../../../common/AppError");
const uomService = require("./uom.service");
const db = require("../../../common/index.db");

const round3 = (val) => Math.round(Number(val) * 1000) / 1000;

class ProjectOutwardService {
  constructor({ projectStockRepository, projectRepository, sequelize }) {
    this.projectStockRepo = projectStockRepository;
    this.projectRepo = projectRepository;
    this.sequelize = sequelize || db.sequelize;
  }

  async processProjectOutward({
    warehouse_id,
    project_id,
    item_id,
    quantity,
    uom,
    manufacturer_id,
    color,
    reference_no,
    remarks,
    created_by,
  }) {
    return this.sequelize.transaction(async (t) => {
      // 1. Verify Project
      const project = await db.Project.findByPk(project_id, { transaction: t });
      if (!project || !project.is_active) {
        throw new AppError("Target Project not found or inactive", 400);
      }

      // 2. Verify Warehouse
      const warehouse = await db.Warehouse.findByPk(warehouse_id, { transaction: t });
      if (!warehouse || !warehouse.is_active) {
        throw new AppError("Source Warehouse not found or inactive", 400);
      }

      // 3. Verify Product
      const product = await db.Product.findByPk(item_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product || !product.is_active) {
        throw new AppError("Product not found or inactive", 400);
      }

      // 4. UOM Conversion
      const numQty = Number(quantity);
      if (isNaN(numQty) || numQty <= 0) {
        throw new AppError("Quantity must be a positive number", 400);
      }

      const uomInfo = uomService.toBaseQuantity(product, numQty, uom);
      const baseQty = uomInfo.baseQty;

      // 5. Find and lock Warehouse StockLevel variant buckets
      const variantWhere = { ProductId: item_id, WarehouseId: warehouse_id };
      if (manufacturer_id) variantWhere.manufacturer_id = manufacturer_id;
      if (color) variantWhere.color = color;

      const stockRows = await db.StockLevel.findAll({
        where: variantWhere,
        order: [["current_quantity", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const totalAvailable = round3(
        stockRows.reduce((sum, r) => sum + Number(r.current_quantity), 0)
      );

      if (totalAvailable < baseQty) {
        throw new AppError(
          `Insufficient warehouse stock. Available: ${totalAvailable} ${product.base_uom || ""}, Requested: ${numQty} ${uomInfo.uom} (= ${baseQty} base units)`,
          400
        );
      }

      // 6. Greedy drain warehouse stock buckets
      let remaining = baseQty;
      for (const row of stockRows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(row.current_quantity), remaining);
        await row.update(
          {
            current_quantity: round3(Number(row.current_quantity) - take),
            last_updated_at: new Date(),
          },
          { transaction: t }
        );
        remaining = round3(remaining - take);
      }

      const logManufacturerId = manufacturer_id || stockRows[0]?.manufacturer_id || null;
      const logColor = color || stockRows[0]?.color || "Standard";

      // 7. Increment ProjectStockLevel
      let projStock = await this.projectStockRepo.findForUpdate(
        {
          projectId: project_id,
          productId: item_id,
          manufacturerId: logManufacturerId,
          color: logColor,
        },
        t
      );

      if (!projStock) {
        projStock = await this.projectStockRepo.createForProject(
          {
            projectId: project_id,
            productId: item_id,
            manufacturerId: logManufacturerId,
            color: logColor,
          },
          baseQty,
          t
        );
      } else {
        await projStock.update(
          {
            current_quantity: round3(Number(projStock.current_quantity) + baseQty),
            last_updated_at: new Date(),
          },
          { transaction: t }
        );
      }

      // 8. Create StockTransaction audit log
      const txLog = await db.StockTransaction.create(
        {
          type: "OUTWARD",
          ProductId: item_id,
          WarehouseId: warehouse_id,
          project_id: project_id,
          manufacturer_id: logManufacturerId,
          quantity: numQty,
          uom: uomInfo.uom,
          conversion_factor: uomInfo.factor,
          base_quantity: baseQty,
          reference_no: reference_no || `PROJ_OUT_${Date.now()}`,
          remarks: remarks || `Warehouse outward to project ${project.project_name}`,
          created_by: created_by,
        },
        { transaction: t }
      );

      const result = {
        transactionId: txLog.id,
        project_id: project_id,
        project_name: project.project_name,
        warehouse_id: warehouse_id,
        warehouse_name: warehouse.name,
        product_id: item_id,
        product_name: product.name,
        quantity: numQty,
        uom: uomInfo.uom,
        base_quantity: baseQty,
        base_uom: product.base_uom,
        project_stock_after: projStock.current_quantity,
      };

      // Invalidate Redis Caches for projects and reports
      const redisClient = require("../../../common/redis.client");
      redisClient.delPattern("cache:*").catch(() => {});

      return result;
    });
  }
}

module.exports = ProjectOutwardService;
