# Implementation Plan: Ultra-Optimized Redis Integration (30 MB RAM Budget & Dynamic Idle Purging)

Integrate Redis into the ERP backend for high-speed read caching, heavy report caching, and distributed stock locking, while strictly adhering to a **30 MB Memory Budget**, **2-Hour Inactivity Auto-Eviction**, and a **24-Hour Absolute Expiry Cap**.

---

## 1. Dynamic Key Expiration & Memory Management Rules

To guarantee that Redis stays strictly under 30 MB and removes unused data automatically:

### Rule A: 2-Hour Inactivity Auto-Eviction (Sliding Window)
- Every cached API endpoint payload is assigned an initial TTL of **2 Hours (7,200 Seconds)**.
- **Sliding Window Expiration**: On every Cache HIT (when an API is accessed), Redis automatically refreshes the key's expiration back to 2 hours (`EXPIRE key 7200`).
- **Automatic Cleanup**: If an API endpoint is NOT accessed for more than **2 Hours**, Redis automatically purges its cached data to free RAM.

### Rule B: 24-Hour Hard Expiry Cap & Daily Scheduled Flush
- **No Key Exceeds 24 Hours**: Absolute maximum TTL for any key in Redis is capped at **24 Hours (86,400 Seconds)**.
- **24-Hour Maintenance Purge**: A daily background timer/job runs every 24 hours at midnight to clear stale keys (`FLUSHDB` or targeted pattern purge).

### Memory Allocation Matrix (Max Budget: 30 MB)

| Component | Max Allocated RAM | Key Pattern | Base TTL | Idle Eviction Rule |
| --- | --- | --- | --- | --- |
| **API Response Caches** | 12.0 MB | `cache:api:<route>:<hash>` | 2 Hours (7200s) | Evicted after 2h inactivity (resets on hit) |
| **Consumption Reports Cache**| 8.0 MB | `cache:report:<type>:<hash>` | 2 Hours (7200s) | Evicted after 2h inactivity / purged on write |
| **Distributed Stock Mutex** | 1.0 MB | `lock:stock:<itemId>:<projId>` | 5 Seconds | Immediate release after transaction |
| **API Rate Limiter** | 2.0 MB | `rate:<ip>:<endpoint>` | 1 Minute | Auto-purged after 60s |
| **Internal Buffer & Reserves** | 7.0 MB | Memory overhead & index pointers | N/A | Buffer |
| **TOTAL PEAK RAM** | **30.0 MB** | - | **Max 24h** | **Strict 30 MB Cap** |

---

## 2. User Review Required

> [!IMPORTANT]
> 1. **Sliding Window Idle Eviction**: When a cached API is hit, its 2-hour timer resets. If an API goes unused for 2 hours, Redis purges it to save RAM.
> 2. **24-Hour Maintenance Purge**: All Redis cache data will be wiped automatically every 24 hours at midnight to guarantee zero memory fragmentation.
> 3. **Fail-Safe Mechanism**: If Redis reaches 30 MB RAM limit or connection fails, the application **seamlessly falls back to MySQL database queries** without HTTP 500 errors.

---

## 3. Open Questions

> [!NOTE]
> 1. **Stock Mutation Purge**: Should a warehouse stock outward (`POST /project-outward`) immediately clear all cached reports, or let the 2-hour idle eviction handle it? *(Proposed: Immediately purge cached reports on write operations to ensure real-time reporting)*.

---

## 4. Proposed Architecture & Dynamic Expiration Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               EXPRESS API ROUTER                                │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SLIDING WINDOW CACHE MIDDLEWARE                          │
│                1. Check key in Redis                                            │
│                2. IF FOUND -> Refresh TTL to 2 Hours (EXPIRE key 7200)          │
│                3. IF NOT FOUND -> Fetch DB -> Cache in Redis (EXPIRE 7200)      │
└───────────────────┬─────────────────────────────────────────┬───────────────────┘
                    │ CACHE HIT                               │ CACHE MISS / FAIL
                    ▼                                         ▼
┌────────────────────────────────────────┐ ┌──────────────────────────────────────┐
│       Return 200 OK (< 5ms)            │ │       FETCH FROM MYSQL DATABASE      │
│   (Resets 2-hour idle timer)           │ │     (Store in Redis with 2h TTL)      │
└────────────────────────────────────────┘ └──────────────────┬───────────────────┘
```

---

## 5. Affected Files & New Components

### [Component 1] Common Redis Infrastructure

#### [NEW] [redis.client.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/common/redis.client.js)
- Singleton `ioredis` client initialization with reconnect logic.
- Redis client configuration:
  - `getCache(key)`: Retrieves cached payload and automatically executes `EXPIRE key 7200` to extend sliding 2-hour window.
  - `setCache(key, value, ttl = 7200)`: Saves payload with max cap of 24h (86400s).
  - `schedule24hPurge()`: Scheduled job to flush/clean stale cache keys every 24 hours.

#### [NEW] [cache.middleware.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/common/cache.middleware.js)
- Express route caching middleware.
- Enforces **2-hour idle eviction (7200s)** and **24-hour hard cap (86400s)**.
- Adds `X-Cache: HIT` header and refreshes 2-hour sliding window TTL on access.

### [Component 2] Services & Cache Invalidation

#### [MODIFY] [project.service.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/inventory/services/project.service.js)
- Wrap `getAllProjects` and `getProjectStock` with 2-hour sliding window cache.
- Purge cache on `createProject`, `updateProject`, or `toggleProjectStatus`.

#### [MODIFY] [projectOutward.service.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/inventory/services/projectOutward.service.js)
- Acquire distributed stock lock (`lock:stock:...`) for 5 seconds.
- Purge report and stock cache keys after transaction commits.

#### [MODIFY] [projectTransfer.service.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/inventory/services/projectTransfer.service.js)
- Acquire distributed stock lock (`lock:transfer:...`) for 5 seconds.
- Purge cache keys after inter-project transfer.

#### [MODIFY] [consumptionReport.service.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/reports/services/consumptionReport.service.js)
- Wrap `getProjectConsumptionReport` and `getSiteConsumptionReport` with 2-hour sliding window cache.

### [Component 3] Route Layer Integration

#### [MODIFY] [project.route.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/inventory/Route/project.route.js)
- Attach 2-hour sliding window cache middleware to `GET /projects` and `GET /projects/:id/stock`.

#### [MODIFY] [consumptionReport.route.js](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/src/modules/reports/routes/consumptionReport.route.js)
- Attach 2-hour sliding window cache middleware to report GET endpoints.

#### [MODIFY] [package.json](file:///e:/Website/ERP/git/New%20code%20-%20Copy/erp-backend-solid-principle%20new%20arch/package.json)
- Add `ioredis` dependency.

---

## 6. Verification & Memory Benchmark Plan

### Automated Verification
1. **2-Hour Inactivity Eviction Test**: Verify key TTL resets to 7200s on hit, and key auto-expires after 2 hours without hits.
2. **24-Hour Hard Expiry Test**: Verify no key is assigned a TTL > 86400s and 24h purge job clears stale keys.
3. **Memory Cap Test**: Verify total memory usage remains **< 30 MB**.
4. **Fallback Test**: Stop Redis and confirm all APIs continue responding cleanly via MySQL fallback.
