# ERP-Star Backend — Complete Technical & API Documentation

> **Project Name:** ERP-Star Backend (Solid Principle Architecture)  
> **Tech Stack:** Node.js, Express.js 5, MySQL (Sequelize ORM 6), Zod, JWT, ExcelJS  
> **Last Updated:** August 2026  

---

## 1. System Overview & Architecture

The **ERP-Star Backend** is built using an Enterprise SOLID-compliant Layered Architecture (Dependency Injection / Composition Root pattern).

```
                      ┌──────────────────────────────┐
                      │    HTTP / Express Routes     │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │  Validators & Auth Guards    │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │     Module Controllers       │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │     Business Services        │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │    Repositories / Models     │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │     MySQL Database (3dp)     │
                      └──────────────────────────────┘
```

### Key Architectural Highlights:
* **Composition Root Pattern:** `inventory.module.js` acts as the DI container where Repositories, Services, and Controllers are instantiated and injected into each other.
* **Dual-UOM Stock Math:** Every item can have a `base_uom` (e.g. `Meter`) and `purchase_uom` (e.g. `Bundle`). Stock levels are strictly maintained in **base_uom** with 3-decimal precision (`DECIMAL(15,3)`).
* **Smart UOM Normalization:** Case-insensitive and typo-friendly UOM alias matching (`Mettar` / `mtr` $\rightarrow$ `Meter`).
* **Row-Level Transaction Safety:** Critical stock updates use `t.LOCK.UPDATE` (`SELECT ... FOR UPDATE`) inside `sequelize.transaction()` to prevent overselling or race conditions.
* **Geofenced Attendance:** HRM module checks GPS coordinates (`latitude`, `longitude`) against site center points to ensure employees punch in within valid boundaries.

---

## 2. Database Models & Schema Design

The system consists of **13 Core Models** across 3 modules:

| Module | Model Class | Table Name | Purpose |
|--------|-------------|------------|---------|
| **Auth** | `User` | `users` | Admin & Staff login credentials, roles (`ADMIN`, `HR`, `INVENTORY_MANAGER`, etc.) |
| **HRM** | `EmployeeMaster` | `employee_masters` | Employee personal details, department, supervisor link |
| **HRM** | `CheckIn` | `check_ins` | Punch-in records with GPS location & timestamps |
| **HRM** | `CheckOut` | `check_outs` | Punch-out records with GPS location & timestamps |
| **HRM** | `ProjectSite` | `project_sites` | Site location coordinates & radius for geofencing |
| **Inventory** | `Product` | `inventory_products` | Item master, SKU codes, dual-UOM conversion factors |
| **Inventory** | `Warehouse` | `inventory_warehouses` | Storage locations (Main, Raw Material, Finished Goods, Scrap) |
| **Inventory** | `Partner` | `inventory_partners` | Suppliers, Manufacturers, and Customers |
| **Inventory** | `StockLevel` | `inventory_stock_levels` | Warehouse physical stock balances by Product, Warehouse, Manufacturer & Color |
| **Inventory** | `StockTransaction` | `inventory_transactions` | Central audit ledger of all stock movements (INWARD, OUTWARD, RETURN, etc.) |
| **Inventory** | `Site` | `inventory_sites` | Site master linked with Inventory |
| **Inventory** | `SiteStockLevel` | `inventory_site_stock_levels` | Live stock balances present at project sites |
| **Inventory** | `SiteDispatchLog` | `inventory_site_dispatch_logs` | Audit log of material dispatches & site returns |

---

## 3. Core Business Logic Engines

### 3.1 Dual-UOM Conversion & Smart Alias Matching
* All stock balances in `inventory_stock_levels` and `inventory_products.total_stock` are stored in **base UOM**.
* `uomService.toBaseQuantity()` normalizes input units:
  * `quantity` in `base_uom` $\rightarrow$ `base_quantity = quantity`
  * `quantity` in `purchase_uom` $\rightarrow$ `base_quantity = quantity * conversion_factor`
* **Alias Map:** Typo variations (`Mettar`, `mtr`, `meters`, `metres`) automatically map to `Meter`.

### 3.2 1-Click Stock Reconciliation Engine
Located in `src/modules/inventory/services/reconcile.service.js`:
* Recalculates expected stock from historical ledger (`inventory_transactions`):
  $$\text{Expected} = \sum (\text{INWARD} + \text{RETURN}) - \sum (\text{OUTWARD} + \text{DAMAGE} + \text{SCRAP} + \text{DISPATCH}) + \sum (\text{ADJUSTMENT})$$
* Filters for `status = 'COMPLETED'` and `deletedAt IS NULL`.
* Atomically updates `inventory_stock_levels` and syncs `Product.total_stock`.
* Includes `--dry-run` mode for safe preview without DB mutation.

---

## 4. API Endpoints Reference

### 4.1 Auth & User Module (`/v1/api/auth`, `/v2/api/user`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/v1/api/auth/login` | Public | Authenticate user & return JWT token |
| `POST` | `/v2/api/user/register` | Public | Register new user account |
| `GET` | `/v2/api/user/profile` | 🔒 Token | Fetch logged-in user details |
| `PUT` | `/v2/api/user/change-password` | 🔒 Token | Change own password |
| `PUT` | `/v2/api/user/update-profile/:id` | 🔒 Token | Update user profile info |
| `POST` | `/v2/api/user/logout` | 🔒 Token | Blacklist current JWT token |

### 4.2 HRM Module (`/v2/api/employee`, `/v2/api/project-site`, `/v2/api/attendance`, `/v2/api/export`)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `POST` | `/v2/api/employee/create-employee` | ADMIN, HR | Create single employee record |
| `POST` | `/v2/api/employee/create-bulk-employee` | ADMIN, HR | Bulk create employees |
| `PUT` | `/v2/api/employee/update-employee/:id` | ADMIN, HR | Update employee details |
| `GET` | `/v2/api/employee/get-all-employees` | ADMIN, HR | List all employees |
| `GET` | `/v2/api/employee/get-user-profile` | 🔒 Token | Get logged-in employee profile |
| `POST` | `/v2/api/project-site/create-project-site` | ADMIN, HR | Create geofenced site location |
| `PUT` | `/v2/api/project-site/update-project-site/:id` | ADMIN, HR | Update site coordinates/radius |
| `GET` | `/v2/api/project-site/get-all-project-sites` | 🔒 Token | List all project sites |
| `DELETE` | `/v2/api/project-site/delete-project-site/:id` | ADMIN, HR | Delete project site |
| `POST` | `/v2/api/attendance/checkin` | 🔒 Token | Geofenced punch-in |
| `POST` | `/v2/api/attendance/checkout` | 🔒 Token | Geofenced punch-out |
| `GET` | `/v2/api/attendance/attandace-data` | 🔒 Token | Own attendance history |
| `GET` | `/v2/api/attendance/team-members` | 🔒 Token | Team members attendance |
| `GET` | `/v2/api/attendance/filtered-attendance` | 🔒 Token | Attendance with date/employee filter |
| `GET` | `/v2/api/attendance/full-attendance-report` | 🔒 Token | Complete attendance report |
| `GET` | `/v2/api/attendance/monthly-payroll-report` | 🔒 Token | Monthly payroll calculation |
| `GET` | `/v2/api/export/export-monthly` | 🔒 Token | Export monthly attendance to Excel (`.xlsx`) |

### 4.3 Inventory Module (`/v2/api/inventory`)

| Method | Endpoint | Roles | Search Params | Description |
|--------|----------|-------|---------------|-------------|
| `POST` | `/v2/api/inventory/movement` | Manager* | — | Inward/Outward stock movement |
| `PUT` | `/v2/api/inventory/movement/:id` | Manager* | — | Update existing stock movement |
| `DELETE` | `/v2/api/inventory/movement/:id` | Manager* | — | Reverse-account & delete movement |
| `POST` | `/v2/api/inventory/bulkmovement` | Manager* | — | Bulk stock movement entry |
| `GET` | `/v2/api/inventory/alltransactions` | 🔒 Token | `search`, `q`, `productId`, `type` | Transaction history (paginated) |
| `GET` | `/v2/api/inventory/dashboard` | 🔒 Token | — | Inventory dashboard metrics |
| `GET` | `/v2/api/inventory/available-stock` | 🔒 Token | `search`, `q`, `includeZero` | Stock summary with `godown_names` & `brand_names` |
| `GET` | `/v2/api/inventory/stock` | 🔒 Token | `search`, `q` | Alias for `/available-stock` with `display_stock` |
| `POST` | `/v2/api/inventory/site-return` | Manager* | — | Return unused material from site |
| `POST` | `/v2/api/inventory/reconcile-stock` | ADMIN | `dryRun=true` | 1-click ledger reconciliation |
| `POST` | `/v2/api/inventory/sync-stock` | ADMIN | `dryRun=true` | Alias for `/reconcile-stock` |
| `POST` | `/v2/api/inventory/products` | Manager* | — | Create new product |
| `GET` | `/v2/api/inventory/products` | 🔒 Token | `search`, `q`, `status`, `category` | List products with fuzzy search |
| `PUT` | `/v2/api/inventory/products/:id` | Manager* | — | Update product details |
| `POST` | `/v2/api/inventory/bulkproducts` | Manager* | — | Bulk create products |
| `PATCH` | `/v2/api/inventory/products/:id/toggle-status` | Manager* | — | Toggle active/inactive status |
| `POST` | `/v2/api/inventory/warehouses` | Manager* | — | Create warehouse |
| `GET` | `/v2/api/inventory/warehouses` | 🔒 Token | `search`, `q`, `status`, `type` | List warehouses with fuzzy search |
| `PUT` | `/v2/api/inventory/warehouses/:id` | Manager* | — | Update warehouse details |
| `PATCH` | `/v2/api/inventory/warehouses/:id/toggle-status` | Manager* | — | Toggle warehouse active status |
| `POST` | `/v2/api/inventory/partners` | Manager* | — | Create Supplier/Manufacturer |
| `GET` | `/v2/api/inventory/partners` | 🔒 Token | `search`, `q`, `type`, `status` | List partners with fuzzy search |
| `PUT` | `/v2/api/inventory/partners/:id` | Manager* | — | Update partner details |
| `PATCH` | `/v2/api/inventory/partners/:id/toggle-status` | Manager* | — | Toggle partner active status |
| `POST` | `/v2/api/inventory/ledger/dispatch` | Manager* | — | Issue material to site |
| `POST` | `/v2/api/inventory/ledger/return` | Manager* | — | Return material from site |
| `GET` | `/v2/api/inventory/ledger/consumption/:siteId` | 🔒 Token | — | Site consumption report |

*\*Manager Roles:* `ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`.

---

## 5. CLI Maintenance Scripts

| Command | Purpose |
|---------|---------|
| `npm run start` | Start Node.js server via nodemon (`src/server.js`) |
| `node scripts/sync-stock.js --dry-run` | Run dry-run stock reconciliation (report only, DB untouched) |
| `node scripts/sync-stock.js` | Live commit stock reconciliation against ledger |
| `node scripts/sync-stock.js --json` | Output machine-readable JSON reconciliation report |

---

## 6. Environment Variables (`.env`)

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=u976065191_erp_backend
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=1d
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```
