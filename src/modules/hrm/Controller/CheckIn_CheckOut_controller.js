const db = require('../../../common/index.db');
const { Op } = require('sequelize');
const axios = require('axios');



// helper function : Distance  checker
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

    return R * c; // Distance in meters
};
// Helper function: Lat/Log se Address nikalne ke liye 
const getAddressFromOSM = async (lat, lon) => {
    try {
        // OSM Nominatim URL
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
        
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'StarERP_HRM_System' 
            }
        });

        return response.data.display_name || "Address not found";
    } catch (error) {
        console.error("OSM Error:", error.message);
        return "Location fetch error";
    }
};

const handleCheckIn = async (req, res) => {
    try {
        const { employee_ids, latitude, longitude } = req.body;

        // 1. Auth & Profile Check
        if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized." });

        const loggedInUserId = req.user.id; 
        const requesterProfile = await db.EmployeeMaster.findOne({ where: { userId: loggedInUserId } });

        if (!requesterProfile) return res.status(404).json({ message: "Profile not found." });

        const requesterEmpId = requesterProfile.id;
        const userPosition = requesterProfile.position?.toLowerCase().trim() || '';

        // 2. Determine target employees
        let targetEmployeeIds = (userPosition === 'site supervisor' && Array.isArray(employee_ids)) 
                                ? employee_ids 
                                : [requesterEmpId];

        // 3. Prevent Duplicate Check-in for Today
        const startOfDay = new Date().setHours(0, 0, 0, 0);
        const alreadyCheckedIn = await db.CheckIn.findAll({
            where: {
                employeeId: { [Op.in]: targetEmployeeIds },
                checkInTime: { [Op.gte]: startOfDay }
            },
            attributes: ['employeeId']
        });

        const checkedInIds = alreadyCheckedIn.map(rec => rec.employeeId);
        // Filter out those who have already checked in today
        const finalIdsToPunch = targetEmployeeIds.filter(id => !checkedInIds.includes(id));

        if (finalIdsToPunch.length === 0) {
            return res.status(400).json({ message: "All selected employees have already checked in today." });
        }

        // 4. Geofencing Validation
        const employeesToPunch = await db.EmployeeMaster.findAll({
            where: { id: { [Op.in]: finalIdsToPunch } },
            include: [{ model: db.OfficeLocation, as: 'location' }]
        });

        for (const emp of employeesToPunch) {
            if (!emp.location) continue; // Ya error return karein

            const distance = getDistance(latitude, longitude, emp.location.latitude, emp.location.longitude);
            if (distance > (emp.location.radius || 100)) {
                return res.status(403).json({ 
                    message: `${emp.name} is too far (${Math.round(distance)}m). Attendance denied.` 
                });
            }
        }

        // 5. Processing & Saving
        const finalAddress = await getAddressFromOSM(latitude, longitude);
        const now = new Date();

        const checkInDataArray = finalIdsToPunch.map(empId => ({
            employeeId: empId,
            checkInTime: now,
            latitude,
            longitude,
            address: finalAddress,
            marked_by: requesterEmpId 
        }));

        const records = await db.CheckIn.bulkCreate(checkInDataArray);

        return res.status(201).json({
            status: "Success",
            message: `${records.length} Check-in(s) recorded.`,
            address: finalAddress,
            data: records
        });

    } catch (error) {
        console.error("CheckIn Controller Error:", error);
        return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};


const handleCheckOut = async (req, res) => {
    try {
        const { employee_ids, latitude, longitude } = req.body;

        // 1. Auth & Profile Check
        if (!req.user?.id) return res.status(401).json({ message: "Unauthorized." });

        const requesterProfile = await db.EmployeeMaster.findOne({ where: { userId: req.user.id } });
        if (!requesterProfile) return res.status(404).json({ message: "Profile not found." });

        // 2. Authorization
        const userPosition = requesterProfile.position?.toLowerCase().trim() || '';
        let targetEmployeeIds = (userPosition === 'site supervisor' && Array.isArray(employee_ids)) 
                                ? employee_ids 
                                : [requesterProfile.id];

        // 3. Geofencing (Radius Check)
        const employees = await db.EmployeeMaster.findAll({
            where: { id: { [Op.in]: targetEmployeeIds } },
            include: [{ model: db.OfficeLocation, as: 'location' }]
        });

        for (const emp of employees) {
            if (!emp.location) return res.status(400).json({ message: `${emp.name} location missing.` });
            const distance = getDistance(latitude, longitude, emp.location.latitude, emp.location.longitude);
            if (distance > (emp.location.radius || 100)) {
                return res.status(403).json({ message: `${emp.name} is outside office radius.` });
            }
        }

        // 4. Time & Bulk Fetch (Optimization)
        const now = new Date();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Saare check-ins ek baar mein fetch karein
        const allCheckIns = await db.CheckIn.findAll({
            where: { 
                employeeId: { [Op.in]: targetEmployeeIds }, 
                checkInTime: { [Op.gte]: todayStart } 
            }
        });

        // Saare check-outs ek baar mein fetch karein
        const allCheckOuts = await db.CheckOut.findAll({
            where: { 
                employeeId: { [Op.in]: targetEmployeeIds }, 
                checkOutTime: { [Op.gte]: todayStart } 
            }
        });

        const checkOutDataArray = [];
        
        targetEmployeeIds.forEach(empId => {
            const lastIn = allCheckIns.find(ci => ci.employeeId === empId);
            const alreadyOut = allCheckOuts.find(co => co.employeeId === empId);

            if (lastIn && !alreadyOut) {
                const diffMs = now - new Date(lastIn.checkInTime);
                const hoursCalculated = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));

                checkOutDataArray.push({
                    employeeId: empId,
                    checkOutTime: now,
                    latitude, longitude,
                    address: "Fetched Address", // API call result yahan dalye
                    marked_by: requesterProfile.id,
                    working_hours: hoursCalculated
                });
            }
        });

        if (checkOutDataArray.length === 0) {
            return res.status(400).json({ message: "No valid check-ins to check-out." });
        }

        const records = await db.CheckOut.bulkCreate(checkOutDataArray);
        return res.status(201).json({ status: "Success", data: records });

    } catch (error) {
        console.error("CheckOut Error:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};



const getAttendanceData = async (req, res) => {
    try {
        const { date, employeeId } = req.query;

        // 1. Token se User ID nikalna
        const loggedInUserId = req.user.id;
        const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : '';

        // 2. Requester ki profile fetch karein (Department check karne ke liye)
        const requesterProfile = await db.EmployeeMaster.findOne({
            where: { userId: loggedInUserId }
        });

        if (!requesterProfile) {
            return res.status(404).json({ message: "Requester employee profile not found." });
        }

        const userDept = requesterProfile.department ? requesterProfile.department.toUpperCase() : '';

        // 3. Date Filtering logic
        const searchDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(searchDate.setHours(23, 59, 59, 999));

        // 4. Access Control Logic
        const isPrivilegedUser = 
            loggedInUserRole === 'ADMIN' || 
            userDept === 'HR' || 
            userDept === 'ACCOUNTS';

        const whereCondition = {
            checkInTime: { [Op.between]: [startOfDay, endOfDay] }
        };

        if (!isPrivilegedUser) {
            // Normal Employee: Sirf apna data dekh sakta hai
            whereCondition.employeeId = requesterProfile.id;
        } else if (employeeId) {
            // Admin/HR/Accounts: Specific employee ka data dekh sakte hain agar query mein bheja ho
            whereCondition.employeeId = employeeId;
        }

        // 5. Fetch Check-Ins with Employee Details
        const attendanceRecords = await db.CheckIn.findAll({
            where: whereCondition,
            include: [{
                model: db.EmployeeMaster,
                as: 'employee',
                attributes: ['name', 'emp_code', 'department']
            }],
            order: [['checkInTime', 'DESC']]
        });

        // 6. Report taiyar karein aur Check-Out data merge karein
        const detailedReport = await Promise.all(attendanceRecords.map(async (checkIn) => {
            const checkOut = await db.CheckOut.findOne({
                where: {
                    employeeId: checkIn.employeeId,
                    checkOutTime: { [Op.between]: [startOfDay, endOfDay] }
                }
            });

            return {
                employee_name: checkIn.employee?.name || 'N/A',
                emp_code: checkIn.employee?.emp_code || 'N/A',
                department: checkIn.employee?.department || 'N/A',
                date: startOfDay.toISOString().split('T')[0],
                check_in: {
                    time: checkIn.checkInTime,
                    address: checkIn.address,
                    lat: checkIn.latitude,
                    lng: checkIn.longitude,
                    status: "Present"
                },
                check_out: checkOut ? {
                    time: checkOut.checkOutTime,
                    address: checkOut.address,
                    working_hours: checkOut.working_hours,
                    status: "Completed"
                } : {
                    status: "Pending/Working"
                }
            };
        }));

        return res.status(200).json({
            status: "Success",
            requested_by: requesterProfile.name,
            role_access: isPrivilegedUser ? "Full Access" : "Self Only",
            count: detailedReport.length,
            data: detailedReport
        });

    } catch (error) {
        console.error("Report Error:", error);
        return res.status(500).json({ message: "Server Error", error: error.message });
    }
};
module.exports = { handleCheckIn, handleCheckOut,getAttendanceData };