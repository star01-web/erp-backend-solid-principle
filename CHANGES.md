# Change Log — ERP Backend Review & Fixes

This document records the changes made during the code-review and remediation
sessions. Work is grouped into three areas: **security**, **HRM refactor
completion**, and **inventory hardening**, plus docs.

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

---

## Verification Performed

- `require('./src/app')` loads cleanly with all routes/controllers/services wired.
- All 17 HRM route handlers resolve to real controller methods.
- RBAC guard: `EMPLOYEE` blocked (403), managers/admin allowed.
- Inventory validators: reject empty bodies with original messages, pass valid ones.
- Model attribute checks: `updated_by`, `updatedAt`, `Product.name` unique, and
  `Lead.assignedTo` all confirmed present; old `assingeTo` gone.

## Files Changed — Summary

**Added**
- `src/modules/hrm/routes/{employee,attendance,officeLocation,export}.route.js`
- `src/modules/inventory/validators/inventory.validator.js`
- `README.md` (rewritten), `CHANGES.md`

**Modified**
- `src/app.js`
- `src/modules/auth/validators/auth.validator.js`
- `src/modules/auth/services/user.service.js`
- `src/modules/auth/controllers/user.controller.js`
- `src/modules/inventory/Route/inventory.route.js`
- `src/modules/inventory/model/StockTransaction.js`
- `src/modules/inventory/model/Product.js`
- `src/modules/inventory/inventory_controller/Partner.js`
- `src/modules/sales/model/lead.model.js`

**Deleted**
- `src/modules/hrm/Controller/` (4 files)
- `src/modules/hrm/Route/` (4 files)
- `src/modules/hrm/middleware/{verifyToken,createEmployee_mw}.js`
