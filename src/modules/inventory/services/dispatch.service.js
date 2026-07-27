const AppError = require("../../../common/AppError");

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
    siteRepository,
    projectSiteRepository,
    sequelize,
  }) {
    this.productRepo = productRepository;
    this.logRepo = siteDispatchLogRepository;
    this.siteStockRepo = siteStockRepository;
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
   * Every stock column is DECIMAL(15,3), so all in-memory math must collapse
   * to the same 3 dp grid before compare/store. Without this, binary-float
   * drift (0.1 + 0.2 !== 0.3) slowly desyncs the in-memory counters from the
   * DB and can reject a legitimate "return everything" by a 1e-14 hair.
   */
  _round3(n) {
    return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
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
  _ledgerEntry({ siteId, itemId, qty, uom, baseQty, transactionDate, remarks, userId }) {
    return {
      site_id: siteId,
      item_id: itemId,
      quantity: qty,
      uom,
      base_quantity: baseQty,
      transaction_date: transactionDate || new Date(),
      remarks: remarks || null,
      created_by: userId || null,
    };
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
   * Universal UOM normalisation — the single funnel through which EVERY
   * movement (DISPATCH and RETURN alike) passes before any validation or
   * stock math. Returns are deliberately symmetric with dispatches: material
   * issued as "2 Bundle" can come back as "100 Meter", "1.5 Bundle", or
   * "37.25 Meter" and all of it lands on the same base-UOM number line.
   *
   *   uom === base_uom       -> base_quantity = quantity            (no factor!)
   *   uom === purchase_uom   -> base_quantity = quantity * conversion_factor
   *   anything else          -> reject (unknown unit for this item)
   *
   * Example (Rope: base 'Meter', purchase 'Bundle', factor 50):
   *   ('120', 'Meter')  -> 120     — raw meters pass through untouched
   *   (2,     'Bundle') -> 100     — 2 * 50
   *   (1.5,   'bundle') -> 75      — case-insensitive, fractional bundles OK
   *
   * Both branches round to the canonical 3-dp grid (DECIMAL(15,3)) so the
   * number we validate against, mutate stock with, and store in the ledger
   * is byte-for-byte the same one the DB holds.
   */
  _toBaseQuantity(item, quantity, uom) {
    let baseQty;
    if (this._uomMatches(uom, item.base_uom)) {
      // Already in base units — use the raw quantity directly. Multiplying
      // here would double-convert a "120 Meter" return into 6000 Meters.
      baseQty = this._round3(quantity);
    } else if (item.purchase_uom && this._uomMatches(uom, item.purchase_uom)) {
      const factor = Number(item.conversion_factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new AppError(
          `Item '${item.name}' has an invalid conversion_factor; cannot convert '${uom}'.`,
          400,
        );
      }
      baseQty = this._round3(Number(quantity) * factor);
    } else {
      throw new AppError(
        `Invalid uom '${uom}' for item '${item.name}'. Allowed: ` +
          `'${item.base_uom}'${item.purchase_uom ? ` or '${item.purchase_uom}'` : ""}.`,
        400,
      );
    }

    // A movement that rounds to zero (e.g. 0.0004 Bundle) can neither be
    // stored (ledger validates min 0.001) nor affect stock — reject it here
    // with a clean message instead of a low-level Sequelize validation error.
    if (baseQty < 0.001) {
      throw new AppError(
        `Quantity is too small: ${quantity} ${uom} converts to less than ` +
          `0.001 ${item.base_uom}.`,
        400,
      );
    }
    return baseQty;
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
    transactionDate,
    userId,
  }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

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
        log,
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
    transactionDate,
    userId,
  }) {
    const qty = this._parsePositiveQty(quantity);
    this._assertValidInput(siteId, itemId, qty, uom);

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
          remarks,
          userId,
        }),
        { transaction: t },
      );

      return {
        log,
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
   * Delegates the grouped SQL to the repository, then normalises the shape.
   */
  async getConsumptionReport(siteId) {
    if (!siteId) throw new AppError("siteId param zaroori hai.", 400);

    // Ledger rows inventory-site id par anchored hain; UI dono id bhej
    // sakta hai, isliye pehle resolve karo.
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
}

module.exports = DispatchService;
