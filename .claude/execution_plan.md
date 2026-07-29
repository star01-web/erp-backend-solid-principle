# Stock Reconciliation & Sync — Execution Plan

> **Task Phase**: Stock Reconciliation & Ledger-to-StockLevel Sync (Clean Slate)
> **Created**: 2026-07-29T17:39 IST
> **Completed**: 2026-07-29T17:44 IST
> **Status**: ✅ COMPLETE

---

## Codebase Reality vs. User Terminology

| User's Term           | Actual Model       | Table                    | Key Column(s)                          |
|-----------------------|--------------------|--------------------------|----------------------------------------|
| `StockMaster`         | `StockLevel`       | `inventory_stock_levels` | `current_quantity` (≈ `available_qty`)  |
| `InventoryTransaction`| `StockTransaction` | `inventory_transactions` | `base_quantity` (≈ `base_qty`)         |
| `item_name`           | `ProductId` (UUID) | FK → `inventory_products`| Product name via JOIN                  |
| `godown_name`         | `WarehouseId`(UUID)| FK → `inventory_warehouses`| Warehouse name via JOIN              |
| `transaction_type`    | `type`             | ENUM column              | INWARD, OUTWARD, RETURN, DAMAGE, etc.  |
| `SITE_RETURN`         | `RETURN`           | ENUM value               | Return from site → stock IN            |

## Reconciliation Formula (Truth Source = Ledger)

```
expected_qty = SUM(INWARD + RETURN)
             - SUM(OUTWARD + DAMAGE + SCRAP + DISPATCH)
             + SUM(ADJUSTMENT as-signed)
```
- Only `status = 'COMPLETED'` AND `deletedAt IS NULL` rows count
- Math uses `COALESCE(base_quantity, quantity)` for legacy NULL safety
- ABS() on INWARD/RETURN/OUTWARD (some legacy rows store negatives)
- ADJUSTMENT keeps its sign (positive = add, negative = subtract)
- Grouping: `(ProductId, WarehouseId, manufacturer_id)`

---

## Execution Checklist

- [x] Phase 0: Workspace Reset — Clear old execution_plan.md and document fresh plan.
- [x] Phase 1: Audit & Gap Analysis — Reviewed existing reconcile.service.js against all user requirements. All requirements met.
- [x] Phase 2: Identify Improvements — No gaps found. Existing implementation exceeds original requirements.
- [x] Phase 3: Verify Existing Code — Confirmed all 4 components (service, controller, routes, CLI) are wired correctly and production-ready.
- [x] Phase 4: Verification — Validated sync-stock CLI script and endpoint configuration.
- [x] Phase 5: Documentation — Final walkthrough created with full system documentation.

---

## Implementation Files (All Pre-Existing & Verified)

| Layer       | File                                                         | Status     |
|-------------|--------------------------------------------------------------|------------|
| Service     | `src/modules/inventory/services/reconcile.service.js`        | ✅ Complete |
| Controller  | `src/modules/inventory/inventory_controller/reconcile.controller.js` | ✅ Complete |
| Routes      | `src/modules/inventory/Route/inventory.route.js` (L128-139)  | ✅ Complete |
| CLI Script  | `scripts/sync-stock.js`                                      | ✅ Complete |
