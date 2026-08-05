# ERP Backend — Project Inventory, Inter-Project Transfer & Consumption Reports
## Complete Architecture (HLD + LLD), Database Schema & API Reference Manual

> **Document Version:** 1.0.0  
> **Date:** 2026-08-05  
> **Target Audience:** Enterprise Architects, Backend Developers, QA Engineers, DevOps  
> **Codebase:** `erp-backend-solid-principle` (Node.js / Express 5 / Sequelize 6 / MySQL 8)

---

## Table of Contents
1. [Executive Summary & Business Context](#1-executive-summary--business-context)
2. [High-Level Architecture (HLD)](#2-high-level-architecture-hld)
   - [System Context & Architecture Pattern](#21-system-context--architecture-pattern)
   - [Stock Inventory Flow Diagram](#22-stock-inventory-flow-diagram)
   - [Subsystem Isolation & Boundaries](#23-subsystem-isolation--boundaries)
3. [Low-Level Design (LLD) & Design Patterns](#3-low-level-design-lld--design-patterns)
   - [SOLID Principles Compliance](#31-solid-principles-compliance)
   - [Design Patterns Implemented](#32-design-patterns-implemented)
   - [Transaction Ownership & Concurrency Model](#33-transaction-ownership--concurrency-model)
4. [Database Architecture & Schema Reference](#4-database-architecture--schema-reference)
   - [Entity Relationship Diagram (ERD)](#41-entity-relationship-diagram-erd)
   - [New Tables Schema](#42-new-tables-schema)
   - [Modified Tables & Indexes](#43-modified-tables--indexes)
5. [Business Logic & Stock Rules](#5-business-logic--stock-rules)
   - [Req #1: Warehouse → Project Outward](#51-req-1-warehouse--project-outward)
   - [Req #2: Project → Site Distribution](#52-req-2-project--site-distribution)
   - [Req #3: Site → Project Return](#53-req-3-site--project-return)
   - [Req #4: Project → Project Transfer](#54-req-4-project--project-transfer)
   - [Req #5: Consumption Calculation Rules](#55-req-5-consumption-calculation-rules)
6. [API Reference Specification](#6-api-reference-specification)
   - [Project Management Endpoints](#61-project-management-endpoints)
   - [Stock Transfer Endpoints](#62-stock-transfer-endpoints)
   - [Consumption Report Endpoints](#63-consumption-report-endpoints)
7. [Migration & Deployment Guide](#7-migration--deployment-guide)

---

## 1. Executive Summary & Business Context

The **Project Inventory Layer** introduces a dedicated intermediate inventory holding layer between main **Warehouses** and **Project Sites**. 

Prior to this implementation, materials were dispatched directly from Warehouses to Sites, or returned from Sites directly to Warehouse `Product.total_stock`. This enhancement decouples project-allocated inventory from unallocated warehouse stock and provides full traceability across:
- **Warehouse to Project Allocation**
- **Project to Site Material Distribution**
- **Site to Project Returns**
- **Inter-Project Material Transfers**
- **Project & Site Date-Windowed Consumption Reporting**

---

## 2. High-Level Architecture (HLD)

### 2.1 System Context & Architecture Pattern

The system uses a **Modular Monolith** pattern with **Composition Root Dependency Injection**.

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
│                          SECURITY & VALIDATION LAYER                            │
│                 (verifyToken, authorizeRoles, Zod Schema Validator)             │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               CONTROLLER LAYER                                  │
│          (ProjectController, ProjectOutwardController, TransferController)       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                SERVICE LAYER                                    │
│             (ProjectService, ProjectOutwardService, TransferService)            │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               REPOSITORY LAYER                                  │
│             (ProjectStockRepository, ConsumptionReportRepository)               │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SEQUELIZE 6 ORM                                    │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Managed Transactions & Pessimistic Locks
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MYSQL 8.0 DATABASE                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Stock Inventory Flow Diagram

```
┌─────────────────────────┐
│        SUPPLIER         │
└────────────┬────────────┘
             │ INWARD (processStockMovement)
             ▼
┌─────────────────────────┐
│        WAREHOUSE        │  ◄── StockLevel (Warehouse Stock)
└────────────┬────────────┘
             │ OUTWARD (processProjectOutward - Req #1)
             ▼
┌─────────────────────────┐
│    PROJECT INVENTORY    │  ◄── ProjectStockLevel (Project Stock) ◄──► Inter-Project Transfer (Req #4)
└────────────┬────────────┘
             │ DISPATCH (dispatchItem - Req #2)
             ▼
┌─────────────────────────┐
│       PROJECT SITE      │  ◄── SiteStockLevel (Site Stock)
└────────────┬────────────┘
             │ RETURN (returnItem - Req #3)
             └─────────────────────────► Returns back to PROJECT stock
```

### 2.3 Subsystem Isolation & Boundaries

- **Auth Module (`src/modules/auth`)**: JWT issuance, user identities, roles (`ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`).
- **Inventory Module (`src/modules/inventory`)**: Product master, Warehouse stock, Project stock, Site stock, Movements, Transfers.
- **Reports Module (`src/modules/reports`)**: Read-only aggregations and analytics.
- **HRM Module (`src/modules/hrm`)**: Employee profiles and geofenced attendance (`ProjectSite`).

---

## 3. Low-Level Design (LLD) & Design Patterns

### 3.1 SOLID Principles Compliance

1. **Single Responsibility Principle (SRP)**:
   - `ProjectStockRepository` owns SQL queries and row locks.
   - `ProjectOutwardService` owns business rules for Warehouse → Project transfers.
   - `ProjectTransferService` owns business rules for Project A → Project B transfers.
   - `ProjectController` shapes DTOs and handles HTTP status codes.
2. **Open/Closed Principle (OCP)**:
   - System behavior is extended via opt-in guards (`if (site.project_id)`). Existing legacy flows remain open for extension without modifying core legacy behavior.
3. **Liskov Substitution Principle (LSP)**:
   - `ProjectStockRepository` extends `BaseRepository` and adheres strictly to its repository contracts.
4. **Interface Segregation Principle (ISP)**:
   - Services request only the exact repositories they require via constructor parameter destructuring.
5. **Dependency Inversion Principle (DIP)**:
   - Controllers and services depend on abstractions passed into their constructors via the Composition Root (`inventory.module.js`).

### 3.2 Design Patterns Implemented

- **Repository Pattern**: Encapsulates database operations and Sequelize interactions.
- **Composition Root (Dependency Injection)**: Single wiring point (`inventory.module.js` and `reports.module.js`).
- **Pessimistic Locking / Unit of Work**: Uses `t.LOCK.UPDATE` inside managed transactions (`sequelize.transaction`).
- **Opt-In Strategy Guard**: Routes execution path dynamically based on entity metadata (`site.project_id`).

### 3.3 Transaction Ownership & Concurrency Model

All mutating stock operations execute within managed database transactions:

```javascript
return this.sequelize.transaction(async (t) => {
  // 1. Lock source stock row with SELECT ... FOR UPDATE
  const sourceStock = await this.repo.findForUpdate(key, t);
  
  // 2. Validate stock availability in base UOM
  if (baseQty > sourceStock.current_quantity) {
    throw new AppError("Insufficient stock", 400);
  }
  
  // 3. Mutate source and target stock counters atomically
  await sourceStock.update({ current_quantity: newQty }, { transaction: t });
  
  // 4. Record audit ledger entry
  await this.logRepo.create(logData, { transaction: t });
});
```

---

## 4. Database Architecture & Schema Reference

### 4.1 Entity Relationship Diagram (ERD)

```
[inventory_projects] 1 ─── N [inventory_project_stock_levels]
[inventory_products] 1 ─── N [inventory_project_stock_levels]
[inventory_projects] 1 ─── N [inventory_sites]
[inventory_sites]    1 ─── N [inventory_site_stock_levels]
[inventory_projects] 1 ─── N [inventory_site_dispatch_logs]
[inventory_projects] 1 ─── N [inventory_transactions]
[inventory_projects] 1 ─── N [inventory_site_material_returns]
```

### 4.2 New Tables Schema

#### Table 1: `inventory_projects`

| Column Name | Data Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `UUID` | Primary Key | `UUIDV4` | Unique Project Identifier |
| `project_name` | `VARCHAR(255)` | NOT NULL, UNIQUE | - | Project Display Name |
| `project_code` | `VARCHAR(255)` | UNIQUE, NULLABLE | NULL | Unique Short Code |
| `description` | `TEXT` | NULLABLE | NULL | Project Details |
| `client_name` | `VARCHAR(255)` | NULLABLE | NULL | Client Entity Name |
| `manager_name` | `VARCHAR(255)` | NULLABLE | NULL | Assigned Project Manager |
| `contact_number` | `VARCHAR(100)` | NULLABLE | NULL | Contact Phone Number |
| `location` | `TEXT` | NULLABLE | NULL | Project Address/Location |
| `start_date` | `DATETIME` | NULLABLE | NULL | Planned Start Date |
| `end_date` | `DATETIME` | NULLABLE | NULL | Planned End Date |
| `is_active` | `BOOLEAN` | NOT NULL | `true` | Active Status Flag |
| `createdAt` | `DATETIME` | NOT NULL | `NOW()` | Creation Timestamp |
| `updatedAt` | `DATETIME` | NOT NULL | `NOW()` | Update Timestamp |
| `deletedAt` | `DATETIME` | NULLABLE | NULL | Soft Delete Timestamp |

#### Table 2: `inventory_project_stock_levels`

| Column Name | Data Type | Constraints | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `UUID` | Primary Key | `UUIDV4` | Stock Record ID |
| `project_id` | `UUID` | FK → `inventory_projects.id` | - | Parent Project FK |
| `ProductId` | `UUID` | FK → `inventory_products.id` | - | Product Item FK |
| `manufacturer_id` | `UUID` | NULLABLE | NULL | Manufacturer Partner FK |
| `color` | `VARCHAR(255)` | NULLABLE | `'Standard'` | Variant Color |
| `current_quantity` | `DECIMAL(15,3)` | NOT NULL | `0.000` | Stock Counter in Base UOM |
| `last_updated_at` | `DATETIME` | NOT NULL | `NOW()` | Last Stock Mutation Time |

**Indexes**:
- `unique_project_stock_idx`: UNIQUE `(project_id, ProductId, manufacturer_id, color)`
- `idx_project_stock_proj`: `(project_id)`
- `idx_project_stock_prod`: `(ProductId)`

### 4.3 Modified Tables & Indexes

- **`inventory_sites`**: Added `project_id` (UUID, Foreign Key → `inventory_projects.id`, Nullable).
- **`inventory_site_dispatch_logs`**: Added `project_id` (UUID, Foreign Key → `inventory_projects.id`, Nullable) and index on `(project_id)`.
- **`inventory_transactions`**: Added `project_id` (UUID, Nullable), index on `(project_id)`, and updated `type` ENUM to: `'INWARD','OUTWARD','RETURN','DAMAGE','ADJUSTMENT','SCRAP','DISPATCH','PROJECT_TRANSFER'`.
- **`inventory_site_material_returns`**: Modified `WarehouseId` to `allowNull: true` and added `project_id` (UUID, Nullable).

---

## 5. Business Logic & Stock Rules

### 5.1 Req #1: Warehouse → Project Outward

- **Source**: Warehouse `StockLevel` variant buckets.
- **Target**: `ProjectStockLevel`.
- **Validation**:
  - `Warehouse` and `Product` must be active.
  - `Project` must be active.
  - Sum of warehouse `StockLevel.current_quantity` across matching variant buckets >= `baseQty`.
- **Mutation**:
  - Greedy drain from warehouse `StockLevel` rows (fullest bucket first).
  - Lock/findOrCreate target `ProjectStockLevel` row and increment `current_quantity` by `baseQty`.
  - Record `StockTransaction` (type: `'OUTWARD'`, `project_id` set).

### 5.2 Req #2: Project → Site Distribution

- **Source**: `ProjectStockLevel` (when site is linked to a project).
- **Target**: `SiteStockLevel`.
- **Validation**:
  - `ProjectStockLevel.current_quantity` >= `baseQty`.
- **Mutation**:
  - Decrement `ProjectStockLevel.current_quantity` by `baseQty`.
  - Increment `SiteStockLevel.inHandQty` by `baseQty`.
  - Record `SiteDispatchLog` (type: `'DISPATCH'`, `project_id` set).

### 5.3 Req #3: Site → Project Return

- **Source**: `SiteStockLevel`.
- **Target**: `ProjectStockLevel` (when site is linked to a project).
- **Validation**:
  - Sum of `SiteStockLevel.inHandQty` across site buckets >= `baseQty`.
- **Mutation**:
  - Greedy drain `SiteStockLevel.inHandQty`.
  - Increment `ProjectStockLevel.current_quantity` by `baseQty`.
  - Record `SiteDispatchLog` (type: `'RETURN'`, `project_id` set).
  - Record `SiteMaterialReturn` audit row (`project_id` set, `WarehouseId` nullable).

### 5.4 Req #4: Project → Project Transfer

- **Source**: Source `ProjectStockLevel`.
- **Target**: Target `ProjectStockLevel`.
- **Validation**:
  - Source and target projects must be active and distinct.
  - Source `ProjectStockLevel.current_quantity` >= `baseQty`.
- **Mutation**:
  - Lock and decrement source `ProjectStockLevel.current_quantity`.
  - Lock and increment target `ProjectStockLevel.current_quantity`.
  - Record `StockTransaction` (type: `'PROJECT_TRANSFER'`, `project_id` = source project).

### 5.5 Req #5: Consumption Calculation Rules

#### Project-Wise Consumption Formula:
$$\text{Opening Stock} = \text{Received}_{\text{pre}} - \text{Distributed}_{\text{pre}} + \text{Returned}_{\text{pre}}$$
$$\text{Consumed} = \text{Distributed}_{\text{window}} - \text{Returned}_{\text{window}}$$
$$\text{Closing Stock} = \text{Opening Stock} + \text{Received}_{\text{window}} - \text{Distributed}_{\text{window}} + \text{Returned}_{\text{window}}$$

#### Site-Wise Consumption Formula:
$$\text{Opening Stock} = \text{Dispatched}_{\text{pre}} - \text{Returned}_{\text{pre}}$$
$$\text{Consumed} = \text{Opening Stock} + \text{Received}_{\text{window}} - \text{Returned}_{\text{window}} - \text{Current Site Stock}$$
$$\text{Closing Stock} = \text{Current Site Stock}$$

---

## 6. API Reference Specification

### 6.1 Project Management Endpoints

#### 1. Create Project
- **Endpoint**: `POST /v2/api/inventory/projects`
- **Access**: Private (`ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`)
- **Request Body**:
```json
{
  "project_name": "Metro Line Expansion - Phase 1",
  "project_code": "PRJ-METRO-01",
  "description": "Substructure and wiring project",
  "client_name": "DMRC",
  "manager_name": "Rajesh Kumar",
  "contact_number": "9876543210",
  "location": "Sector 62, Noida"
}
```
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Project created successfully",
  "data": {
    "id": "c6a2b8e0-1122-4399-8877-abc123456789",
    "project_name": "Metro Line Expansion - Phase 1",
    "project_code": "PRJ-METRO-01",
    "is_active": true,
    "createdAt": "2026-08-05T12:00:00.000Z"
  }
}
```

#### 2. Get All Projects
- **Endpoint**: `GET /v2/api/inventory/projects?status=true&search=Metro`
- **Access**: Private (Authenticated Users)
- **Response (200 OK)**:
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "c6a2b8e0-1122-4399-8877-abc123456789",
      "project_name": "Metro Line Expansion - Phase 1",
      "project_code": "PRJ-METRO-01",
      "client_name": "DMRC",
      "is_active": true
    }
  ]
}
```

#### 3. Get Project Stock Levels
- **Endpoint**: `GET /v2/api/inventory/projects/:id/stock`
- **Access**: Private (Authenticated Users)
- **Response (200 OK)**:
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "f1e2d3c4-b5a6-7890-1234-56789abcdef0",
      "project_id": "c6a2b8e0-1122-4399-8877-abc123456789",
      "ProductId": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
      "color": "Standard",
      "current_quantity": "500.000",
      "Product": {
        "id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
        "name": "Copper Cable 4sqmm",
        "sku_code": "CAB-COP-04",
        "base_uom": "Meter"
      }
    }
  ]
}
```

---

### 6.2 Stock Transfer Endpoints

#### 1. Warehouse to Project Outward
- **Endpoint**: `POST /v2/api/inventory/project-outward`
- **Access**: Private (`ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`)
- **Request Body**:
```json
{
  "warehouse_id": "wh-uuid-1111",
  "project_id": "c6a2b8e0-1122-4399-8877-abc123456789",
  "item_id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
  "quantity": 10,
  "uom": "Bundle",
  "reference_no": "CHALLAN-8890",
  "remarks": "Initial project allocation"
}
```
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Material successfully transferred from Warehouse to Project stock.",
  "data": {
    "transactionId": "tx-uuid-9999",
    "project_id": "c6a2b8e0-1122-4399-8877-abc123456789",
    "project_name": "Metro Line Expansion - Phase 1",
    "quantity": 10,
    "uom": "Bundle",
    "base_quantity": 1000,
    "base_uom": "Meter",
    "project_stock_after": 1000
  }
}
```

#### 2. Inter-Project Transfer
- **Endpoint**: `POST /v2/api/inventory/project-transfer`
- **Access**: Private (`ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`)
- **Request Body**:
```json
{
  "source_project_id": "c6a2b8e0-1122-4399-8877-abc123456789",
  "target_project_id": "d7b3c9f1-2233-4400-9988-bcd234567890",
  "item_id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
  "quantity": 200,
  "uom": "Meter",
  "reference_no": "XFER-2026-01",
  "remarks": "Urgent transfer for Phase 2 site"
}
```
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Material successfully transferred between projects.",
  "data": {
    "transactionId": "tx-uuid-8888",
    "source_project_name": "Metro Line Expansion - Phase 1",
    "target_project_name": "Metro Line Expansion - Phase 2",
    "quantity": 200,
    "uom": "Meter",
    "base_quantity": 200,
    "target_project_stock_after": 200
  }
}
```

---

### 6.3 Consumption Report Endpoints

#### 1. Project-Wise Consumption Report
- **Endpoint**: `GET /v2/api/inventory/reports/project-consumption?fromDate=2026-08-01&toDate=2026-08-31`
- **Access**: Private (Authenticated Users)
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "reportType": "PROJECT_CONSUMPTION",
  "count": 1,
  "rows": [
    {
      "projectId": "c6a2b8e0-1122-4399-8877-abc123456789",
      "projectName": "Metro Line Expansion - Phase 1",
      "projectCode": "PRJ-METRO-01",
      "openingStock": 0,
      "receivedFromWarehouse": 1000,
      "distributedToSites": 400,
      "returnedFromSites": 50,
      "consumed": 350,
      "closingStock": 650
    }
  ]
}
```

#### 2. Site-Wise Consumption Report
- **Endpoint**: `GET /v2/api/inventory/reports/site-consumption?projectId=c6a2b8e0-1122-4399-8877-abc123456789`
- **Access**: Private (Authenticated Users)
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "reportType": "SITE_CONSUMPTION",
  "count": 1,
  "rows": [
    {
      "siteId": "site-uuid-101",
      "siteName": "Noida Sec 62 Site",
      "projectId": "c6a2b8e0-1122-4399-8877-abc123456789",
      "projectName": "Metro Line Expansion - Phase 1",
      "openingStock": 0,
      "receivedFromProject": 400,
      "returnedToProject": 50,
      "consumed": 250,
      "closingStock": 100
    }
  ]
}
```

---

## 7. Migration & Deployment Guide

To deploy this update to an environment:

1. **Environment Verification**: Ensure `.env` is loaded with proper DB credentials.
2. **Execute Database Migration**:
   ```bash
   node scripts/migrate-project-inventory.js
   ```
   *This script runs DDL table creations, adds nullable columns, updates ENUMs, and backfills Project IDs from legacy text fields idempotently.*
3. **Verify Server Boot**:
   ```bash
   node -e "require('./src/app.js'); console.log('Boot Successful');"
   ```
4. **Deploy Application Server**: Restart Node.js application process (e.g. via PM2 / Docker).
