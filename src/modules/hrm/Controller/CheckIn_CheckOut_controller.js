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
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
        
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'StarERP_HRM_System' 
            },
            timeout: 5000 // 5 seconds ka timeout (Zaroori hai)
        });

        // Pura address return karne ke bajaye aap thoda saaf address bhi nikal sakte hain
        return response.data.display_name || `Lat: ${lat}, Lon: ${lon}`;
        
    } catch (error) {
        // Agar internet slow ho ya OSM down ho, toh server ko crash mat hone do
        console.error("❌ OSM Fetch Error:", error.message);
        
        // Fallback: Address ki jagah coordinates bhej do taaki attendance ruk na jaye
        return `Coordinates: ${lat}, ${lon}`;
    }
};

const handleCheckIn = async (req, res) => {
    try {
        const { employee_ids, latitude, longitude } = req.body;

        if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized." });

        const loggedInUserId = req.user.id; 
        const requesterProfile = await db.EmployeeMaster.findOne({ where: { userId: loggedInUserId } });

        if (!requesterProfile) return res.status(404).json({ message: "Profile not found." });

        const requesterEmpId = requesterProfile.id;
        
        // --- 2. Determine target employees (FIXED LOGIC) ---
        // Agar employee_ids array aa raha hai aur length > 0 hai, toh bulk consider karo
        let targetEmployeeIds = (Array.isArray(employee_ids) && employee_ids.length > 0) 
                                ? employee_ids 
                                : [requesterEmpId];

        // --- 3. Prevent Duplicate Check-in for Today ---
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const alreadyCheckedIn = await db.CheckIn.findAll({
            where: {
                employeeId: { [Op.in]: targetEmployeeIds },
                checkInTime: { [Op.gte]: startOfDay }
            },
            attributes: ['employeeId']
        });

        const checkedInIds = alreadyCheckedIn.map(rec => rec.employeeId);
        const finalIdsToPunch = targetEmployeeIds.filter(id => !checkedInIds.includes(id));

        if (finalIdsToPunch.length === 0) {
            return res.status(400).json({ message: "Selected employees already checked in today." });
        }

        // --- 4. Geofencing Validation ---
        // Note: Bulk mein hum supervisor ki location ko hi benchmark maan rahe hain
        const employeesToPunch = await db.EmployeeMaster.findAll({
            where: { id: { [Op.in]: finalIdsToPunch } },
            include: [{ model: db.OfficeLocation, as: 'location' }]
        });

        // Loop checks if ALL selected employees are within their respective fence
        for (const emp of employeesToPunch) {
            if (!emp.location) continue; 

            const distance = getDistance(latitude, longitude, emp.location.latitude, emp.location.longitude);
            if (distance > (emp.location.radius || 100)) {
                return res.status(403).json({ 
                    message: `${emp.name} location se bahut door hain (${Math.round(distance)}m).` 
                });
            }
        }

        // --- 5. Processing & Saving ---
        const finalAddress = await getAddressFromOSM(latitude, longitude);
        const now = new Date();

        const checkInDataArray = finalIdsToPunch.map(empId => ({
            employeeId: empId,
            checkInTime: now,
            latitude,
            longitude,
            address: finalAddress,
            marked_by: requesterEmpId // Kisne punch kiya (Supervisor ID)
        }));

        // ✅ Yeh line bulk create karegi
        const records = await db.CheckIn.bulkCreate(checkInDataArray);

        return res.status(201).json({
            success: true,
            message: `${records.length} logo ka Check-in successfully ho gaya.`,
            address: finalAddress,
            data: records
        });

    } catch (error) {
        console.error("CheckIn Controller Error:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};


const handleCheckOut = async (req, res) => {
    try {
        const { employee_ids, latitude, longitude } = req.body;

        // 1. Auth Check
        if (!req.user?.id) return res.status(401).json({ message: "Unauthorized." });

        const requesterProfile = await db.EmployeeMaster.findOne({ where: { userId: req.user.id } });
        if (!requesterProfile) return res.status(404).json({ message: "Profile not found." });

        const requesterEmpId = requesterProfile.id;

        // 2. Authorization (Flexible Logic)
        // Agar employee_ids array hai, toh bulk consider karo, warna single.
        let targetEmployeeIds = (Array.isArray(employee_ids) && employee_ids.length > 0) 
                                ? employee_ids 
                                : [requesterEmpId];

        // 3. Geofencing & Data Fetch (Parallel)
        const [employees, finalAddress] = await Promise.all([
            db.EmployeeMaster.findAll({
                where: { id: { [Op.in]: targetEmployeeIds } },
                include: [{ model: db.OfficeLocation, as: 'location' }]
            }),
            getAddressFromOSM(latitude, longitude) // Address fetch karne ka function
        ]);

        for (const emp of employees) {
            if (!emp.location) continue;
            const distance = getDistance(latitude, longitude, emp.location.latitude, emp.location.longitude);
            if (distance > (emp.location.radius || 100)) {
                return res.status(403).json({ 
                    message: `${emp.name} location se door hain (${Math.round(distance)}m).` 
                });
            }
        }

        // 4. Today's Transactions Fetch
        const now = new Date();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [allCheckIns, allCheckOuts] = await Promise.all([
            db.CheckIn.findAll({
                where: { 
                    employeeId: { [Op.in]: targetEmployeeIds }, 
                    checkInTime: { [Op.gte]: todayStart } 
                },
                order: [['checkInTime', 'DESC']] // Latest check-in pehle
            }),
            db.CheckOut.findAll({
                where: { 
                    employeeId: { [Op.in]: targetEmployeeIds }, 
                    checkOutTime: { [Op.gte]: todayStart } 
                }
            })
        ]);

        // 5. Build Check-Out Data
        const checkOutDataArray = [];
        
        targetEmployeeIds.forEach(empId => {
            // Us employee ka aaj ka latest check-in dhundho
            const lastIn = allCheckIns.find(ci => ci.employeeId === empId);
            // Check karo ki kya wo aaj pehle hi check-out kar chuka hai
            const alreadyOut = allCheckOuts.find(co => co.employeeId === empId);

            if (lastIn && !alreadyOut) {
                const diffMs = now - new Date(lastIn.checkInTime);
                const hoursCalculated = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));

                checkOutDataArray.push({
                    employeeId: empId,
                    checkOutTime: now,
                    latitude, 
                    longitude,
                    address: finalAddress,
                    marked_by: requesterEmpId,
                    working_hours: hoursCalculated
                });
            }
        });

        if (checkOutDataArray.length === 0) {
            return res.status(400).json({ 
                message: "Check-out nahi ho saka. Ya toh check-in nahi kiya, ya pehle hi check-out ho chuka hai." 
            });
        }

        // 6. Bulk Create
        const records = await db.CheckOut.bulkCreate(checkOutDataArray);

        return res.status(201).json({ 
            success: true, 
            message: `${records.length} logo ka Check-out recorded.`,
            data: records 
        });

    } catch (error) {
        console.error("CheckOut Error:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

const getTeamMembers = async (req, res) => {
    try {
        // Aapke login data se 'hrm_employee_id' mil rahi hai
        // Ensure karein ki aapka auth middleware req.user mein 'hrm_employee_id' bhej raha hai
        const supervisorId = req.user.hrm_employee_id; 

        console.log("🔍 Fetching team for Supervisor ID:", supervisorId);

        const teamMembers = await db.EmployeeMaster.findAll({
            where: { supervisor_id: supervisorId }, // ✅ Yeh link perfect hai
            attributes: [
                'id', 'emp_code', 'name', 'phone', 'email', 'position'
            ], 
            order: [['name', 'ASC']] 
        });

        return res.status(200).json({ 
            success: true, 
            count: teamMembers.length,
            teamMembers: teamMembers 
        });

    } catch (error) {
        console.error("❌ Team Fetch Error:", error); 
        return res.status(500).json({ success: false, message: "Server Error" });
    }
}

const getAttendanceData = async (req, res) => {
    try {
        // 1. Current Month ki range nikalna
        const now = new Date();
        // Mahine ki pehli date (e.g., 2024-03-01 00:00:00)
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        // Mahine ki aakhri date (e.g., 2024-03-31 23:59:59)
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // 2. Token se User ID aur Role nikalna
        const loggedInUserId = req.user.id;
        const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : '';

        // 3. Requester ki profile fetch karein
        const requesterProfile = await db.EmployeeMaster.findOne({
            where: { userId: loggedInUserId }
        });

        if (!requesterProfile) {
            return res.status(404).json({ success: false, message: "Profile not found." });
        }

        const userDept = requesterProfile.department ? requesterProfile.department.toUpperCase() : '';

        // 4. Access Control & Condition
        const isPrivilegedUser = 
            loggedInUserRole === 'ADMIN' || 
            userDept === 'HR' || 
            userDept === 'ACCOUNTS';

        // Filter: Sirf is mahine ka data
        const whereCondition = {
            checkInTime: { [Op.between]: [firstDayOfMonth, lastDayOfMonth] }
        };

        if (!isPrivilegedUser) {
            whereCondition.employeeId = requesterProfile.id;
        }

        // 5. Fetch Records
        const attendanceRecords = await db.CheckIn.findAll({
            where: whereCondition,
            include: [{
                model: db.EmployeeMaster,
                as: 'employee',
                attributes: ['name', 'emp_code', 'department']
            }],
            order: [['checkInTime', 'DESC']] // Latest data sabse upar
        });

        // 6. Detailed Report (Merging Check-Outs)
        const detailedReport = await Promise.all(attendanceRecords.map(async (checkIn) => {
            const checkOut = await db.CheckOut.findOne({
                where: {
                    employeeId: checkIn.employeeId,
                    // Check-out bhi usi din ka dhoondein
                    checkOutTime: { 
                        [Op.between]: [
                            new Date(checkIn.checkInTime).setHours(0,0,0,0), 
                            new Date(checkIn.checkInTime).setHours(23,59,59,999)
                        ] 
                    }
                }
            });

            return {
                id: checkIn.id,
                name: checkIn.employee?.name || 'N/A',
                empId: checkIn.employee?.emp_code || 'N/A',
                dept: checkIn.employee?.department || 'N/A',
                date: new Date(checkIn.checkInTime).toISOString().split('T')[0],
                checkIn: checkIn.checkInTime ? new Date(checkIn.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--',
                checkOut: checkOut?.checkOutTime ? new Date(checkOut.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--',
                totalHours: checkOut?.working_hours || '0h',
                status: checkOut ? "Completed" : "Working"
            };
        }));

        // 7. Final Response
        return res.status(200).json({
            success: true,
            message: `Attendance data for ${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}`,
            count: detailedReport.length,
            data: detailedReport
        });

    } catch (error) {
        console.error("Report Error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
    }
};

const getFilteredAttendance = async (req, res) => {
    try {
        // Frontend se params lena: ?startDate=2024-01-01&endDate=2024-01-10&employeeId=12
        const { startDate, endDate, employeeId } = req.query;

        // 1. Date Validation & Formatting
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "Please provide both startDate and endDate."
            });
        }

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // 2. User Permission Check (Token se)
        const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : '';
        const loggedInUserId = req.user.id;

        const requester = await db.EmployeeMaster.findOne({ where: { userId: loggedInUserId } });
        const userDept = requester?.department?.toUpperCase() || '';

        const isPrivileged = ['ADMIN', 'HR', 'ACCOUNTS'].includes(loggedInUserRole) || 
                            ['HR', 'ACCOUNTS'].includes(userDept);

        // 3. Query Condition Build Karna
        const whereCondition = {
            checkInTime: { [Op.between]: [start, end] }
        };

        // Agar Admin nahi hai, toh wo sirf apna data filter kar sakta hai
        if (!isPrivileged) {
            whereCondition.employeeId = requester.id;
        } else if (employeeId) {
            // Admin kisi bhi specific employee ka data filter kar sakta hai
            whereCondition.employeeId = employeeId;
        }

        // 4. Data Fetching
        const records = await db.CheckIn.findAll({
            where: whereCondition,
            include: [{
                model: db.EmployeeMaster,
                as: 'employee',
                attributes: ['name', 'emp_code', 'department']
            }],
            order: [['checkInTime', 'ASC']] // Filtered data purane se naye ki taraf (ASC)
        });

        // 5. Check-Out Data Merge Logic
        const report = await Promise.all(records.map(async (checkIn) => {
            const checkOut = await db.CheckOut.findOne({
                where: {
                    employeeId: checkIn.employeeId,
                    checkOutTime: { 
                        [Op.between]: [
                            new Date(checkIn.checkInTime).setHours(0,0,0,0), 
                            new Date(checkIn.checkInTime).setHours(23,59,59,999)
                        ] 
                    }
                }
            });

            return {
                id: checkIn.id,
                name: checkIn.employee?.name,
                empId: checkIn.employee?.emp_code,
                date: new Date(checkIn.checkInTime).toISOString().split('T')[0],
                checkIn: checkIn.checkInTime,
                checkOut: checkOut?.checkOutTime || null,
                totalHours: checkOut?.working_hours || '0h',
                status: checkOut ? "Completed" : "In-Progress"
            };
        }));

        return res.status(200).json({
            success: true,
            results: report.length,
            dateRange: { from: start, to: end },
            data: report
        });

    } catch (error) {
        console.error("Filter API Error:", error);
        return res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};
module.exports = { handleCheckIn, handleCheckOut,getAttendanceData, getTeamMembers, getFilteredAttendance };