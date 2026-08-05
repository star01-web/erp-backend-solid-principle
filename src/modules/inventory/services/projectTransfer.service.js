const AppError = require("../../../common/AppError");
const uomService = require("./uom.service");
const db = require("../../../common/index.db");

const round3 = (val) => Math.round(Number(val) * 1000) / 1000;

class ProjectTransferService {
  constructor({ projectStockRepository, projectRepository, sequelize }) {
    this.projectStockRepo = projectStockRepository;
    this.projectRepo = projectRepository;
    this.sequelize = sequelize || db.sequelize;
  }

  async transferBetweenProjects({
    source_project_id,
    target_project_id,
    item_id,
    quantity,
    uom,
    manufacturer_id,
    color,
    reference_no,
    remarks,
    created_by,
  }) {
    if (source_project_id === target_project_id) {
      throw new AppError("Source and target projects must be different", 400);
    }

    return this.sequelize.transaction(async (t) => {
      // 1. Verify Projects
      const [sourceProject, targetProject] = await Promise.all([
        db.Project.findByPk(source_project_id, { transaction: t }),
        db.Project.findByPk(target_project_id, { transaction: t }),
      ]);

      if (!sourceProject || !sourceProject.is_active) {
        throw new AppError("Source project not found or inactive", 400);
      }
      if (!targetProject || !targetProject.is_active) {
        throw new AppError("Target project not found or inactive", 400);
      }

      // 2. Verify Product
      const product = await db.Product.findByPk(item_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product || !product.is_active) {
        throw new AppError("Product not found or inactive", 400);
      }

      // 3. UOM conversion
      const numQty = Number(quantity);
      if (isNaN(numQty) || numQty <= 0) {
        throw new AppError("Quantity must be a positive number", 400);
      }

      const uomInfo = uomService.toBaseQuantity(product, numQty, uom);
      const baseQty = uomInfo.baseQty;

      // 4. Lock & Drain Source Project Stock
      const stockRows = await this.projectStockRepo.findAllForProductForUpdate(
        { projectId: source_project_id, productId: item_id },
        t
      );

      const filteredRows = stockRows.filter((r) => {
        if (manufacturer_id && r.manufacturer_id !== manufacturer_id) return false;
        if (color && r.color !== color) return false;
        return true;
      });

      const totalAvailable = round3(
        filteredRows.reduce((sum, r) => sum + Number(r.current_quantity), 0)
      );

      if (totalAvailable < baseQty) {
        throw new AppError(
          `Insufficient source project stock. Available: ${totalAvailable} ${product.base_uom || ""}, Requested: ${numQty} ${uomInfo.uom} (= ${baseQty} base units)`,
          400
        );
      }

      let remaining = baseQty;
      for (const row of filteredRows) {
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

      const logManufacturerId = manufacturer_id || filteredRows[0]?.manufacturer_id || null;
      const logColor = color || filteredRows[0]?.color || "Standard";

      // 5. Lock & Increment Target Project Stock
      let targetStock = await this.projectStockRepo.findForUpdate(
        {
          projectId: target_project_id,
          productId: item_id,
          manufacturerId: logManufacturerId,
          color: logColor,
        },
        t
      );

      if (!targetStock) {
        targetStock = await this.projectStockRepo.createForProject(
          {
            projectId: target_project_id,
            productId: item_id,
            manufacturerId: logManufacturerId,
            color: logColor,
          },
          baseQty,
          t
        );
      } else {
        await targetStock.update(
          {
            current_quantity: round3(Number(targetStock.current_quantity) + baseQty),
            last_updated_at: new Date(),
          },
          { transaction: t }
        );
      }

      // 6. Audit transaction log (type: PROJECT_TRANSFER)
      // Pick a fallback warehouse_id for foreign key if needed
      const mainWarehouse = await db.Warehouse.findOne({
        where: { is_active: true },
        transaction: t,
      });

      const txLog = await db.StockTransaction.create(
        {
          type: "PROJECT_TRANSFER",
          ProductId: item_id,
          WarehouseId: mainWarehouse?.id || null,
          project_id: source_project_id,
          manufacturer_id: logManufacturerId,
          quantity: numQty,
          uom: uomInfo.uom,
          conversion_factor: uomInfo.factor,
          base_quantity: baseQty,
          reference_no: reference_no || `PROJ_XFER_${Date.now()}`,
          remarks:
            remarks ||
            `Inter-project transfer from ${sourceProject.project_name} to ${targetProject.project_name}`,
          created_by: created_by,
        },
        { transaction: t }
      );

      const result = {
        transactionId: txLog.id,
        source_project_id: source_project_id,
        source_project_name: sourceProject.project_name,
        target_project_id: target_project_id,
        target_project_name: targetProject.project_name,
        product_id: item_id,
        product_name: product.name,
        quantity: numQty,
        uom: uomInfo.uom,
        base_quantity: baseQty,
        target_project_stock_after: targetStock.current_quantity,
      };

      // Invalidate Redis Caches
      const redisClient = require("../../../common/redis.client");
      redisClient.delPattern("cache:*").catch(() => {});

      return result;
    });
  }
}

module.exports = ProjectTransferService;
