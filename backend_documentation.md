# ERP-Star Backend — Complete Technical, Architecture & API Documentation

> **Project Name:** ERP-Star Backend (Solid Principle Modular Monolith)  
> **Tech Stack:** Node.js, Express.js 5, MySQL (Sequelize ORM 6), Cloud Redis (`ioredis`), Zod, JWT, ExcelJS  
> **Last Updated:** August 2026 (Version 2.0 - Project Inventory & Cloud Redis Release)  

---

## Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Database Schema & Models (15 Core Models)](#2-database-schema--models-15-core-models)
3. [Project-Based Inventory Hierarchy (`Warehouse → Project → Site`)](#3-project-based-inventory-hierarchy-warehouse--project--site)
4. [Cloud Redis Caching & Memory Management (< 30 MB Cap)](#4-cloud-redis-caching--memory-management--30-mb-cap)
5. [Core Business Logic Engines](#5-core-business-logic-engines)
6. [Complete API Endpoints Reference](#6-complete-api-endpoints-reference)
7. [CLI Maintenance & Migration Scripts](#7-cli-maintenance--migration-scripts)
8. [Environment Variables Reference (`.env`)](#8-environment-variables-reference-env)

---

## 1. System Overview & Architecture

The **ERP-Star Backend** is built using an Enterprise SOLID-compliant Layered Architecture (Composition Root & Dependency Injection pattern).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               CLIENT APPLICATIONS                               │
│                         (Web Dashboard / Mobile App)                            │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ REST API (Bearer JWT)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               EXPRESS 5 ROUTER                                  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      CACHE & SECURITY MIDDLEWARE LAYER                          │
│     (verifyToken, authorizeRoles, Zod Validator, Redis cacheMiddleware)         │
└───────────────────┬─────────────────────────────────────────┬───────────────────┘
                    │ CACHE HIT (< 5ms)                       │ CACHE MISS / FAIL
                    ▼                                         ▼
┌────────────────────────────────────────┐ ┌──────────────────────────────────────┐
│     Return Cached Response JSON        │ │          CONTROLLER LAYER            │
│       (Header: X-Cache: HIT)           │ │ (Project, Outward, Transfer, Report) │
└────────────────────────────────────────┘ └──────────────────┬───────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────────────┐
                                                   │        SERVICE LAYER         │
                                                   │ (Managed Transactions & Rules)│
                                                   └──────────┬───────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────────────┐
                                                   │       REPOSITORY LAYER       │
                                                   │  (Pessimistic SELECT FOR UPDATE)│
                                                   └──────────┬───────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────────────┐
                                                   │      MYSQL 8.0 DATABASE      │
                                                   └──────────────────────────────┘
```

### Key Architectural Highlights:
* **Composition Root Pattern:** `inventory.module.js` and `reports.module.js` act as DI containers where Repositories, Services, and Controllers are instantiated and injected into each other.
* **Project Virtual Inventory Tier:** Materials move `Warehouse → Project → Site`. Every Project maintains an independent stock ledger (`ProjectStockLevel`).
* **Cloud Redis Caching:** All read-heavy GET endpoints are cached in Cloud Redis (`slipless-efficacious-aligned-95408.db.redis.io:15810`) with a 2-Hour Sliding Window Idle Eviction and 30 MB RAM limit protection.
* **Dual-UOM Stock Math:** Every item supports a `base_uom` (e.g. `Meter`) and `purchase_uom` (e.g. `Bundle`). Stock levels are strictly maintained in **base_uom** with 3-decimal precision (`DECIMAL(15,3)`).
* **Row-Level Transaction Safety:** Critical stock updates use `t.LOCK.UPDATE` (`SELECT ... FOR UPDATE`) inside `sequelize.transaction()` to prevent race conditions or overselling.

---

## 2. Database Schema & Models (15 Core Models)

| Module | Model Class | Table Name | Purpose |
|---|---|---|---|
| **Auth** | `User` | `users` | Admin & Staff login credentials, roles (`ADMIN`, `HR`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`) |
| **HRM** | `EmployeeMaster` | `employee_masters` | Employee personal details, department, supervisor link |
| **HRM** | `CheckIn` | `check_ins` | Punch-in records with GPS location & timestamps |
| **HRM** | `CheckOut` | `check_outs` | Punch-out records with GPS location & timestamps |
| **HRM** | `ProjectSite` | `project_sites` | Site location coordinates & radius for geofencing |
| **Inventory** | `Product` | `inventory_products` | Item master, SKU codes, dual-UOM conversion factors |
| **Inventory** | `Warehouse` | `inventory_warehouses` | Storage locations (Main, Raw Material, Finished Goods, Scrap) |
| **Inventory** | `Partner` | `inventory_partners` | Suppliers, Manufacturers, and Customers |
| **Inventory** | `StockLevel` | `inventory_stock_levels` | Warehouse physical stock balances by Product, Warehouse, Manufacturer & Color |
| **Inventory** | `StockTransaction` | `inventory_transactions` | Central audit ledger of all stock movements (INWARD, OUTWARD, RETURN, PROJECT_TRANSFER) |
| **Inventory** | `Project` | `inventory_projects` | Project master (ID, name, client, manager, location, dates) |
| **Inventory** | `ProjectStockLevel` | `inventory_project_stock_levels` | Project-allocated virtual inventory balances |
| **Inventory** | `Site` | `inventory_sites` | Site master linked with Inventory & parent Project FK |
| **Inventory** | `SiteStockLevel` | `inventory_site_stock_levels` | Live stock balances present at project sites |
| **Inventory** | `SiteDispatchLog` | `inventory_site_dispatch_logs` | Audit log of site material dispatches & returns |

---

## 3. Project-Based Inventory Hierarchy (`Warehouse → Project → Site`)

```
┌─────────────────────────┐
│        SUPPLIER         │
└────────────┬────────────┘
             │ INWARD (processStockMovement)
             ▼
┌─────────────────────────┐
│        WAREHOUSE        │  ◄── StockLevel (Warehouse Stock)
└────────────┬────────────┘
             │ OUTWARD (processProjectOutward - Rule 1)
             ▼
┌─────────────────────────┐
│    PROJECT INVENTORY    │  ◄── ProjectStockLevel (Project Stock) ◄──► Inter-Project Transfer (Rule 4)
└────────────┬────────────┘
             │ DISPATCH (dispatchItem - Rule 3)
             ▼
┌─────────────────────────┐
│       PROJECT SITE      │  ◄── SiteStockLevel (Site Stock)
└────────────┬────────────┘
             │ RETURN (returnItem - Rule 4)
             └─────────────────────────► Returns back to PROJECT INVENTORY (NOT Warehouse)
```

### Stock Calculation Formulas:
- **Warehouse Balance**:
  $$\text{Warehouse Balance} = \text{Current Warehouse Quantity} - \text{Warehouse Outward}$$
- **Project Balance**:
  $$\text{Project Balance} = \text{Warehouse Outward} + \text{Site Return} - \text{Site Dispatch} + \text{Transferred In} - \text{Transferred Out}$$
- **Site Stock**:
  $$\text{Current Site Balance} = \text{Site Dispatch} - \text{Consumption} - \text{Site Return}$$

---

## 4. Cloud Redis Caching & Memory Management (< 30 MB Cap)

- **Cloud Instance**: `slipless-efficacious-aligned-95408.db.redis.io:15810`
- **Memory Cap Strategy**: `maxmemory 30mb` with `maxmemory-policy allkeys-lru`.
- **2-Hour Sliding Window Idle Eviction**:
  - GET endpoint responses are cached with an initial 2-hour TTL (`7,200 seconds`).
  - Cache HIT automatically executes `EXPIRE key 7200` to extend the active sliding window.
  - If an API is not accessed for 2 hours, its cache auto-expires to free RAM.
- **24-Hour Max Expiry & Maintenance Job**:
  - Absolute max TTL capped at 24 hours (`86,400 seconds`).
  - Daily background flush job runs at midnight.
- **Fail-Safe Mechanism**:
  - If Redis is offline or drops, operations return `null` and APIs fall back to MySQL transparently without throwing HTTP 500 errors.

---

## 5. Core Business Logic Engines

### 5.1 Dual-UOM Conversion & Smart Alias Matching
* All stock balances in `inventory_stock_levels` and `inventory_project_stock_levels` are stored in **base UOM**.
* `uomService.toBaseQuantity()` normalizes input units:
  * `quantity` in `base_uom` $\rightarrow$ `base_quantity = quantity`
  * `quantity` in `purchase_uom` $\rightarrow$ `base_quantity = quantity * conversion_factor`
* **Alias Map:** Typo variations (`Mettar`, `mtr`, `meters`, `metres`) automatically map to `Meter`.

### 5.2 Stock Reconciliation Engine
Located in `src/modules/inventory/services/reconcile.service.js`:
* Recalculates expected stock from historical ledger (`inventory_transactions`):
  $$\text{Expected} = \sum (\text{INWARD} + \text{RETURN}) - \sum (\text{OUTWARD} + \text{DAMAGE} + \text{SCRAP} + \text{DISPATCH}) + \sum (\text{ADJUSTMENT})$$
* Atomically updates `inventory_stock_levels` and syncs `Product.total_stock`.

---

## 6. Complete API Endpoints Reference

### 6.1 Auth & User Module (`/v1/api/auth`, `/v2/api/user`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/api/auth/login` | Public | Authenticate user & return JWT token |
| `POST` | `/v2/api/user/register` | Public | Register new user account |
| `GET` | `/v2/api/user/profile` | 🔒 Token | Fetch logged-in user details |
| `PUT` | `/v2/api/user/change-password` | 🔒 Token | Change own password |
| `PUT` | `/v2/api/user/update-profile/:id` | 🔒 Token | Update user profile info |
| `POST` | `/v2/api/user/logout` | 🔒 Token | Blacklist current JWT token |

### 6.2 HRM Module (`/v2/api/employee`, `/v2/api/project-site`, `/v2/api/attendance`, `/v2/api/export`)

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `POST` | `/v2/api/employee/create-employee` | ADMIN, HR | Create single employee record |
| `POST` | `/v2/api/employee/create-bulk-employee` | ADMIN, HR | Bulk create employees |
| `PUT` | `/v2/api/employee/update-employee/:id` | ADMIN, HR | Update employee details |
| `GET` | `/v2/api/employee/get-all-employees` | ADMIN, HR | List all employees |
| `POST` | `/v2/api/project-site/create-project-site` | ADMIN, HR | Create geofenced site location |
| `PUT` | `/v2/api/project-site/update-project-site/:id` | ADMIN, HR | Update site coordinates/radius |
| `GET` | `/v2/api/project-site/get-all-project-sites` | 🔒 Token | List all project sites |
| `POST` | `/v2/api/attendance/checkin` | 🔒 Token | Geofenced punch-in |
| `POST` | `/v2/api/attendance/checkout` | 🔒 Token | Geofenced punch-out |
| `GET` | `/v2/api/attendance/full-attendance-report` | 🔒 Token | Complete attendance report |
| `GET` | `/v2/api/export/export-monthly` | 🔒 Token | Export monthly attendance to Excel (`.xlsx`) |

### 6.3 Project & Inventory Module (`/v2/api/inventory`)

| Method | Endpoint | Roles | Optimization | Description |
|---|---|---|---|---|
| `POST` | `/v2/api/inventory/projects` | Manager* | Purge Cache | Create new Project |
| `GET` | `/v2/api/inventory/projects` | 🔒 Token | **Redis Cache (2h)** | List Projects |
| `GET` | `/v2/api/inventory/projects/:id` | 🔒 Token | — | Get Project details & sites |
| `PUT` | `/v2/api/inventory/projects/:id` | Manager* | Purge Cache | Update Project metadata |
| `PATCH`| `/v2/api/inventory/projects/:id/toggle-status` | Manager* | Purge Cache | Toggle Project active status |
| `GET` | `/v2/api/inventory/projects/:id/stock` | 🔒 Token | **Redis Cache (2h)** | View Project Stock balance |
| `GET` | `/v2/api/inventory/projects/:id/sites` | 🔒 Token | — | View sites linked to Project |
| `POST` | `/v2/api/inventory/project-outward` | Manager* | Purge Cache | Warehouse → Project Outward |
| `POST` | `/v2/api/inventory/project-transfer` | Manager* | Purge Cache | Project A → Project B Transfer |
| `POST` | `/v2/api/inventory/ledger/dispatch` | Manager* | Purge Cache | Project → Site Dispatch |
| `POST` | `/v2/api/inventory/ledger/return` | Manager* | Purge Cache | Site → Project Return |
| `POST` | `/v2/api/inventory/movement` | Manager* | Purge Cache | Warehouse Inward/Outward movement |
| `GET` | `/v2/api/inventory/alltransactions` | 🔒 Token | **Redis Cache (2h)** | Transaction history ledger |
| `GET` | `/v2/api/inventory/dashboard` | 🔒 Token | **Redis Cache (2h)** | Inventory dashboard metrics |
| `GET` | `/v2/api/inventory/available-stock` | 🔒 Token | **Redis Cache (2h)** | Warehouse Available Stock |
| `GET` | `/v2/api/inventory/stock` | 🔒 Token | **Redis Cache (2h)** | Available Stock with `display_stock` |
| `GET` | `/v2/api/inventory/products` | 🔒 Token | **Redis Cache (2h)** | Product Master list |
| `GET` | `/v2/api/inventory/warehouses` | 🔒 Token | **Redis Cache (2h)** | Warehouse list |
| `GET` | `/v2/api/inventory/partners` | 🔒 Token | **Redis Cache (2h)** | Supplier/Manufacturer list |
| `GET` | `/v2/api/inventory/site` | 🔒 Token | **Redis Cache (2h)** | List Inventory Sites |

### 6.4 Reports Module (`/v2/api/inventory/reports`, `/api/v1/reports`)

| Method | Endpoint | Roles | Optimization | Description |
|---|---|---|---|---|
| `GET` | `/v2/api/inventory/reports/project-consumption` | 🔒 Token | **Redis Cache (2h)** | Project-wise Opening, Received, Distributed, Returned, Consumed & Closing stock |
| `GET` | `/v2/api/inventory/reports/site-consumption` | 🔒 Token | **Redis Cache (2h)** | Site-wise Issued, Returned, Consumed & Current Site stock |
| `GET` | `/api/v1/reports/site-material-summary` | 🔒 Token | **Redis Cache (2h)** | Summarized Site Material report |

*\*Manager Roles:* `ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`.

---

## 7. CLI Maintenance & Migration Scripts

| Command | Purpose |
|---|---|
| `npm run start` | Start Node.js server via nodemon (`src/server.js`) |
| `node scripts/migrate-project-inventory.js` | Non-destructive database DDL creation & Project ID backfill |
| `node scripts/sync-stock.js --dry-run` | Run dry-run stock reconciliation (report only, DB untouched) |
| `node scripts/sync-stock.js` | Live commit stock reconciliation against ledger |

---

## 8. Environment Variables Reference (`.env`)

```env
PORT=3000
NODE_ENV=production
SYSTEM_IP=192.168.1.2

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=star_erp_db
DB_DIALECT=mysql

JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=1d
INTERNAL_API_KEY=CodeVantage_ERP_Direct_Access_2026

CLIENT_URL=https://erp.starsupplierss.com
ALLOWED_ORIGINS=https://erp.starsupplierss.com,http://localhost:3000,http://localhost:5173

# --- REDIS CLOUD CONNECTION ---
REDIS_HOST=slipless-efficacious-aligned-95408.db.redis.io
REDIS_PORT=15810
REDIS_USERNAME=default
REDIS_PASSWORD=DbaZVHV3dAr0TmJ4gh0MGLuqxBAt208O
REDIS_URL=redis://default:DbaZVHV3dAr0TmJ4gh0MGLuqxBAt208O@slipless-efficacious-aligned-95408.db.redis.io:15810
```
