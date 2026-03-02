const db = require("../../../common/index.db");
const { Op } = require("sequelize");
const axios = require("axios");
const moment = require("moment");
// helper function : Distance  checker
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};
// Helper function: Lat/Log se Address nikalne ke liye
const getAddressFromOSM = async (lat, lon) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "StarERP_HRM_System",
      },
      timeout: 5000, // 5 seconds ka timeout (Zaroori hai)
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
    if (!req.user || !req.user.id)
      return res.status(401).json({ message: "Unauthorized." });

    const loggedInUserId = req.user.id;
    const requesterProfile = await db.EmployeeMaster.findOne({
      where: { userId: loggedInUserId },
    });
    if (!requesterProfile)
      return res.status(404).json({ message: "Profile not found." });

    const requesterEmpId = requesterProfile.id;
    let targetEmployeeIds =
      Array.isArray(employee_ids) && employee_ids.length > 0
        ? employee_ids
        : [requesterEmpId];

    // 1. Check if already checked in today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const alreadyCheckedIn = await db.CheckIn.findAll({
      where: {
        employeeId: { [Op.in]: targetEmployeeIds },
        checkInTime: { [Op.gte]: startOfDay },
      },
      attributes: ["employeeId"],
    });

    const checkedInIds = alreadyCheckedIn.map((rec) => rec.employeeId);
    const finalIdsToPunch = targetEmployeeIds.filter(
      (id) => !checkedInIds.includes(id),
    );

    if (finalIdsToPunch.length === 0) {
      return res
        .status(400)
        .json({ message: "Selected employees already checked in today." });
    }

    // --- 2. GEOFENCING LOGIC (Multiple Offices) ---

    // Saare active offices fetch karein
    const allOffices = await db.OfficeLocation.findAll();

    // Check karein ki user kisi bhi ek office ke radius mein hai ya nahi
    const matchedOffice = allOffices.find((office) => {
      const distance = getDistance(
        latitude,
        longitude,
        office.latitude,
        office.longitude,
      );
      return distance <= (office.radius || 100);
    });

    const employeesToPunch = await db.EmployeeMaster.findAll({
      where: { id: { [Op.in]: finalIdsToPunch } },
    });

    for (const emp of employeesToPunch) {
      const position = (emp.position || "").toLowerCase();
      const isFieldStaff =
        position.includes("sales") || position.includes("driver");

      // Agar office ke bahar hai AUR field staff bhi nahi hai, toh block karein
      if (!matchedOffice && !isFieldStaff) {
        return res.status(403).json({
          message: `${emp.name} kisi bhi office location ke dayre mein nahi hain.`,
        });
      }
    }

    // --- 3. Processing & Saving ---
    const finalAddress = await getAddressFromOSM(latitude, longitude);
    const now = new Date();

    const checkInDataArray = finalIdsToPunch.map((empId) => ({
      employeeId: empId,
      checkInTime: now,
      latitude,
      longitude,
      address: finalAddress,
      marked_by: requesterEmpId,
      office_id: matchedOffice ? matchedOffice.id : null, // Optional: Track which office
    }));

    const records = await db.CheckIn.bulkCreate(checkInDataArray);

    return res.status(201).json({
      success: true,
      message: `${records.length} logo ka Check-in successfully ho gaya.`,
      location: matchedOffice ? matchedOffice.name : "Field/On-road",
      address: finalAddress,
      data: records,
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
    if (!req.user?.id)
      return res.status(401).json({ message: "Unauthorized." });

    const requesterProfile = await db.EmployeeMaster.findOne({
      where: { userId: req.user.id },
    });
    if (!requesterProfile)
      return res.status(404).json({ message: "Profile not found." });

    const requesterEmpId = requesterProfile.id;
    let targetEmployeeIds =
      Array.isArray(employee_ids) && employee_ids.length > 0
        ? employee_ids
        : [requesterEmpId];

    // 2. Fetch Data (Offices, Employees, and Address) in Parallel
    const [allOffices, employees, finalAddress] = await Promise.all([
      db.OfficeLocation.findAll(),
      db.EmployeeMaster.findAll({
        where: { id: { [Op.in]: targetEmployeeIds } },
      }),
      getAddressFromOSM(latitude, longitude),
    ]);

    // --- 3. GEOFENCING VALIDATION (Multiple Offices) ---
    // Check if current location matches ANY office
    const matchedOffice = allOffices.find((office) => {
      const distance = getDistance(
        latitude,
        longitude,
        office.latitude,
        office.longitude,
      );
      return distance <= (office.radius || 100);
    });

    for (const emp of employees) {
      const position = (emp.position || "").toLowerCase();
      const isFieldStaff =
        position.includes("sales") || position.includes("driver");

      // Agar user office ke bahar hai aur field staff bhi nahi hai, toh block karein
      if (!matchedOffice && !isFieldStaff) {
        return res.status(403).json({
          message: `${emp.name} kisi bhi authorized office location ke dayre mein nahi hain (Check-out blocked).`,
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
          checkInTime: { [Op.gte]: todayStart },
        },
        order: [["checkInTime", "DESC"]],
      }),
      db.CheckOut.findAll({
        where: {
          employeeId: { [Op.in]: targetEmployeeIds },
          checkOutTime: { [Op.gte]: todayStart },
        },
      }),
    ]);

    // 5. Build Check-Out Data
    const checkOutDataArray = [];

    targetEmployeeIds.forEach((empId) => {
      const lastIn = allCheckIns.find((ci) => ci.employeeId === empId);
      const alreadyOut = allCheckOuts.find((co) => co.employeeId === empId);

      if (lastIn && !alreadyOut) {
        const diffMs = now - new Date(lastIn.checkInTime);
        const hoursCalculated = parseFloat(
          (diffMs / (1000 * 60 * 60)).toFixed(2),
        );

        checkOutDataArray.push({
          employeeId: empId,
          checkOutTime: now,
          latitude,
          longitude,
          address: finalAddress,
          marked_by: requesterEmpId,
          working_hours: hoursCalculated,
          office_id: matchedOffice ? matchedOffice.id : null,
        });
      }
    });

    if (checkOutDataArray.length === 0) {
      return res.status(400).json({
        message:
          "Check-out nahi ho saka. Ya toh check-in nahi kiya, ya pehle hi check-out ho chuka hai.",
      });
    }

    // 6. Bulk Create
    const records = await db.CheckOut.bulkCreate(checkOutDataArray);

    return res.status(201).json({
      success: true,
      message: `${records.length} logo ka Check-out recorded.`,
      location: matchedOffice ? matchedOffice.name : "Field/On-road",
      data: records,
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
      attributes: ["id", "emp_code", "name", "phone", "email", "position"],
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      success: true,
      count: teamMembers.length,
      teamMembers: teamMembers,
    });
  } catch (error) {
    console.error("❌ Team Fetch Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

const getAttendanceData = async (req, res) => {
  try {
    // Frontend se start aur end date aayegi toh filter zyada accurate hoga
    const { startDate, endDate } = req.query;

    const now = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = endDate
      ? new Date(endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const loggedInUserId = req.user.id;
    const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : "";

    const requesterProfile = await db.EmployeeMaster.findOne({
      where: { userId: loggedInUserId },
    });

    if (!requesterProfile) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found." });
    }

    const userDept = requesterProfile.department
      ? requesterProfile.department.toUpperCase()
      : "";

    // --- TEAM LOGIC ---
    const isPrivilegedUser =
      loggedInUserRole === "ADMIN" ||
      userDept === "HR" ||
      userDept === "ACCOUNTS";

    let whereCondition = {
      checkInTime: { [Op.between]: [start, end] },
    };

    if (!isPrivilegedUser) {
      const teamMembers = await db.EmployeeMaster.findAll({
        where: { supervisor_id: requesterProfile.id },
        attributes: ["id"],
      });
      const teamIds = teamMembers.map((m) => m.id);
      whereCondition.employeeId = {
        [Op.in]: [requesterProfile.id, ...teamIds],
      };
    }

    // --- OPTIMIZED DATA FETCHING ---
    // Ek hi baar mein CheckIn aur CheckOut dono nikal rahe hain
    const attendanceRecords = await db.CheckIn.findAll({
      where: whereCondition,
      include: [
        {
          model: db.EmployeeMaster,
          as: "employee",
          attributes: ["name", "emp_code", "department"],
        },
      ],
      order: [["checkInTime", "DESC"]],
    });

    // Saare CheckOuts ek hi query mein (N+1 fix)
    const employeeIds = attendanceRecords.map((r) => r.employeeId);
    const checkOuts = await db.CheckOut.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        checkOutTime: { [Op.between]: [start, end] },
      },
    });

    const toIST = (dateObj) => {
      if (!dateObj) return "--:--";
      return new Date(dateObj)
        .toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        .toUpperCase();
    };

    // Data mapping
    const detailedReport = attendanceRecords.map((checkIn) => {
      // Memory mein filter kar rahe hain database ki jagah
      const checkOut = checkOuts.find(
        (co) =>
          co.employeeId === checkIn.employeeId &&
          new Date(co.checkOutTime).toDateString() ===
            new Date(checkIn.checkInTime).toDateString(),
      );

      return {
        id: checkIn.id,
        name: checkIn.employee?.name || "N/A",
        empId: checkIn.employee?.emp_code || "N/A",
        date: new Date(checkIn.checkInTime)
          .toLocaleDateString("en-GB")
          .replace(/\//g, "-"),
        checkIn: toIST(checkIn.checkInTime),
        checkOut: toIST(checkOut?.checkOutTime),
        totalHours: checkOut?.working_hours || "0h",
        status: checkOut ? "Completed" : "Working",
      };
    });

    return res.status(200).json({
      success: true,
      count: detailedReport.length,
      data: detailedReport,
    });
  } catch (error) {
    console.error("Report Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const getAllAttendanceData = async (req, res) => {
  try {
    const { date } = req.query; // Kisi specific date ka report (default: today)
    const targetDate = date || moment().format("YYYY-MM-DD");

    // 1. Sabhi employees fetch karein aur unke us date ke CheckIn/CheckOut join karein
    const reportData = await EmployeeMaster.findAll({
      attributes: ["id", "name", "emp_code"],
      include: [
        {
          model: CheckIn,
          required: false, // LEFT JOIN (Absent dikhane ke liye zaroori)
          where: { date: targetDate },
        },
        {
          model: CheckOut,
          required: false, // LEFT JOIN (Short Attendance ke liye)
          where: { date: targetDate },
        },
      ],
    });

    // 2. Logic processing
    const finalReport = reportData.map((emp) => {
      const checkin = emp.CheckIns[0]; // Maan lete hain ek din mein ek hi entry hai
      const checkout = emp.CheckOuts[0];

      let status = "Absent";
      let workingHours = "00:00";
      let inTime = checkin ? checkin.time : "---";
      let outTime = checkout ? checkout.time : "---";

      if (checkin && checkout) {
        status = "Present";
        // Working Hours Calculation
        const start = moment(checkin.time, "HH:mm:ss");
        const end = moment(checkout.time, "HH:mm:ss");
        const duration = moment.duration(end.diff(start));
        const hours = Math.floor(duration.asHours());
        const minutes = duration.minutes();
        workingHours = `${hours}h ${minutes}m`;
      } else if (checkin && !checkout) {
        status = "Short Attendance";
      }

      return {
        id: emp.id,
        empName: emp.name,
        empCode: emp.emp_code,
        date: targetDate,
        checkIn: inTime,
        checkOut: outTime,
        status: status,
        workingHours: workingHours,
        workDone: checkout
          ? checkout.workDescription
          : checkin
            ? "Pending Checkout"
            : "N/A",
      };
    });

    res.status(200).json({ success: true, attendance: finalReport });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
        message: "Please provide both startDate and endDate.",
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // 2. User Permission Check (Token se)
    const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : "";
    const loggedInUserId = req.user.id;

    const requester = await db.EmployeeMaster.findOne({
      where: { userId: loggedInUserId },
    });
    const userDept = requester?.department?.toUpperCase() || "";

    const isPrivileged =
      ["ADMIN", "HR", "ACCOUNTS"].includes(loggedInUserRole) ||
      ["HR", "ACCOUNTS"].includes(userDept);

    // 3. Query Condition Build Karna
    const whereCondition = {
      checkInTime: { [Op.between]: [start, end] },
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
      include: [
        {
          model: db.EmployeeMaster,
          as: "employee",
          attributes: ["name", "emp_code", "department"],
        },
      ],
      order: [["checkInTime", "ASC"]], // Filtered data purane se naye ki taraf (ASC)
    });

    // 5. Check-Out Data Merge Logic
    const report = await Promise.all(
      records.map(async (checkIn) => {
        const checkOut = await db.CheckOut.findOne({
          where: {
            employeeId: checkIn.employeeId,
            checkOutTime: {
              [Op.between]: [
                new Date(checkIn.checkInTime).setHours(0, 0, 0, 0),
                new Date(checkIn.checkInTime).setHours(23, 59, 59, 999),
              ],
            },
          },
        });

        return {
          id: checkIn.id,
          name: checkIn.employee?.name,
          empId: checkIn.employee?.emp_code,
          date: new Date(checkIn.checkInTime).toISOString().split("T")[0],
          checkIn: checkIn.checkInTime,
          checkOut: checkOut?.checkOutTime || null,
          totalHours: checkOut?.working_hours || "0h",
          status: checkOut ? "Completed" : "In-Progress",
        };
      }),
    );

    return res.status(200).json({
      success: true,
      results: report.length,
      dateRange: { from: start, to: end },
      data: report,
    });
  } catch (error) {
    console.error("Filter API Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
  }
};

module.exports = {
  handleCheckIn,
  handleCheckOut,
  getAttendanceData,
  getTeamMembers,
  getFilteredAttendance,
  getAllAttendanceData,
};
