# 📍 HRM Attendance Module - Complete Documentation

**Version:** 1.0.0  
**Framework:** Node.js + Express + Sequelize ORM + MySQL  
**Last Updated:** January 2026

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture & Database Schema](#architecture--database-schema)
3. [Geofencing Logic](#geofencing-logic)
4. [Key Features](#key-features)
5. [API Documentation](#api-documentation)
6. [Error Handling](#error-handling)
7. [Installation & Setup](#installation--setup)
8. [Code Examples](#code-examples)

---

## 🎯 Overview

The **Attendance Module** is a GPS-enabled, location-aware attendance system designed for enterprise-level employee tracking. It enforces strict **geofencing rules** to ensure employees can only mark attendance from within the office premises.

### Core Capabilities

✅ **Geofencing Validation** - Uses Haversine Formula to calculate distance from office  
✅ **Bulk Attendance Marking** - Supervisors can mark multiple employees at once  
✅ **Self & Supervisor Marking** - Support for both employee self-service and supervisor-managed marking  
✅ **Real-time Address Lookup** - Reverse geocoding using OpenStreetMap (OSM) Nominatim API  
✅ **Automatic Working Hours** - Calculates duration between check-in and check-out in decimal format  
✅ **Location Tracking** - Stores GPS coordinates (latitude/longitude) for audit trails  

---

## 🏗️ Architecture & Database Schema

### Entity Relationship Diagram (ERD)

```
OfficeLocation
    ├── id (UUID, PK)
    ├── locationName (VARCHAR)
    ├── latitude (DECIMAL 10,8)
    ├── longitude (DECIMAL 11,8)
    └── radiusInMeters (INTEGER, DEFAULT: 100)
          │
          ↓ One-to-Many
    EmployeeMaster
        ├── id (UUID, PK)
        ├── emp_code (VARCHAR, UNIQUE)
        ├── name (VARCHAR)
        ├── email (VARCHAR, UNIQUE)
        ├── phone (VARCHAR, UNIQUE)
        ├── department (VARCHAR)
        ├── position (VARCHAR)
        ├── location_id (FK → OfficeLocation)
        ├── supervisor_id (FK → EmployeeMaster, self-referencing)
        └── isActive (BOOLEAN)
             │
             ├─→ One-to-Many ──→ CheckIn
             │                   ├── id (UUID, PK)
             │                   ├── employeeId (FK)
             │                   ├── checkInTime (DATETIME)
             │                   ├── latitude (DECIMAL 10,8)
             │                   ├── longitude (DECIMAL 11,8)
             │                   ├── address (VARCHAR)
             │                   └── marked_by (UUID)
             │
             └─→ One-to-Many ──→ CheckOut
                                ├── id (UUID, PK)
                                ├── employeeId (FK)
                                ├── checkOutTime (DATETIME)
                                ├── latitude (DECIMAL 10,8)
                                ├── longitude (DECIMAL 11,8)
                                ├── address (VARCHAR)
                                ├── marked_by (UUID)
                                └── working_hours (DECIMAL 5,2)
```

### Database Tables

| Table Name | Purpose | Key Fields |
|------------|---------|-----------|
| `OfficeLocation` | Stores office coordinates & geofence radius | latitude, longitude, radiusInMeters |
| `hrm_employee_master` | Employee master data | emp_code, email, phone, location_id, supervisor_id |
| `hrm_checkins` | Check-in records | employeeId, checkInTime, latitude, longitude, address, marked_by |
| `hrm_checkouts` | Check-out records | employeeId, checkOutTime, latitude, longitude, address, marked_by, working_hours |

---

## 📍 Geofencing Logic

### Haversine Formula Implementation

The Haversine Formula calculates the great-circle distance between two points on a sphere given their latitudes and longitudes.

**Formula:**
```
a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
c = 2 ⋅ atan2(√a, √(1−a))
d = R ⋅ c
```

Where:
- `φ` = latitude (in radians)
- `λ` = longitude (in radians)
- `R` = Earth's radius (6,371,000 meters)
- `d` = distance in meters

**Implementation in Code:**

```javascript
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Returns distance in meters
};
```

### Geofence Validation Flow

```
User submits Check-In/Check-Out
        ↓
Fetch Employee's Office Location
        ↓
Calculate Distance (Haversine)
        ↓
Distance ≤ Office Radius?
    ├─ YES → Proceed to Address Lookup & Attendance Mark
    └─ NO → Return 403 Radius Violation Error
```

### Example Scenarios

| Scenario | Office Radius | User Distance | Result |
|----------|---------------|----------------|--------|
| Employee at office | 100m | 45m | ✅ Check-in allowed |
| Employee nearby | 100m | 120m | ❌ Check-in rejected (23% over limit) |
| Employee at home | 100m | 2500m | ❌ Check-in rejected (2400% over limit) |

---

## ✨ Key Features

### 1️⃣ **Bulk Check-In for Supervisors**

Supervisors can mark attendance for multiple employees simultaneously with a single API call.

**Use Case:** Site supervisor marks attendance for 50 field employees at the job site.

```javascript
{
    "employee_ids": ["uuid1", "uuid2", "uuid3"],
    "supervisor_id": "supervisor-uuid",
    "latitude": 28.7041,
    "longitude": 77.1025
}
```

### 2️⃣ **Self vs Supervisor Marking Logic**

| Marking Type | Scenario | `marked_by` Field |
|-------------|----------|------------------|
| **Self Marking** | Employee marks own attendance via mobile app | `employee_id` |
| **Supervisor Marking** | Manager marks employee's attendance | `supervisor_id` |

**Benefits:**
- Tracks who marked the attendance (audit trail)
- Distinguishes between authorized and self-service marking
- Enables different SLAs or approval workflows

### 3️⃣ **OpenStreetMap (OSM) Integration**

Reverse geocoding converts GPS coordinates to human-readable addresses using OSM's Nominatim API.

**Implementation:**
```javascript
const getAddressFromOSM = async (lat, lon) => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'StarERP_HRM_System' }
        });
        return response.data.display_name || "Address not found";
    } catch (error) {
        console.error("OSM Error:", error.message);
        return "Location fetch error";
    }
};
```

**Example Output:**
```
Input: lat=28.7041, lon=77.1025
Output: "221, Rajendra Place, New Delhi, Delhi, 110001, India"
```

**⚠️ API Limits:** Nominatim allows ~1 request/second. For bulk operations, implement caching.

### 4️⃣ **Automatic Working Hours Calculation**

Upon check-out, the system automatically calculates working hours in **decimal format** (e.g., 8.50 hours = 8 hours 30 minutes).

**Formula:**
```
Working Hours = (CheckOut Time - CheckIn Time) / 3600000 ms
              = (milliseconds) / (1000 * 60 * 60)
```

**Example Calculation:**
```javascript
const lastCheckIn = new Date("2025-01-31 09:00:00");
const checkOutTime = new Date("2025-01-31 17:30:00");
const diffMs = checkOutTime - lastCheckIn;  // 30,600,000 ms
const hoursCalculated = (diffMs / (1000 * 60 * 60)).toFixed(2);
// Result: 8.50 hours
```

**Output Fields:**
```json
{
    "working_hours": 8.50,
    "checkInTime": "2025-01-31T09:00:00.000Z",
    "checkOutTime": "2025-01-31T17:30:00.000Z"
}
```

---

## 📡 API Documentation

### POST /v2/api/employee/checkin

**Mark attendance for employees with geofence validation.**

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
    "employee_ids": ["550e8400-e29b-41d4-a716-446655440000"],
    "supervisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "latitude": 28.7041,
    "longitude": 77.1025
}
```

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `employee_ids` | UUID[] | Yes | Single or array of employee UUIDs | `["uuid1", "uuid2"]` |
| `supervisor_id` | UUID | Optional | Supervisor/Manager UUID (if bulk marking) | `"sup-uuid"` |
| `latitude` | Decimal | Yes | GPS latitude coordinate (±90.0) | `28.7041` |
| `longitude` | Decimal | Yes | GPS longitude coordinate (±180.0) | `77.1025` |

**Response (201 Created):**
```json
{
    "status": "Success",
    "message": "Radius verified. Attendance marked successfully.",
    "address": "221, Rajendra Place, New Delhi, Delhi, 110001, India",
    "data": [
        {
            "id": "check-in-uuid",
            "employeeId": "550e8400-e29b-41d4-a716-446655440000",
            "checkInTime": "2025-01-31T09:30:00.000Z",
            "latitude": 28.7041,
            "longitude": 77.1025,
            "address": "221, Rajendra Place, New Delhi, Delhi, 110001, India",
            "marked_by": "550e8400-e29b-41d4-a716-446655440001",
            "createdAt": "2025-01-31T09:30:15.123Z"
        }
    ]
}
```

**Processing Steps:**
1. ✅ Fetch employee(s) and their assigned office location
2. ✅ Validate geofence (Haversine formula)
3. ✅ Fetch address via OSM Nominatim API
4. ✅ Create bulk check-in records
5. ✅ Return confirmation with address

---

### POST /v2/api/employee/checkout

**Mark check-out with automatic working hours calculation.**

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
    "employee_ids": ["550e8400-e29b-41d4-a716-446655440000"],
    "supervisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "latitude": 28.7041,
    "longitude": 77.1025
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `employee_ids` | UUID[] | Yes | Employee UUIDs to check out |
| `supervisor_id` | UUID | Optional | Supervisor marking attendance |
| `latitude` | Decimal | Yes | GPS latitude |
| `longitude` | Decimal | Yes | GPS longitude |

**Response (201 Created):**
```json
{
    "status": "Success",
    "message": "Check-out completed successfully.",
    "data": [
        {
            "id": "check-out-uuid",
            "employeeId": "550e8400-e29b-41d4-a716-446655440000",
            "checkOutTime": "2025-01-31T17:30:00.000Z",
            "latitude": 28.7041,
            "longitude": 77.1025,
            "address": "221, Rajendra Place, New Delhi, Delhi, 110001, India",
            "marked_by": "550e8400-e29b-41d4-a716-446655440001",
            "working_hours": 8.50,
            "createdAt": "2025-01-31T17:30:15.456Z"
        }
    ]
}
```

**Processing Steps:**
1. ✅ Fetch employee(s) and office location
2. ✅ Validate geofence (same as check-in)
3. ✅ Find latest check-in record for today
4. ✅ Calculate working hours = (checkOut - checkIn) / 3600000
5. ✅ Create check-out records with calculated hours
6. ✅ Return confirmation

**Logic for Finding Latest Check-In:**
```javascript
const lastCheckIn = await db.CheckIn.findOne({
    where: { 
        employeeId: empId, 
        checkInTime: { [Op.gte]: todayStart } // After 00:00:00 today
    },
    order: [['checkInTime', 'DESC']]  // Most recent first
});
```

---

## ⚠️ Error Handling

### Standard Error Response Format

```json
{
    "status": "Error",
    "message": "Descriptive error message",
    "code": "ERROR_CODE",
    "details": {}
}
```

### Error Codes & Meanings

| HTTP Code | Error Code | Message | Cause |
|-----------|-----------|---------|-------|
| **400** | `INVALID_REQUEST` | Required fields missing | Missing `employee_ids`, `latitude`, or `longitude` |
| **400** | `INVALID_COORDINATES` | Invalid GPS coordinates | Latitude not in ±90.0 or Longitude not in ±180.0 |
| **400** | `MISSING_LOCATION` | Employee office location not assigned | Employee's `location_id` is NULL |
| **400** | `NO_CHECKIN_RECORD` | No check-in found for today | Attempting check-out without prior check-in |
| **403** | `RADIUS_VIOLATION` | Away From Office | Distance > Office Radius |
| **403** | `UNAUTHORIZED_MARKING` | Supervisor unauthorized | Non-supervisor trying bulk marking |
| **404** | `EMPLOYEE_NOT_FOUND` | Employee not found | Invalid `employee_ids` provided |
| **500** | `SERVER_ERROR` | Internal server error | Database, API, or unexpected error |
| **503** | `OSM_API_ERROR` | OpenStreetMap service unavailable | Nominatim API timeout or failure |

### Detailed Error Examples

#### ❌ Error: Geofence Radius Violation

```json
{
    "status": "Error",
    "code": "RADIUS_VIOLATION",
    "message": "John Doe Away From Office - Distance: 2543m, Allowed: 100m",
    "statusCode": 403,
    "actualDistance": 2543,
    "allowedRadius": 100,
    "violation": "2343% over limit"
}
```

**Recommended Client Action:**
- Inform user they are outside geofence
- Show distance remaining to enter zone
- Suggest nearest office location

---

#### ❌ Error: Missing Employee Location Assignment

```json
{
    "status": "Error",
    "code": "MISSING_LOCATION",
    "message": "Employee EMP-001 office location not assigned.",
    "statusCode": 400,
    "employeeId": "550e8400-e29b-41d4-a716-446655440000",
    "solution": "Admin must assign office location to employee via /employee/update endpoint"
}
```

---

#### ❌ Error: No Check-In Record Found

```json
{
    "status": "Error",
    "code": "NO_CHECKIN_RECORD",
    "message": "No check-in record found for employee EMP-001 today",
    "statusCode": 400,
    "employeeId": "550e8400-e29b-41d4-a716-446655440000",
    "date": "2025-01-31",
    "solution": "Employee must check-in before checking out"
}
```

---

#### ❌ Error: OSM API Unavailable

```json
{
    "status": "Warning",
    "code": "OSM_SERVICE_DEGRADED",
    "message": "Address lookup failed - marking attendance with coordinates only",
    "statusCode": 201,
    "fallback": "Location marked successfully without address",
    "address": "Location fetch error",
    "coordinates": {
        "latitude": 28.7041,
        "longitude": 77.1025
    }
}
```

**Graceful Degradation:** Even if OSM fails, attendance is marked using coordinates as backup.

---

### Error Handling Best Practices

```javascript
try {
    // Validate geofence
    if (distance > allowedRadius) {
        throw {
            statusCode: 403,
            code: 'RADIUS_VIOLATION',
            message: `Distance: ${Math.round(distance)}m, Allowed: ${allowedRadius}m`
        };
    }
    
    // Try to fetch address
    const address = await getAddressFromOSM(lat, lon);
    
    // Mark attendance
    const record = await db.CheckIn.create({...});
    
    return res.status(201).json({status: "Success", data: record});
    
} catch (error) {
    console.error("Attendance Error:", error);
    
    // Return appropriate HTTP status
    const statusCode = error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    
    return res.status(statusCode).json({
        status: "Error",
        message,
        code: error.code || "UNKNOWN_ERROR"
    });
}
```

---

## 🚀 Installation & Setup

### Prerequisites

```bash
# Node.js v14+ and npm
node --version  # Should be ≥ 14.0.0
npm --version   # Should be ≥ 6.0.0
```

### Database Setup

```sql
-- Create CheckIn Table
CREATE TABLE hrm_checkins (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    employee_master_id CHAR(36) NOT NULL,
    checkInTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    address VARCHAR(255),
    marked_by CHAR(36),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_master_id) REFERENCES hrm_employee_master(employee_master_id),
    INDEX idx_employee_date (employee_master_id, DATE(checkInTime))
);

-- Create CheckOut Table
CREATE TABLE hrm_checkouts (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    employee_master_id CHAR(36) NOT NULL,
    checkOutTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    address VARCHAR(255),
    marked_by CHAR(36),
    working_hours DECIMAL(5, 2),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_master_id) REFERENCES hrm_employee_master(employee_master_id),
    INDEX idx_employee_date (employee_master_id, DATE(checkOutTime))
);
```

### Environment Configuration

Add to `.env` file:

```env
# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=erp_hrm
DB_PORT=3306

# OSM API (Optional rate limiting)
OSM_MAX_REQUESTS_PER_SECOND=1

# Geofencing
DEFAULT_GEOFENCE_RADIUS=100  # meters

# Server
PORT=3000
NODE_ENV=development
```

### Module Initialization

```javascript
// In your main db.config or index.db.js
const CheckIn = require('./modules/hrm/model/CheckIn_model');
const CheckOut = require('./modules/hrm/model/CheckOut_model');
const EmployeeMaster = require('./modules/hrm/model/EmployeeMaster');
const OfficeLocation = require('./modules/hrm/model/Office_Location_model');

// Define associations
EmployeeMaster.hasMany(CheckIn, {
    foreignKey: 'employeeId',
    as: 'checkins'
});

EmployeeMaster.hasMany(CheckOut, {
    foreignKey: 'employeeId',
    as: 'checkouts'
});

EmployeeMaster.belongsTo(OfficeLocation, {
    foreignKey: 'location_id',
    as: 'location'
});

// Sync models
sequelize.sync({ alter: true });
```

---

## 💻 Code Examples

### Example 1: Self-Service Mobile App Check-In

**Frontend (React Native/Flutter):**
```javascript
// Get GPS coordinates from device
const checkIn = async () => {
    const location = await getCurrentLocation(); // GPS library
    
    const response = await fetch('http://api.example.com/v2/api/employee/checkin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            employee_ids: [employeeId],
            latitude: location.latitude,
            longitude: location.longitude,
            // supervisor_id not provided → Self marking
        })
    });
    
    const result = await response.json();
    if (result.status === 'Success') {
        showToast(`✅ Checked in at ${result.address}`);
    } else {
        showToast(`❌ ${result.message}`);
    }
};
```

---

### Example 2: Supervisor Bulk Marking

**Use Case:** Site supervisor marks 50 field employees in single request

```javascript
// Backend - Supervisor dashboard
const markBulkAttendance = async (req, res) => {
    const supervisor = await getLoggedInUser(req);
    
    if (supervisor.role !== 'site supervisor') {
        return res.status(403).json({message: "Only supervisors can bulk mark"});
    }
    
    const {employee_ids, latitude, longitude} = req.body;
    
    // Call endpoint
    const response = await axios.post('/v2/api/employee/checkin', {
        employee_ids: employee_ids,  // Array of 50 UUIDs
        supervisor_id: supervisor.id,
        latitude,
        longitude
    });
    
    // Audit log
    await db.AuditLog.create({
        action: 'BULK_CHECKIN',
        supervisor_id: supervisor.id,
        employee_count: employee_ids.length,
        timestamp: new Date()
    });
    
    res.json(response.data);
};
```

---

### Example 3: Daily Attendance Report

**Query working hours for attendance report:**

```javascript
const getDailyAttendanceReport = async (req, res) => {
    const {date} = req.query; // e.g., "2025-01-31"
    
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    
    const report = await db.sequelize.query(`
        SELECT 
            em.emp_code,
            em.name,
            em.department,
            ci.checkInTime,
            co.checkOutTime,
            co.working_hours,
            ci.address,
            CASE 
                WHEN ci.marked_by = ci.employee_master_id THEN 'Self'
                ELSE 'Supervisor'
            END as marking_type
        FROM hrm_employee_master em
        LEFT JOIN hrm_checkins ci ON em.employee_master_id = ci.employee_master_id 
            AND DATE(ci.checkInTime) = ?
        LEFT JOIN hrm_checkouts co ON em.employee_master_id = co.employee_master_id 
            AND DATE(co.checkOutTime) = ?
        ORDER BY em.emp_code
    `, {
        replacements: [date, date],
        type: QueryTypes.SELECT
    });
    
    res.json(report);
};
```

---

### Example 4: Working Hours Analytics

**Calculate average working hours by department:**

```javascript
const getWorkingHoursAnalytics = async (req, res) => {
    const {month, year} = req.query;
    
    const analytics = await db.CheckOut.findAll({
        attributes: [
            [db.sequelize.fn('AVG', db.sequelize.col('working_hours')), 'avg_hours'],
            [db.sequelize.fn('MIN', db.sequelize.col('working_hours')), 'min_hours'],
            [db.sequelize.fn('MAX', db.sequelize.col('working_hours')), 'max_hours'],
            [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'total_days']
        ],
        include: [{
            model: db.EmployeeMaster,
            attributes: ['department'],
            required: true
        }],
        where: db.sequelize.where(
            db.sequelize.fn('MONTH', db.sequelize.col('checkOutTime')), 
            Op.eq, 
            month
        ),
        group: [db.sequelize.col('EmployeeMaster.department')],
        raw: true
    });
    
    res.json(analytics);
};
```

---

## 📊 Performance Considerations

### Database Indexing

```sql
-- Critical indexes for fast queries
CREATE INDEX idx_checkin_employee_date 
    ON hrm_checkins(employee_master_id, DATE(checkInTime));

CREATE INDEX idx_checkout_employee_date 
    ON hrm_checkouts(employee_master_id, DATE(checkOutTime));

CREATE INDEX idx_checkin_time 
    ON hrm_checkins(checkInTime);

CREATE INDEX idx_checkout_time 
    ON hrm_checkouts(checkOutTime);
```

### Query Optimization

- ✅ Use `findOne()` with `order DESC LIMIT 1` for latest check-in
- ✅ Cache OSM results to avoid rate limiting
- ✅ Use batch processing for bulk operations
- ✅ Implement connection pooling (Sequelize default: pool size 5)

### Rate Limiting (OSM API)

```javascript
const rateLimit = {};

const getAddressFromOSM = async (lat, lon) => {
    // Throttle requests to 1 per second
    const now = Date.now();
    const key = `${lat}-${lon}`;
    
    if (rateLimit[key] && now - rateLimit[key] < 1000) {
        return "Cached from previous request";
    }
    
    rateLimit[key] = now;
    // ... fetch from OSM
};
```

---

## 🔒 Security Best Practices

### Data Validation

```javascript
const validateCoordinates = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Invalid coordinates');
    }
    if (lat < -90 || lat > 90) {
        throw new Error('Latitude must be between -90 and 90');
    }
    if (lon < -180 || lon > 180) {
        throw new Error('Longitude must be between -180 and 180');
    }
};
```

### Authorization

```javascript
// Only supervisors can bulk mark employees
if (req.body.employee_ids.length > 1) {
    const user = await db.EmployeeMaster.findByPk(req.user.id);
    if (user.role !== 'site supervisor' && user.role !== 'admin') {
        return res.status(403).json({message: "Unauthorized"});
    }
}
```

### Audit Logging

```javascript
// Log all attendance changes
await db.AuditLog.create({
    action: 'CHECKIN',
    userId: req.user.id,
    employeeId,
    latitude,
    longitude,
    timestamp: new Date(),
    ipAddress: req.ip
});
```

---

## 📞 Support & Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Geofence always failing | Wrong office coordinates | Verify OfficeLocation lat/lon in database |
| OSM API returning null | Network timeout | Implement retry logic with exponential backoff |
| Working hours showing 0 | No check-in on same day | Ensure check-in before check-out |
| GPS coordinates invalid | Client-side GPS error | Validate coordinates before sending |

### Debug Mode

```javascript
// Set DEBUG=erp-hrm:* to see detailed logs
const debug = require('debug')('erp-hrm:attendance');

const handleCheckIn = async (req, res) => {
    debug('Request received:', req.body);
    debug('Distance calculated:', distance);
    debug('Geofence check:', distance <= allowedRadius);
    // ...
};

// Run with: DEBUG=erp-hrm:* npm start
```

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| **1.0.0** | 31-Jan-2025 | Initial release with geofencing, bulk marking, OSM integration |

---

## 📄 License & Contact

**Module:** StarERP HRM Attendance System  
**Maintained By:** Development Team  
**Support Email:** support@starerrp.com  
**Last Updated:** January 31, 2025

---

**Happy Tracking! 📍✅**
