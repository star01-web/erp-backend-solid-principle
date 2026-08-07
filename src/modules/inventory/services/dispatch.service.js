const AppError = require("../../../common/AppError");
// Shared UOM utils — conversion/rounding ka single source of truth ab
// uom.service.js me hai (movement/site-return/delete flows bhi use karte hain).
const uomService = require("./uom.service");

/**
 * Site Dispatch ledger & stock management — business logic + transaction ownership.
 *
 * SRP: this service is the ONLY place that runs business rules, performs UOM
 * conversions, manages transactions and touches Sequelize. Controllers just
 * hand it a DTO. It depends on repository abstractions (Dependency Inversion),
 * not on models directly, except for the transaction handle which the shared
 * `sequelize` instance provides.
 *
 * Multi-UOM rule: Product.total_stock, SiteStockLevel.inHandQty and every
 * stock calculation live in the item's BASE uom. An entry may arrive in base_uom
 * or purchase_uom; this service converts it to base_quantity BEFORE any validation
 * or mutation, so the stock counter can never mix units.
 *
 * Both mutating methods use a MANAGED transaction — `sequelize.transaction(cb)`
 * auto-commits when `cb` resolves and auto-rolls-back if it throws. Both Product
 * and SiteStock rows are locked with `t.LOCK.UPDATE` (SELECT … FOR UPDATE) so
 * concurrent movements can never cause race conditions or oversell.
 */
class DispatchService {
  // NEW: Added siteStockRepository to dependencies
  constructor({
    productRepository,
    siteDispatchLogRepository,
    siteStockRepository,
    siteMaterialReturnRepository,
    warehouseRepository,
    siteRepository,
    projectSiteRepository,
    sequelize,
  }) {
    this.productRepo = productRepository;
    this.logRepo = siteDispatchLogRepository;
    this.siteStockRepo = siteStockRepository;
    // Site Material Return audit table — har return isme bhi ek row likhta
    // hai (report/history isi table se aati hai).
    this.siteMaterialReturnRepo = siteMaterialReturnRepository;
    this.warehouseRepo = warehouseRepository;
    // Site master repos — dual-id resolution ke liye (niche dekho).
    this.siteRepo = siteRepository;
    this.projectSiteRepo = projectSiteRepository;
    this.sequelize = sequelize;
  }

  /**
   * Frontend se aane wala `siteId` do jagah ka id ho sakta hai:
   *   1. `inventory_sites` (Site) ka id — ledger/stock isi par anchor hai
   *   2. HRM `ProjectSite` (geofence) ka id — site creation par dono rows
   *      saath banti hain lekin IDs ALAG hote hain, aur UI aksar ProjectSite
   *      id bhejta hai.
   * Pehle inventory Site pk se try karo; warna ProjectSite ke locationName
   * se same naam ki inventory Site dhundo. (Same resolution jo
   * inventory.controller ka resolveInventorySite karta hai.)
   * Return: inventory Site row ya null.
   */
  async _resolveInventorySite(siteId, t = null) {
    const opts = t ? { transaction: t } : {};
    let site = await this.siteRepo.findById(siteId, opts);
    if (site) return site;

    if (!this.projectSiteRepo) return null;
    const projSite = await this.projectSiteRepo
      .findById(siteId, opts)
      .catch(() => null);
    if (projSite?.locationName) {
      site = await this.siteRepo.findOne(
        { site_name: projSite.locationName },
        opts,
      );
    }
    return site;
  }

  // Parse + guard a movement quantity. Returns a positive Number, or null.
  _parsePositiveQty(raw) {
    const q = Number(raw);
    return Number.isFinite(q) && q > 0 ? q : null;
  }

  /**
   * Canonical 3-dp rounding — the ONE precision used everywhere.
   * Delegates to the shared uom.service (details wahi dekho).
   */
  _round3(n) {
    return uomService.round3(n);
  }

  _assertValidInput(siteId, itemId, qty, uom) {
    if (!siteId || !itemId || qty === null || !uom) {
      throw new AppError(
        "site_id, item_id, uom aur ek valid positive quantity zaroori hai.",
        400,
      );
    }
  }

  /**
   * Shared ledger-row shape for both movement directions. The entered
   * quantity + uom are stored verbatim (what the user typed: "2 Bundle",
   * "120 Meter") alongside the normalised base_quantity, so the ledger is
   * auditable in the user's language AND aggregatable in base UOM.
   */
  _ledgerEntry({ siteId, itemId, qty, uom, baseQty, transactionDate, referenceNo, remarks, userId }) {
    return {
      site_id: siteId,
      item_id: itemId,
      quantity: qty,
      uom,
      base_quantity: baseQty,
      transaction_date: transactionDate || new Date(),
      reference_no: referenceNo || null,
      remarks: remarks || null,
      created_by: userId || null,
    };
  }

  // Case-insensitive UOM compare — delegates to shared uom.service.
  _uomMatches(a, b) {
    return uomService.uomMatches(a, b);
  }

  /**
   * Universal UOM normalisation — the single funnel through which EVERY
   * movement (DISPATCH and RETURN alike) passes before any validation or
   * stock math. Poori logic ab shared uom.service.toBaseQuantity me hai
   * (wahi /movement, /site-return, DELETE flows bhi use karte hain) —
   * yahan sirf delegation hai, behaviour bilkul same:
   *
   *   uom === base_uom       -> base_quantity = quantity            (no factor!)
   *   uom === purchase_uom   -> base_quantity = quantity * conversion_factor
   *   anything else          -> reject (unknown unit for this item)
   *
   * Rounds to the canonical 3-dp grid; rejects results < 0.001.
   */
  _toBaseQuantity(item, quantity, uom) {
    return uomService.toBaseQuantity(item, quantity, uom).baseQty;
  }

  /**
   * Issue material from warehouse stock to a site.
   *  - Converts entered qty/uom to base_quantity
   *  - Validates base_quantity <= Product.total_stock (prevents negative warehouse stock)
   *  - Deducts base_quantity from Product.total_stock (base UOM)
   *  - Appends a 'DISPATCH' ledger row
   *  - Adds base_quantity to SiteStockLevel.inHandQty (finds or creates site inventory row)
   */
  async dispatchItem({
    siteId,
    itemId,
    quantity,
    uom,
    remarks,
    referenceNo,
    reference_no,
    reference_number,
    ref_no,
    transactionDate,
    userId,
  }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

    const refNo = referenceNo || reference_no || reference_number || ref_no || null;

    return this.sequelize.transaction(async (t) => {
      // Resolve FIRST: UI inventory-Site id ya HRM ProjectSite id — dono bhej
      // sakta hai. Stock rows aur ledger hamesha resolved inventory-site id
      // par anchor hote hain, warna dispatch ek id par likhta aur return/report
      // dusri id par dhundhte (Available: 0 wala bug).
      const site = await this._resolveInventorySite(siteId, t);
      if (!site) throw new AppError("Site not found.", 404);
      const inventorySiteId = site.id;

      // Lock Product row for update
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
      // Snap the stored balance to the canonical 3-dp grid before comparing,
      // mirroring the return-side guard, so "dispatch everything" never fails
      // on float residue.
      const currentStock = this._round3(item.total_stock);

      // Guard: never let warehouse stock go negative.
      if (baseQty > currentStock) {
        throw new AppError(
          `Insufficient stock. Available in warehouse: ${currentStock} ${item.base_uom}, ` +
            `Requested: ${baseQty} ${item.base_uom}.`,
          400,
        );
      }

      // 1) Deduct from the main warehouse stock counter (base UOM).
      // Re-round after the subtraction: currentStock and baseQty are each on
      // the 3-dp grid, but their float difference may not be (0.3 - 0.1).
      item.total_stock = this._round3(currentStock - baseQty);
      await item.save({ transaction: t });

      // 2) Append the immutable DISPATCH ledger entry (both entered + base).
      const log = await this.logRepo.logDispatch(
        this._ledgerEntry({
          siteId: inventorySiteId,
          itemId,
          qty,
          uom,
          baseQty,
          transactionDate,
          referenceNo: refNo,
          remarks,
          userId,
        }),
        { transaction: t },
      );

      // 3) Increment the live per-site balance (find-or-create under lock).
      // Repository handles variant-key normalisation; we stay in base UOM.
      const stockKey = { siteId: inventorySiteId, productId: itemId };
      let siteStock = await this.siteStockRepo.findForUpdate(stockKey, t);

      if (!siteStock) {
        // First time material is arriving at this site
        siteStock = await this.siteStockRepo.createForSite(stockKey, baseQty, t);
      } else {
        // Material already exists at site, add to current stock
        siteStock.inHandQty = this._round3(
          Number(siteStock.inHandQty) + baseQty,
        );
        await siteStock.save({ transaction: t });
      }

      return {
        log: {
          ...log.toJSON(),
          reference_no: refNo,
          site_name: site.site_name,
          project_name: site.project_name || null,
          item_name: item.name,
          sku_code: item.sku_code || null,
        },
        reference_no: refNo,
        site_id: inventorySiteId,
        site_name: site.site_name,
        project_name: site.project_name || null,
        item_id: itemId,
        item_name: item.name,
        sku_code: item.sku_code || null,
        base_uom: item.base_uom,
        remaining_warehouse_stock: Number(item.total_stock),
        site_current_stock: Number(siteStock.inHandQty),
      };
    });
  }

  /**
   * Material coming back from a site into warehouse stock.
   *  - Converts entered qty/uom to base_quantity
   *  - Validates base_quantity <= SiteStockLevel.inHandQty (prevents phantom returns;
   *    checks SITE stock, never warehouse stock)
   *  - Deducts base_quantity from SiteStockLevel.inHandQty
   *  - Adds base_quantity back to Product.total_stock (base UOM)
   *  - Appends a 'RETURN' ledger row
   */
  async returnItem({
    siteId,
    itemId,
    quantity,
    uom,
    remarks,
    referenceNo,
    reference_no,
    reference_number,
    ref_no,
    transactionDate,
    userId,
    warehouseId,
    condition,
  }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

    const refNo = referenceNo || reference_no || reference_number || ref_no || null;

    // Return ki haalat — SiteMaterialReturn ENUM se match honi chahiye,
    // warna insert DB-level error par girta (aur poora return rollback hota).
    const ALLOWED_CONDITIONS = ["Good", "Damaged", "Scrap"];
    if (condition && !ALLOWED_CONDITIONS.includes(condition)) {
      throw new AppError(
        `condition '${ALLOWED_CONDITIONS.join("' | '")}' mein se ek honi chahiye.`,
        400,
      );
    }

    return this.sequelize.transaction(async (t) => {
      // Resolve FIRST (same dual-id funnel as dispatchItem): stock rows are
      // anchored on the inventory-site id, but the UI often sends the HRM
      // ProjectSite id. Without this, the lookup below finds no rows and the
      // return is rejected with "Available at site: 0".
      const site = await this._resolveInventorySite(siteId, t);
      if (!site) throw new AppError("Site not found.", 404);
      const inventorySiteId = site.id;

      // 1) Lock Product row
      const item = await this.productRepo.findById(itemId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!item) throw new AppError("Item (Product) not found.", 404);

      // Universal normalisation — the SAME funnel dispatches use, so a
      // return entered as "120 Meter" stays 120, and "2 Bundle" becomes 100.
      const baseQty = this._toBaseQuantity(item, qty, uom);

      // 2) Lock & check the SITE's own balance before allowing the return.
      // The guard is site-specific on purpose: warehouse stock is irrelevant
      // here — a site can only send back what it actually holds.
      // ALL variant buckets of this (site, product) are summed: dispatches
      // done via /movement land in per-variant buckets (manufacturer/color),
      // so a single-bucket lookup would miss that stock and report 0.
      const siteStockRows = await this.siteStockRepo.findAllForProductForUpdate(
        { siteId: inventorySiteId, productId: itemId },
        t,
      );

      // Snap the stored balance to the same 3-dp grid before comparing so a
      // full "return everything" is never rejected by float residue.
      const currentSiteStock = this._round3(
        siteStockRows.reduce((sum, r) => sum + Number(r.inHandQty), 0),
      );

      // Guard: never allow returning more than what the site actually holds
      if (baseQty > currentSiteStock) {
        throw new AppError(
          `Site ke paas return karne ke liye sufficient stock nahi hai. ` +
            `Available at site: ${currentSiteStock} ${item.base_uom}, ` +
            `Requested Return: ${qty} ${uom} (= ${baseQty} ${item.base_uom}).`,
          400,
        );
      }

      // 3) Deduct from the site's live balance — greedy drain, fullest bucket
      // first (rows already arrive sorted DESC by inHandQty).
      let remaining = baseQty;
      for (const row of siteStockRows) {
        if (remaining <= 0) break;
        const rowQty = this._round3(row.inHandQty);
        const take = Math.min(rowQty, remaining);
        row.inHandQty = this._round3(rowQty - take);
        await row.save({ transaction: t });
        remaining = this._round3(remaining - take);
      }

      // 4) Add the returned quantity back to main warehouse stock (base UOM).
      item.total_stock = this._round3(Number(item.total_stock) + baseQty);
      await item.save({ transaction: t });

      // 5) Append the immutable RETURN ledger entry — stores what the user
      // typed (quantity + uom) AND the normalised base_quantity side by side.
      const log = await this.logRepo.logReturn(
        this._ledgerEntry({
          siteId: inventorySiteId,
          itemId,
          qty,
          uom,
          baseQty,
          transactionDate,
          referenceNo: refNo,
          remarks,
          userId,
        }),
        { transaction: t },
      );

      // 6) Site Material Return audit row (inventory_site_material_returns).
      // Yehi table return report/history dikhata hai — pehle sirf ledger row
      // ban rahi thi aur ye table khali reh jata tha (wahi bug). WarehouseId
      // NOT NULL hai, isliye caller ka warehouse_id lo warna pehla active
      // warehouse fallback (return warehouse-agnostic Product.total_stock me
      // hi jata hai, isliye fallback safe hai).
      let materialReturn = null;
      if (this.siteMaterialReturnRepo) {
        let warehouse = null;
        if (warehouseId) {
          warehouse = await this.warehouseRepo?.findById(warehouseId, {
            transaction: t,
          });
          if (!warehouse) {
            throw new AppError("Warehouse not found for warehouse_id.", 404);
          }
        } else {
          warehouse = await this.warehouseRepo?.findOne(
            { is_active: true },
            { transaction: t },
          );
        }
        if (!warehouse) {
          throw new AppError(
            "Koi active warehouse nahi mila — return record karne ke liye warehouse_id bhejein.",
            400,
          );
        }

        // Variant identity: jis bucket se sabse pehle kata (fullest first),
        // us ki manufacturer/color audit row me capture hoti hai.
        const primaryBucket = siteStockRows[0] || {};
        materialReturn = await this.siteMaterialReturnRepo.create(
          {
            siteId: inventorySiteId,
            ProductId: itemId,
            WarehouseId: warehouse.id,
            manufacturer_id: primaryBucket.manufacturer_id || null,
            color: primaryBucket.color || "Standard",
            returnQty: baseQty,
            returnDate: transactionDate || new Date(),
            condition: condition || "Good",
            remarks: remarks || null,
            created_by: userId,
          },
          { transaction: t },
        );
      }

      return {
        log: {
          ...log.toJSON(),
          reference_no: refNo,
          site_name: site.site_name,
          project_name: site.project_name || null,
          item_name: item.name,
          sku_code: item.sku_code || null,
        },
        material_return: materialReturn,
        reference_no: refNo,
        site_id: inventorySiteId,
        site_name: site.site_name,
        project_name: site.project_name || null,
        item_id: itemId,
        item_name: item.name,
        sku_code: item.sku_code || null,
        base_uom: item.base_uom,
        returned_in_base_uom: baseQty,
        remaining_warehouse_stock: Number(item.total_stock),
        site_current_stock: this._round3(currentSiteStock - baseQty),
      };
    });
  }

  /**
   * Site-specific stock visibility: what does ONE site currently hold?
   * Read-only — no transaction needed. Numbers are already in base UOM.
   */
  async getSiteStock(siteId) {
    if (!siteId) throw new AppError("siteId param zaroori hai.", 400);

    // UI inventory-Site id ya HRM ProjectSite id — dono bhej sakta hai;
    // stock rows resolved inventory-site id par hi padi hain.
    const site = await this._resolveInventorySite(siteId);
    if (!site) throw new AppError("Site not found.", 404);

    const rows = await this.siteStockRepo.getStockBySite(site.id);

    const items = rows.map((r) => ({
      item_id: r.ProductId,
      item_name: r.Product ? r.Product.name : null,
      sku_code: r.Product ? r.Product.sku_code : null,
      base_uom: r.Product ? r.Product.base_uom : null,
      color: r.color,
      manufacturer_id: r.manufacturer_id,
      current_stock: Number(r.inHandQty) || 0,
    }));

    return {
      site_id: site.id,
      site_name: site.site_name,
      project_name: site.project_name || null,
      item_count: items.length,
      items,
    };
  }

  /**
   * Net consumption per item for one site, computed on base_quantity.
   */
  async getConsumptionReport(siteId) {
    if (!siteId) throw new AppError("siteId param zaroori hai.", 400);

    const site = await this._resolveInventorySite(siteId);
    if (!site) throw new AppError("Site not found.", 404);

    const rows = await this.logRepo.getConsumptionBySite(site.id);

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
      site_id: site.id,
      site_name: site.site_name,
      project_name: items.length
        ? items[0].project_name
        : site.project_name || null,
      item_count: items.length,
      items,
    };
  }

  /**
   * Fetch dispatch ledger logs history populated with site_name, item_name and reference_no.
   */
  async getDispatchLogs(filters = {}) {
    let resolvedSiteId = null;
    if (filters.siteId) {
      const site = await this._resolveInventorySite(filters.siteId);
      resolvedSiteId = site ? site.id : filters.siteId;
    }

    const MAX_PAGE_LIMIT = 2000;
    const DEFAULT_PAGE_LIMIT = 20;

    const isPaginated =
      filters.page !== undefined || filters.limit !== undefined;
    const isAll =
      String(filters.limit).toLowerCase() === "all" ||
      parseInt(filters.limit, 10) === -1;
    const rawPage = parseInt(filters.page, 10);
    const parsedPage = rawPage > 0 ? rawPage : 1;

    const rawLimit = parseInt(filters.limit, 10);
    const parsedLimit = isAll
      ? MAX_PAGE_LIMIT
      : rawLimit > 0
        ? Math.min(MAX_PAGE_LIMIT, rawLimit)
        : DEFAULT_PAGE_LIMIT;
    const offset = isAll ? 0 : (parsedPage - 1) * parsedLimit;

    const options = isPaginated
      ? { limit: parsedLimit, offset: offset }
      : {};

    const result = await this.logRepo.getDispatchLogs(
      {
        ...filters,
        ...(resolvedSiteId && { siteId: resolvedSiteId }),
      },
      options,
    );

    const logs = Array.isArray(result) ? result : result.rows || [];
    const count = Array.isArray(result) ? logs.length : result.count || 0;

    const mappedData = logs.map((log) => ({
      id: log.log_id || log.id,
      log_id: log.log_id || log.id,
      site_id: log.site_id,
      site_name: log.site ? log.site.site_name : null,
      project_name: log.site ? log.site.project_name : null,
      item_id: log.item_id,
      item_name: log.item ? log.item.name : null,
      sku_code: log.item ? log.item.sku_code : null,
      transaction_type: log.transaction_type,
      reference_no: log.reference_no || null,
      quantity: Number(log.quantity),
      uom: log.uom,
      base_quantity: Number(log.base_quantity),
      transaction_date: log.transaction_date,
      remarks: log.remarks,
      created_by: log.created_by,
      createdAt: log.createdAt,
    }));

    if (isPaginated) {
      const totalPages = isAll ? 1 : Math.ceil(count / parsedLimit);
      return {
        count,
        totalItems: count,
        totalPages,
        currentPage: isAll ? 1 : parsedPage,
        limit: parsedLimit,
        hasNextPage: isAll ? false : parsedPage < totalPages,
        hasPrevPage: isAll ? false : parsedPage > 1,
        data: mappedData,
      };
    }

    return mappedData;
  }
}

module.exports = DispatchService;
