const AppError = require("../../../common/AppError");

/**
 * Site Dispatch ledger — business logic + transaction ownership.
 *
 * SRP: this service is the ONLY place that runs business rules, performs UOM
 * conversions, manages transactions and touches Sequelize. Controllers just
 * hand it a DTO. It depends on repository abstractions (Dependency Inversion),
 * not on models directly, except for the transaction handle which the shared
 * `sequelize` instance provides.
 *
 * Multi-UOM rule: Product.total_stock and every stock calculation live in the
 * item's BASE uom. An entry may arrive in base_uom or purchase_uom; this
 * service converts it to base_quantity BEFORE any validation or mutation, so
 * the stock counter can never mix units.
 *
 * Both mutating methods use a MANAGED transaction — `sequelize.transaction(cb)`
 * auto-commits when `cb` resolves and auto-rolls-back if it throws. The Product
 * row is locked with `t.LOCK.UPDATE` (SELECT … FOR UPDATE) so two concurrent
 * movements of the same item can never both read the old stock and oversell.
 */
class DispatchService {
  constructor({ productRepository, siteDispatchLogRepository, sequelize }) {
    this.productRepo = productRepository;
    this.logRepo = siteDispatchLogRepository;
    this.sequelize = sequelize;
  }

  // Parse + guard a movement quantity. Returns a positive Number, or null.
  _parsePositiveQty(raw) {
    const q = Number(raw);
    return Number.isFinite(q) && q > 0 ? q : null;
  }

  _assertValidInput(siteId, itemId, qty, uom) {
    if (!siteId || !itemId || qty === null || !uom) {
      throw new AppError(
        "site_id, item_id, uom aur ek valid positive quantity zaroori hai.",
        400,
      );
    }
  }

  // Case-insensitive UOM compare (trims stray whitespace from the payload).
  _uomMatches(a, b) {
    return (
      typeof a === "string" &&
      typeof b === "string" &&
      a.trim().toLowerCase() === b.trim().toLowerCase()
    );
  }

  /**
   * Convert an entered (quantity, uom) into the item's base UOM.
   *   uom === base_uom      -> base_quantity = quantity
   *   uom === purchase_uom  -> base_quantity = quantity * conversion_factor
   *   anything else         -> reject (unknown unit for this item)
   * Returns a rounded base_quantity (3 dp, matching the DECIMAL(15,3) column).
   */
  _toBaseQuantity(item, quantity, uom) {
    if (this._uomMatches(uom, item.base_uom)) {
      return Number(quantity);
    }
    if (item.purchase_uom && this._uomMatches(uom, item.purchase_uom)) {
      const factor = Number(item.conversion_factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new AppError(
          `Item '${item.name}' has an invalid conversion_factor; cannot convert '${uom}'.`,
          400,
        );
      }
      // Round to 3 dp so we store exactly what the DECIMAL(15,3) column holds.
      return Math.round(Number(quantity) * factor * 1000) / 1000;
    }
    throw new AppError(
      `Invalid uom '${uom}' for item '${item.name}'. Allowed: ` +
        `'${item.base_uom}'${item.purchase_uom ? ` or '${item.purchase_uom}'` : ""}.`,
      400,
    );
  }

  /**
   * Issue material from stock to a site.
   *  - Converts the entered qty/uom to base_quantity
   *  - Validates base_quantity <= total_stock (strictly prevents negative stock)
   *  - Deducts base_quantity from Product.total_stock (base UOM)
   *  - Appends a 'DISPATCH' ledger row (entered qty + uom + base_quantity)
   */
  async dispatchItem({ siteId, itemId, quantity, uom, remarks, transactionDate, userId }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

    return this.sequelize.transaction(async (t) => {
      const item = await this.productRepo.findById(itemId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!item) throw new AppError("Item (Product) not found.", 404);
      if (item.is_active === false) {
        throw new AppError("Item is inactive; dispatch not allowed.", 400);
      }

      // Everything below is in BASE uom.
      const baseQty = this._toBaseQuantity(item, qty, uom);
      const currentStock = Number(item.total_stock);

      // Guard: never let stock go negative.
      if (baseQty > currentStock) {
        throw new AppError(
          `Insufficient stock. Available: ${currentStock} ${item.base_uom}, ` +
            `Requested: ${baseQty} ${item.base_uom}.`,
          400,
        );
      }

      // 1) Deduct from the running stock counter (base UOM).
      item.total_stock = currentStock - baseQty;
      await item.save({ transaction: t });

      // 2) Append the immutable DISPATCH ledger entry (both entered + base).
      const log = await this.logRepo.create(
        {
          site_id: siteId,
          item_id: itemId,
          transaction_type: "DISPATCH",
          quantity: qty,
          uom,
          base_quantity: baseQty,
          transaction_date: transactionDate || new Date(),
          remarks: remarks || null,
          created_by: userId || null,
        },
        { transaction: t },
      );

      return {
        log,
        base_uom: item.base_uom,
        remaining_stock: Number(item.total_stock),
      };
    });
  }

  /**
   * Material coming back from a site into stock.
   *  - Converts the entered qty/uom to base_quantity
   *  - Adds base_quantity back to Product.total_stock (base UOM)
   *  - Appends a 'RETURN' ledger row (entered qty + uom + base_quantity)
   */
  async returnItem({ siteId, itemId, quantity, uom, remarks, transactionDate, userId }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

    return this.sequelize.transaction(async (t) => {
      const item = await this.productRepo.findById(itemId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!item) throw new AppError("Item (Product) not found.", 404);

      const baseQty = this._toBaseQuantity(item, qty, uom);

      // 1) Add the returned quantity back to stock (base UOM).
      item.total_stock = Number(item.total_stock) + baseQty;
      await item.save({ transaction: t });

      // 2) Append the immutable RETURN ledger entry.
      const log = await this.logRepo.create(
        {
          site_id: siteId,
          item_id: itemId,
          transaction_type: "RETURN",
          quantity: qty,
          uom,
          base_quantity: baseQty,
          transaction_date: transactionDate || new Date(),
          remarks: remarks || null,
          created_by: userId || null,
        },
        { transaction: t },
      );

      return {
        log,
        base_uom: item.base_uom,
        remaining_stock: Number(item.total_stock),
      };
    });
  }

  /**
   * Net consumption per item for one site, computed on base_quantity (so mixed
   * entry units aggregate correctly). Delegates the grouped SQL to the
   * repository, then normalises the shape for a clean payload.
   */
  async getConsumptionReport(siteId) {
    if (!siteId) throw new AppError("siteId param zaroori hai.", 400);

    const rows = await this.logRepo.getConsumptionBySite(siteId);

    const items = rows.map((r) => ({
      item_id: r.item_id,
      item_name: r.item ? r.item.name : null,
      base_uom: r.item ? r.item.base_uom : null,
      project_name: r.site ? r.site.project_name : null,
      total_dispatched: Number(r.total_dispatched) || 0,
      total_returned: Number(r.total_returned) || 0,
      net_consumed_in_base_uom: Number(r.net_consumed_in_base_uom) || 0,
    }));

    return {
      site_id: siteId,
      // Report is single-site, so project_name is constant across rows.
      project_name: items.length ? items[0].project_name : null,
      item_count: items.length,
      items,
    };
  }
}

module.exports = DispatchService;
