# ERP-Star Backend — API Documentation

REST API reference for the ERP-Star backend (Express 5 + Sequelize/MySQL).

---

## 1. General Information

| Item | Value |
|------|-------|
| **Base URL (prod)** | `https://erp.starsupplierss.com` (or your server host) |
| **Base URL (local)** | `http://localhost:3000` |
| **Content-Type** | `application/json` |
| **Auth scheme** | JWT Bearer token in `Authorization` header |
| **Health check** | `GET /` → `✅ ERP-Star Backend is Running Successfully!` |

### API Versioning
- Auth login lives under **`/v1/api`**.
- Everything else lives under **`/v2/api`**.

### Authentication
Protected endpoints require a header:

```
Authorization: Bearer <JWT_TOKEN>
```

- Token is obtained from `POST /v1/api/auth/login`.
- Token expiry: `JWT_EXPIRE` (default **1 day**).
- After `logout`, the token is blacklisted (in-memory) until server restart.

**Auth failure responses**
| Status | When |
|--------|------|
| `401 Access Denied: No Token Provided` | Missing token |
| `401 Session Expired or Logged Out...` | Token was logged out (blacklisted) |
| `403 Invalid Token` | Bad / expired signature |
| `403 Forbidden: insufficient permissions` | Role not allowed (RBAC) |

### Roles (RBAC)
`ADMIN`, `HR`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`, and general authenticated users.
- **Reads** are generally open to any authenticated user.
- **Writes/management** are role-restricted (noted per endpoint).

### Standard Error Format
Validation errors (400):
```json
{ "message": "Email is required" }
```
Some modules include a success flag:
```json
{ "success": false, "message": "Missing required fields." }
```
Unhandled errors (500) — message is masked in production:
```json
{ "success": false, "message": "Something went wrong!" }
```
404:
```json
{ "message": "❌ Route not found" }
```

---

## 2. Auth Module

### `POST /v1/api/auth/login`
Public. Authenticate and receive a JWT.

**Body**
| Field | Type | Required |
|-------|------|----------|
| `email` | string | ✅ |
| `password` | string | ✅ |

```json
{ "email": "admin@example.com", "password": "secret" }
```

---

## 3. User Module — `/v2/api/user`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | Public | Register a new user |
| GET | `/profile` | 🔒 Token | Get logged-in user's profile |
| PUT | `/change-password` | 🔒 Token | Change own password |
| PUT | `/update-profile/:id` | 🔒 Token | Update own name/email |
| POST | `/logout` | 🔒 Token | Invalidate current token |

**`POST /register` body**
| Field | Type | Required |
|-------|------|----------|
| `name` | string | ✅ |
| `email` | string | ✅ |
| `username` | string | ✅ |
| `password` | string | ✅ |
| `role` | string | ✅ |

**`PUT /change-password` body**
| Field | Type | Required |
|-------|------|----------|
| `oldPassword` | string | ✅ |
| `newPassword` | string | ✅ |

**`PUT /update-profile/:id` body** — `name`, `email` (both optional).
> Note: `role` cannot be changed here (self-service). Role changes go through the HR/ADMIN employee endpoints.

---

## 4. HRM — Employee — `/v2/api/employee`

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/create-employee` | ADMIN, HR | Create one employee |
| POST | `/create-bulk-employee` | ADMIN, HR | Bulk create (array body) |
| PUT | `/update-employee/:id` | ADMIN, HR | Update an employee |
| GET | `/get-all-employees` | ADMIN, HR | List all employees |
| GET | `/get-user-profile` | 🔒 Token | Get own employee profile |

**`POST /create-employee` body**
| Field | Type | Required |
|-------|------|----------|
| `name` | string | ✅ |
| `email` | string | ✅ |
| `password` | string | ✅ |
| `location_id` | string \| number | ✅ |

**`POST /create-bulk-employee` body** — JSON array of employee objects (min 1):
```json
[ { "name": "A", "email": "a@x.com", "password": "..", "location_id": 1 } ]
```

---

## 5. HRM — Project Site — `/v2/api/project-site`

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/create-project-site` | ADMIN, HR | Create a site |
| PUT | `/update-project-site/:id` | ADMIN, HR | Update a site |
| GET | `/get-all-project-sites` | 🔒 Token | List all sites |
| DELETE | `/delete-project-site/:id` | ADMIN, HR | Delete a site |

**`POST /create-project-site` body**
| Field | Type | Required |
|-------|------|----------|
| `locationName` | string | ✅ |
| `latitude` | number | ✅ |
| `longitude` | number | ✅ |

---

## 6. HRM — Attendance — `/v2/api/attendance`

All endpoints require a token.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/checkin` | Punch in (geo-based) |
| POST | `/checkout` | Punch out (geo-based) |
| GET | `/attandace-data` | Own attendance data |
| GET | `/team-members` | Team members list |
| GET | `/filtered-attendance` | Attendance filtered by date/employee |
| GET | `/full-attendance-report` | Full attendance report |
| GET | `/monthly-payroll-report` | Monthly payroll |

**`POST /checkin` & `/checkout` body**
| Field | Type | Required |
|-------|------|----------|
| `latitude` | number | ✅ |
| `longitude` | number | ✅ |
| `employee_ids` | array | optional |

**Query params**
| Endpoint | Query |
|----------|-------|
| `/attandace-data` | `startDate`, `endDate` |
| `/full-attendance-report` | `startDate`, `endDate` |
| `/filtered-attendance` | `startDate`, `endDate`, `employeeId` |
| `/monthly-payroll-report` | `month` (e.g. `2026-07`) |

---

## 7. HRM — Export — `/v2/api/export`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/export-monthly` | 🔒 Token | Export attendance to Excel (template) |

**Query:** `startDate`, `endDate`. Returns an `.xlsx` file stream.

---

## 8. Inventory — `/v2/api/inventory`

Write guard **`canManageInventory`** = `ADMIN`, `INVENTORY_MANAGER`, `FACTORY_MANAGER`.
Reads are open to any authenticated user.

### 8.1 Stock Movement & Dashboard
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/movement` | Manage | Single stock movement (IN/OUT) |
| PUT | `/movement/:id` | Manage | Update a movement |
| POST | `/bulkmovement` | Manage | Bulk stock movements |
| GET | `/alltransactions` | 🔒 Token | Transaction history (paginated) |
| GET | `/dashboard` | 🔒 Token | Inventory dashboard summary |

**`POST /movement` body**
| Field | Type | Required |
|-------|------|----------|
| `productId` | string | ✅ |
| `warehouseId` | string | ✅ |
| `type` | string (e.g. `IN` / `OUT`) | ✅ |
| `quantity` | number \| string | ✅ |
| `vehicle_number` | string | optional |

**`POST /bulkmovement` body**
```json
{ "movements": [ { "productId": "..", "warehouseId": "..", "type": "IN", "quantity": 10 } ] }
```

**`GET /alltransactions` query params**
`productId`, `warehouseId`, `type`, `startDate`, `endDate`, `page` (default 1), `limit` (default 20).

### 8.2 Site Material Return
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/site-return` | Manage | Return unused/scrap material to warehouse |

**Body**
| Field | Type | Required |
|-------|------|----------|
| `siteId` | string | ✅ |
| `ProductId` | string | ✅ |
| `WarehouseId` | string | ✅ |
| `returnQty` | number \| string | ✅ |

### 8.3 Product Management
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/products` | Manage | Create product |
| GET | `/products` | 🔒 Token | List products (`?status=active`) |
| PUT | `/products/:id` | Manage | Update product |
| POST | `/bulkproducts` | Manage | Bulk create products |
| PATCH | `/products/:id/toggle-status` | Manage | Activate/deactivate (soft delete) |

**`POST /products` body**
| Field | Type | Required |
|-------|------|----------|
| `sku_code` | string | ✅ |
| `name` | string | ✅ |
| `base_uom`, `purchase_uom`, `conversion_factor` | — | optional (multi-UOM) |

**`POST /bulkproducts` body:** `{ "products": [ { ... } ] }`

### 8.4 Warehouse Management
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/warehouses` | Manage | Create warehouse (`name` required) |
| GET | `/warehouses` | 🔒 Token | List (`?status=active`) |
| PUT | `/warehouses/:id` | Manage | Update warehouse |
| PATCH | `/warehouses/:id/toggle-status` | Manage | Activate/deactivate |

### 8.5 Partner Management (Supplier/Manufacturer)
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/partners` | Manage | Create partner |
| GET | `/partners` | 🔒 Token | List (`?status=active`) |
| PUT | `/partners/:id` | Manage | Update partner |
| PATCH | `/partners/:id/toggle-status` | Manage | Activate/deactivate |

**`POST /partners` body**
| Field | Type | Required |
|-------|------|----------|
| `name` | string | ✅ |
| `type` | string (`SUPPLIER` / `MANUFACTURER` / ...) | ✅ |

---

## 9. Inventory — Site Dispatch Ledger — `/v2/api/inventory`

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/ledger/dispatch` | Manage | Issue material to a site (deducts stock, logs DISPATCH) |
| POST | `/ledger/return` | Manage | Return material from a site (adds stock, logs RETURN) |
| GET | `/ledger/consumption/:siteId` | 🔒 Token | Net consumption report per item for a site |

**`/ledger/dispatch` & `/ledger/return` body**
| Field | Type | Required |
|-------|------|----------|
| `site_id` | string | ✅ |
| `item_id` | string | ✅ |
| `quantity` | number \| string (positive) | ✅ |
| `uom` | string (item's `base_uom` or `purchase_uom`) | ✅ |

```json
{ "site_id": "12", "item_id": "45", "quantity": 100, "uom": "pcs" }
```

---

## 10. Endpoint Summary (Quick Reference)

| # | Method | Endpoint |
|---|--------|----------|
| 1 | GET | `/` |
| 2 | POST | `/v1/api/auth/login` |
| 3 | POST | `/v2/api/user/register` |
| 4 | GET | `/v2/api/user/profile` |
| 5 | PUT | `/v2/api/user/change-password` |
| 6 | PUT | `/v2/api/user/update-profile/:id` |
| 7 | POST | `/v2/api/user/logout` |
| 8 | POST | `/v2/api/employee/create-employee` |
| 9 | POST | `/v2/api/employee/create-bulk-employee` |
| 10 | PUT | `/v2/api/employee/update-employee/:id` |
| 11 | GET | `/v2/api/employee/get-all-employees` |
| 12 | GET | `/v2/api/employee/get-user-profile` |
| 13 | POST | `/v2/api/project-site/create-project-site` |
| 14 | PUT | `/v2/api/project-site/update-project-site/:id` |
| 15 | GET | `/v2/api/project-site/get-all-project-sites` |
| 16 | DELETE | `/v2/api/project-site/delete-project-site/:id` |
| 17 | POST | `/v2/api/attendance/checkin` |
| 18 | POST | `/v2/api/attendance/checkout` |
| 19 | GET | `/v2/api/attendance/attandace-data` |
| 20 | GET | `/v2/api/attendance/team-members` |
| 21 | GET | `/v2/api/attendance/filtered-attendance` |
| 22 | GET | `/v2/api/attendance/full-attendance-report` |
| 23 | GET | `/v2/api/attendance/monthly-payroll-report` |
| 24 | GET | `/v2/api/export/export-monthly` |
| 25 | POST | `/v2/api/inventory/movement` |
| 26 | PUT | `/v2/api/inventory/movement/:id` |
| 27 | POST | `/v2/api/inventory/bulkmovement` |
| 28 | GET | `/v2/api/inventory/alltransactions` |
| 29 | GET | `/v2/api/inventory/dashboard` |
| 30 | POST | `/v2/api/inventory/site-return` |
| 31 | POST | `/v2/api/inventory/products` |
| 32 | GET | `/v2/api/inventory/products` |
| 33 | PUT | `/v2/api/inventory/products/:id` |
| 34 | POST | `/v2/api/inventory/bulkproducts` |
| 35 | PATCH | `/v2/api/inventory/products/:id/toggle-status` |
| 36 | POST | `/v2/api/inventory/warehouses` |
| 37 | GET | `/v2/api/inventory/warehouses` |
| 38 | PUT | `/v2/api/inventory/warehouses/:id` |
| 39 | PATCH | `/v2/api/inventory/warehouses/:id/toggle-status` |
| 40 | POST | `/v2/api/inventory/partners` |
| 41 | GET | `/v2/api/inventory/partners` |
| 42 | PUT | `/v2/api/inventory/partners/:id` |
| 43 | PATCH | `/v2/api/inventory/partners/:id/toggle-status` |
| 44 | POST | `/v2/api/inventory/ledger/dispatch` |
| 45 | POST | `/v2/api/inventory/ledger/return` |
| 46 | GET | `/v2/api/inventory/ledger/consumption/:siteId` |

---

_Generated from the route + validator source. Roles/required-fields reflect the actual middleware and Zod schemas._
