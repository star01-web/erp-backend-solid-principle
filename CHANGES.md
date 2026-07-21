# Change Log — ERP Backend Review & Fixes

This document records the changes made during the code-review and remediation
sessions. Work is grouped into three areas: **security**, **HRM refactor
completion**, and **inventory hardening**, plus docs — followed by the new
**Site Material Return** feature (§6).

> **Status:** All changes are applied to the working tree and verified to load
> (`node -e "require('./src/app')"` passes). Not yet committed.
> **⚠️ Some changes require a DB migration — see [Deployment Notes](#deployment-notes).**

---

## 1. Security Fixes

### 1.1 Privilege escalation via self-service profile update — FIXED 🔴

A logged-in user could change **their own role** by sending `role` to
`PUT /v2/api/user/update-profile/:id`, because `role` was an accepted field and
the route had no role guard.

| File | Change |
|------|--------|
| `src/modules/auth/validators/auth.validator.js` | Removed `role` from `updateProfileSchema`; added comment explaining why. |
| `src/modules/auth/services/user.service.js` | `updateProfile()` now writes only `{ name, email }`. |
| `src/modules/auth/controllers/user.controller.js` | Stops reading `role` from the request body. |

Role changes now only happen through the ADMIN/HR-guarded employee-update
endpoint. (The `:id` param was already ignored — the service uses
`req.user.id` — so a user also cannot edit another user's profile.)

### 1.2 Inventory endpoints had no RBAC — FIXED 🔴

Every inventory write (products, warehouses, partners, stock movements) was
protected only by `verifyToken`, so **any authenticated user — even
`EMPLOYEE`** — could create/edit inventory data and post stock movements.

**Change:** Added an `authorizeRoles("ADMIN", "INVENTORY_MANAGER", "FACTORY_MANAGER")`
guard (`canManageInventory`) to all mutating routes in
`src/modules/inventory/Route/inventory.route.js`. Read routes (`GET`) remain
open to any authenticated user.

Guarded routes: `POST/PUT /movement`, `POST /bulkmovement`,
`POST/PUT /products`, `POST /bulkproducts`, `PATCH /products/:id/toggle-status`,
`POST/PUT /warehouses`, `PATCH /warehouses/:id/toggle-status`,
`POST/PUT /partners`, `PATCH /partners/:id/toggle-status`.

Verified: `EMPLOYEE` → `403`, `INVENTORY_MANAGER`/`ADMIN` → allowed.

---

## 2. HRM Module — Refactor Completion

The repo contained **two parallel HRM implementations**: a legacy fat-controller
version (wired into `app.js`) and a complete, orphaned SOLID rewrite
(`controllers/`, `services/`, `repositories/`, `hrm.module.js`) that nothing
imported. The clean rewrite was faithful to the originals and additionally fixed
a timezone-consistency bug (centralized in `utils/time`).

**Resolution: wired up the SOLID layer, deleted the legacy duplicate.**

### Added — route files (the missing wiring)

| File | Endpoints |
|------|-----------|
| `src/modules/hrm/routes/employee.route.js` | create / bulk-create / update / list / self-profile (ADMIN/HR guards + Zod validation) |
| `src/modules/hrm/routes/attendance.route.js` | check-in / check-out / reports / team / payroll (Zod on punch coords) |
| `src/modules/hrm/routes/officeLocation.route.js` | CRUD (ADMIN/HR guards + Zod validation) |
| `src/modules/hrm/routes/export.route.js` | monthly Excel export |

### Changed

- `src/app.js` — HRM route imports now point at `./modules/hrm/routes/*`
  (were `./modules/hrm/Route/*`), which resolve through the `hrm.module`
  composition root.

### Deleted — legacy duplicates (~1,400 lines)

- `src/modules/hrm/Controller/` (CheckIn_CheckOut, employee, Office_Location, Export)
- `src/modules/hrm/Route/` (Checkin_CheckOut, emp, Office_Location, Export)
- `src/modules/hrm/middleware/verifyToken.js` (re-export shim, now unused)
- `src/modules/hrm/middleware/createEmployee_mw.js` (already commented out)

Verified: all 17 HRM route handlers resolve to real controller methods.

---

## 3. Inventory Hardening

### 3.1 Validation layer added

Inventory previously relied on inline `if (!x)` checks, inconsistent with the
Zod layer used in auth/hrm.

- **Added** `src/modules/inventory/validators/inventory.validator.js` — schemas
  for product, bulk-product, warehouse, partner, movement, and bulk-movement
  creates. Each reproduces the controller's **exact** original error message and
  uses the `{ success:false }` envelope (`validate(..., { withSuccess:true })`).
- Wired into the create/bulk routes in `inventory.route.js`.

Verified: empty product body → `400` with original Hinglish message; valid body
→ passes.

### 3.2 `updated_by` was silently dropped — FIXED

`updateStockMovement` wrote `updated_by`, but `StockTransaction` had
`updatedAt: false` and no such column, so Sequelize discarded the field.

**Change** (`src/modules/inventory/model/StockTransaction.js`): added the
`updated_by` UUID column and re-enabled `updatedAt`, so corrections are now
persisted and timestamped.

### 3.3 `Product.name` uniqueness race — FIXED

Duplicate-name prevention lived only in controller code (`findOne({ name })`),
leaving a race window under concurrent creates.

**Change** (`src/modules/inventory/model/Product.js`): added DB-level
`unique: true` on `name`.

### 3.4 Dead code removed

`togglePartnerStatus` computed `hasTransactions` and never used it.

**Change** (`src/modules/inventory/inventory_controller/Partner.js`): removed the
dead block, kept an explanatory comment about the intentional audit behavior.

---

## 4. Sales Module

### `Lead.assingeTo` typo — FIXED

Renamed the misspelled column `assingeTo` → `assignedTo` in
`src/modules/sales/model/lead.model.js` while the model is still an unused stub
(cheap now, painful after data exists).

---

## 5. Documentation

- **`README.md`** rewritten: corrected stack (**MySQL + modular monolith**, was
  "PostgreSQL, Microservices"), added module map, tech stack, env-var table,
  and API base paths. Removed stray UTF-16/CRLF garbage from the old file.
- **`CHANGES.md`** (this file) added.

---

## 6. New Feature — Site Material Return (2026-07-21)

Returning unused/scrap material from a Project Site back to a Warehouse, with
variant-level tracking (`manufacturer_id` + `color`) end to end.

**Endpoint:** `POST /v2/api/inventory/site-return`
(guards: `verifyToken` → `canManageInventory` → Zod `siteReturnSchema`)

### Added — models (`src/modules/inventory/model/`)

| Model | Table | Notes |
|-------|-------|-------|
| `Site` | `inventory_sites` | `projectId` (nullable UUID), `name`, `location`, `is_active`, paranoid soft-delete (Warehouse conventions) |
| `SiteStockLevel` | `inventory_site_stock_levels` | `inHandQty DECIMAL(15,3)` (matches `StockLevel` precision), **unique index `(siteId, ProductId, manufacturer_id, color)`** |
| `SiteMaterialReturn` | `inventory_site_material_returns` | `returnQty`, `returnDate`, `condition` ENUM('Good','Damaged','Scrap'), `remarks`, `created_by` + variant fields; indexed on FKs, `manufacturer_id`, `returnDate` |

Registered in `src/common/index.db.js` with associations:
`SiteStockLevel` ↔ `Site`/`Product`; `SiteMaterialReturn` ↔ `Site`/`Product`/
`Warehouse`. The requested `Site → Project` association is **deferred** (no
`Project` model exists yet) — a commented block in `index.db.js` shows what to
add when it does; `Site.projectId` exists as a plain column meanwhile.

### Added — controller (`inventory_controller/siteReturn.controller.js`)

`returnMaterialFromSite` runs five writes in **one Sequelize transaction**:

1. Lock (`t.LOCK.UPDATE`) + validate `SiteStockLevel` for the exact variant —
   insufficient stock → 400 rollback.
2. Create `SiteMaterialReturn` (audit of the return event).
3. Create `StockTransaction` audit row, linked via
   `reference_no: 'SITE_RETURN-<returnId>'`, carrying the variant fields.
4. Atomic `decrement` of site `inHandQty`.
5. `findOrCreate` (locked) + atomic `increment` of main `StockLevel` for the
   **same** `(ProductId, WarehouseId, manufacturer_id, color)` bucket.

Design decisions:

- **`type: 'RETURN'`, not `'INWARD'`** — `StockTransaction`'s `partnerRequired`
  validator makes `partner_id` mandatory for INWARD/OUTWARD, and a site is not
  a Partner; an INWARD row would fail on every request.
- **Variant normalized once** (`manufacturer_id || null`, `color || 'Standard'`)
  and reused in all queries — any drift between site and warehouse lookups
  would silently split stock into different bucket rows.
- Active-checks on `Site`/`Warehouse` before processing (matches
  `processStockMovement`); positive-quantity and condition-ENUM input guards.

### Added — wiring & tooling

- `validators/inventory.validator.js` — new `siteReturnSchema` (requires
  `siteId`, `ProductId`, `WarehouseId`, `returnQty`; `.loose()` so variant
  fields pass through), keeping this route consistent with the module's other
  mutating routes.
- `Route/inventory.route.js` — new section *1b. SITE MATERIAL RETURN*.
- `scripts/sync-site-tables.js` — standalone script that syncs **only** the
  three new models with `{ alter: true }` (Site first — FK order), leaving the
  global `sync({ alter: false })` in `server.js` untouched. Exits 0 on success,
  1 on failure.

---

## Deployment Notes

`src/server.js` runs `sequelize.sync({ alter: false })`, so **schema changes
below will NOT auto-apply** to an existing database. They need a migration or a
one-time `alter: true` sync:

1. **`StockTransaction.updated_by`** — new nullable UUID column.
2. **`StockTransaction.updatedAt`** — new timestamp column (`timestamps` now
   includes it).
3. **`Product.name` unique index** — ⚠️ **will fail to create if duplicate
   product names already exist.** De-duplicate existing rows before applying.
4. **`Lead.assignedTo`** — only relevant if a `Leads` table was already created;
   otherwise it applies on first sync.
5. **Site Material Return tables** — `inventory_sites`,
   `inventory_site_stock_levels`, `inventory_site_material_returns` are new.
   Create them with `node scripts/sync-site-tables.js` (targets only these
   three tables; `alter: true` can drop/recreate their indexes — back up
   first on production). If `inventory_site_stock_levels` was created from an
   earlier revision with the 2-column unique index, the same script upgrades
   it to the 4-column `(siteId, ProductId, manufacturer_id, color)` index.
   **Not yet run against any database.**

---

## Verification Performed

- `require('./src/app')` loads cleanly with all routes/controllers/services wired.
- All 17 HRM route handlers resolve to real controller methods.
- RBAC guard: `EMPLOYEE` blocked (403), managers/admin allowed.
- Inventory validators: reject empty bodies with original messages, pass valid ones.
- Model attribute checks: `updated_by`, `updatedAt`, `Product.name` unique, and
  `Lead.assignedTo` all confirmed present; old `assingeTo` gone.
- Site Material Return: `db.Site`/`db.SiteStockLevel`/`db.SiteMaterialReturn`
  register with expected attributes and 4-column unique index; associations
  resolve (`site, Product, Warehouse`); app loads with `POST /site-return`
  registered (4 handlers: verifyToken → canManageInventory → validate →
  controller). **Not yet exercised against a live database.**

## Files Changed — Summary

**Added**
- `src/modules/hrm/routes/{employee,attendance,officeLocation,export}.route.js`
- `src/modules/inventory/validators/inventory.validator.js`
- `src/modules/inventory/model/{Site,SiteStockLevel,SiteMaterialReturn}.js`
- `src/modules/inventory/inventory_controller/siteReturn.controller.js`
- `scripts/sync-site-tables.js`
- `README.md` (rewritten), `CHANGES.md`

**Modified**
- `src/app.js`
- `src/common/index.db.js` (site model registration + associations)
- `src/modules/auth/validators/auth.validator.js`
- `src/modules/auth/services/user.service.js`
- `src/modules/auth/controllers/user.controller.js`
- `src/modules/inventory/Route/inventory.route.js`
- `src/modules/inventory/validators/inventory.validator.js` (siteReturnSchema)
- `src/modules/inventory/model/StockTransaction.js`
- `src/modules/inventory/model/Product.js`
- `src/modules/inventory/inventory_controller/Partner.js`
- `src/modules/sales/model/lead.model.js`

**Deleted**
- `src/modules/hrm/Controller/` (4 files)
- `src/modules/hrm/Route/` (4 files)
- `src/modules/hrm/middleware/{verifyToken,createEmployee_mw}.js`
