# ERP Backend — Complete Architecture, Database Schema & API Reference Manual
## Project-Based Inventory Flow & Cloud Redis Caching System

> **Document Version:** 2.0.0 (Master Release)  
> **Date:** 2026-08-05  
> **Target Audience:** Technical Leads, Enterprise Architects, Backend Engineers, QA, DevOps  
> **Codebase:** `erp-backend-solid-principle` (Node.js / Express 5 / Sequelize 6 / MySQL 8 / Redis Cloud)

---

## 1. Executive Summary & Core Objectives

The **Project Inventory Layer** introduces an intermediate inventory management tier between central **Warehouses** and **Project Sites**. 

### Core Objectives Achieved:
1. **Strict Hierarchy Enforcement**: Materials move `Warehouse → Project → Site`. Direct Warehouse to Site dispatches are strictly restricted.
2. **Project Virtual Inventory**: Every Project maintains its own allocated stock balance (`ProjectStockLevel`).
3. **Site Distribution & Return Isolation**: Site dispatches deduct from Project stock, and Site returns replenish Project stock. Warehouse inventory remains untouched during site operations.
4. **Inter-Project Transfers**: Direct stock transfers between projects with atomic lock controls.
5. **Micro-Level Consumption Reporting**: Date-windowed Opening Stock, Received, Distributed, Returned, Consumed, and Closing Stock analytics.
6. **Cloud Redis Caching (< 30 MB RAM)**: High-speed read caching with a 2-Hour Sliding Window Idle Eviction and 24-Hour Max Expiry Cap.

---

## 2. High-Level System Architecture (HLD)

### 2.1 Component Architecture Layering

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
│       (Header: X-Cache: HIT)           │ │  (Project, Outward, Transfer, Rpt)   │
└────────────────────────────────────────┘ └──────────────────┬───────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────────────┐
                                                   │        SERVICE LAYER         │
                                                   │ (Managed Transactions & Business)│
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

### 2.2 Inventory Material Movement Flow

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

---

## 3. Low-Level Design (LLD) & Design Patterns

### 3.1 SOLID Principles Compliance

- **S (Single Responsibility Principle)**:
  - `ProjectStockRepository`: Owns SQL queries, variant keys, and row locks.
  - `ProjectOutwardService`: Owns business logic for Warehouse → Project transfers.
  - `ProjectTransferService`: Owns business logic for Project A → Project B transfers.
  - `ProjectController`: Shapes DTOs and handles HTTP status responses.
- **O (Open/Closed Principle)**:
  - Extended system behavior via **Opt-In Guard Pattern** (`if (site.project_id)`). Legacy sites without `project_id` continue functioning without modifying core code paths.
- **L (Liskov Substitution Principle)**:
  - `ProjectStockRepository` extends `BaseRepository` and satisfies all base repository interface contracts.
- **I (Interface Segregation Principle)**:
  - Services receive only explicit required dependencies via constructor injection.
- **D (Dependency Inversion Principle)**:
  - High-level modules depend on repository abstractions wired in Composition Roots (`inventory.module.js` & `reports.module.js`).

### 3.2 Concurrency & Transaction Management

All mutating stock calls operate inside managed transactions with pessimistic row locks:

```javascript
return this.sequelize.transaction(async (t) => {
  // 1. Lock source row for update (SELECT ... FOR UPDATE)
  const sourceStock = await this.projectStockRepo.findForUpdate(key, t);
  
  // 2. Validate availability in Base UOM
  if (baseQty > Number(sourceStock.current_quantity)) {
    throw new AppError("Insufficient stock in Project Inventory", 400);
  }
  
  // 3. Atomically update balances
  await sourceStock.update({ current_quantity: newQty }, { transaction: t });
  
  // 4. Record audit ledger entry
  await this.logRepo.create(logData, { transaction: t });
});
```

---

## 4. Cloud Redis Architecture (< 30 MB Memory Cap)

### 4.1 Redis Connection Details
- **Host**: `slipless-efficacious-aligned-95408.db.redis.io`
- **Port**: `15810`
- **Username**: `default`
- **Password**: `DbaZVHV3dAr0TmJ4gh0MGLuqxBAt208O`
- **Status**: 🟢 **CONNECTED & LIVE**

### 4.2 Dynamic Eviction & Expiry Rules

```
 30 MB MAXIMUM RAM BUDGET CAP
 ├── Maxmemory Policy: allkeys-lru (automatic LRU eviction)
 ├── Rule A: 2-Hour Sliding Window Idle Eviction
 │     ├── Base TTL = 7,200 Seconds (2 Hours)
 │     └── Cache HIT -> Automatically executes EXPIRE key 7200 (resets timer)
 └── Rule B: 24-Hour Hard Expiry Cap & Maintenance Job
       ├── Absolute Max TTL = 86,400 Seconds (24 Hours)
       └── Daily Scheduled Job -> Flushes stale cache keys every 24 hours at midnight
```

### 4.3 Fail-Safe Mechanism
If Redis connection drops or reaches memory limits, the application **automatically falls back to MySQL database execution** without throwing HTTP 500 errors.

---

## 5. Database Schema Reference

### 5.1 Entity Relationship Diagram (ERD)

```
[inventory_projects] 1 ─── N [inventory_project_stock_levels]
[inventory_products] 1 ─── N [inventory_project_stock_levels]
[inventory_projects] 1 ─── N [inventory_sites]
[inventory_sites]    1 ─── N [inventory_site_stock_levels]
[inventory_projects] 1 ─── N [inventory_site_dispatch_logs]
[inventory_projects] 1 ─── N [inventory_transactions]
[inventory_projects] 1 ─── N [inventory_site_material_returns]
```

### 5.2 Table Definitions

#### 1. `inventory_projects` (New)
```sql
CREATE TABLE inventory_projects (
  id CHAR(36) BINARY PRIMARY KEY,
  project_name VARCHAR(255) NOT NULL UNIQUE,
  project_code VARCHAR(255) UNIQUE NULL,
  description TEXT NULL,
  client_name VARCHAR(255) NULL,
  manager_name VARCHAR(255) NULL,
  contact_number VARCHAR(100) NULL,
  location TEXT NULL,
  start_date DATETIME NULL,
  end_date DATETIME NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  deletedAt DATETIME NULL
);
```

#### 2. `inventory_project_stock_levels` (New)
```sql
CREATE TABLE inventory_project_stock_levels (
  id CHAR(36) BINARY PRIMARY KEY,
  project_id CHAR(36) BINARY NOT NULL,
  ProductId CHAR(36) BINARY NOT NULL,
  manufacturer_id CHAR(36) BINARY NULL,
  color VARCHAR(255) NULL DEFAULT 'Standard',
  current_quantity DECIMAL(15,3) NOT NULL DEFAULT 0.000,
  last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY unique_project_stock_idx (project_id, ProductId, manufacturer_id, color),
  FOREIGN KEY (project_id) REFERENCES inventory_projects(id),
  FOREIGN KEY (ProductId) REFERENCES inventory_products(id)
);
```

#### 3. Table Column Modifications
- `inventory_sites`: Added `project_id` UUID column.
- `inventory_site_dispatch_logs`: Added `project_id` UUID column & index.
- `inventory_transactions`: Added `project_id` UUID column, index, and updated `type` ENUM to include `'PROJECT_TRANSFER'`.
- `inventory_site_material_returns`: Modified `WarehouseId` to `allowNull: true` and added `project_id` column.

---

## 6. Stock Calculation Formulas & Math

### A. Warehouse Stock
$$\text{Warehouse Balance} = \text{Current Warehouse Quantity} - \text{Warehouse Outward}$$

### B. Project Stock
$$\text{Project Balance} = \text{Warehouse Outward} + \text{Site Return} - \text{Site Dispatch} + \text{Transferred In} - \text{Transferred Out}$$

### C. Site Stock
$$\text{Current Site Balance} = \text{Site Dispatch} - \text{Consumption} - \text{Site Return}$$

---

## 7. Complete API Reference

### 7.1 Project Management Endpoints

| Endpoint | Method | Auth Roles | Description |
| --- | --- | --- | --- |
| `/v2/api/inventory/projects` | `POST` | Admin, Inv Manager, Factory Manager | Create new Project |
| `/v2/api/inventory/projects` | `GET` | Authenticated Users | List Projects (Cached in Redis) |
| `/v2/api/inventory/projects/:id` | `GET` | Authenticated Users | Get Project detail & linked sites |
| `/v2/api/inventory/projects/:id` | `PUT` | Admin, Inv Manager, Factory Manager | Update Project details |
| `/v2/api/inventory/projects/:id/toggle-status` | `PATCH` | Admin, Inv Manager, Factory Manager | Activate / Deactivate Project |
| `/v2/api/inventory/projects/:id/stock` | `GET` | Authenticated Users | View Project Stock (Cached in Redis) |
| `/v2/api/inventory/projects/:id/sites` | `GET` | Authenticated Users | View sites linked to Project |

### 7.2 Stock Transfer & Movement Endpoints

| Endpoint | Method | Auth Roles | Description |
| --- | --- | --- | --- |
| `/v2/api/inventory/project-outward` | `POST` | Admin, Inv Manager, Factory Manager | Warehouse → Project Outward |
| `/v2/api/inventory/ledger/dispatch` | `POST` | Admin, Inv Manager, Factory Manager | Project → Site Dispatch |
| `/v2/api/inventory/ledger/return` | `POST` | Admin, Inv Manager, Factory Manager | Site → Project Return |
| `/v2/api/inventory/project-transfer` | `POST` | Admin, Inv Manager, Factory Manager | Project A → Project B Transfer |

### 7.3 Consumption Report Endpoints

| Endpoint | Method | Auth Roles | Description |
| --- | --- | --- | --- |
| `/v2/api/inventory/reports/project-consumption` | `GET` | Authenticated Users | Project Consumption Report (Cached) |
| `/v2/api/inventory/reports/site-consumption` | `GET` | Authenticated Users | Site Consumption Report (Cached) |

---

## 8. Frontend & UI Alignment Instructions

1. **Warehouse Outward Screen**:
   - Hide/Remove `Site` dropdown.
   - Show `Project` dropdown (`GET /v2/api/inventory/projects?status=true`).
   - Fields: Project, Material, Quantity, Vehicle (`vehicle_number`), Driver, Challan (`reference_no`), Dispatch Date (`movement_date`).
2. **Project Inventory Screen**:
   - New screen listing Material, SKU, Received, Distributed, Returned, Current Balance.
3. **Site Dispatch Screen**:
   - Lock source to **Project Inventory** (displays Project stock balance).
4. **Site Return Screen**:
   - Lock destination to **Project Inventory** (material returns to Project).

---

## 9. Operations & Verification Commands

- **Run DB Migration**:
  ```bash
  node scripts/migrate-project-inventory.js
  ```
- **Test App Boot & Redis Connection**:
  ```bash
  node -e "require('dotenv').config(); const db = require('./src/common/index.db'); const redis = require('./src/common/redis.client'); db.sequelize.authenticate().then(() => console.log('✅ DB OK'));"
  ```
