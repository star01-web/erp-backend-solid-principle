const db = require("../../../common/index.db");
const { Op } = require("sequelize");
const axios = require("axios");
const momentTz = require("moment-timezone"); // Uniform name use kar rahe hain poori file me

// Helper function : Distance checker (Haversine formula)
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
      timeout: 5000,
    });

    return response.data.display_name || `Lat: ${lat}, Lon: ${lon}`;
  } catch (error) {
    console.error("❌ OSM Fetch Error:", error.message);
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

    // 1. Check if already checked in today (IST safe check)
    const tz = "Asia/Kolkata";
    const startOfDay = momentTz.tz(tz).startOf("day").toDate();

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
    const allOffices = await db.OfficeLocation.findAll();

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
        position.includes("sales") ||
        position.includes("driver") ||
        position.includes("field");

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
      office_id: matchedOffice ? matchedOffice.id : null,
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

    const [allOffices, employees, finalAddress] = await Promise.all([
      db.OfficeLocation.findAll(),
      db.EmployeeMaster.findAll({
        where: { id: { [Op.in]: targetEmployeeIds } },
      }),
      getAddressFromOSM(latitude, longitude),
    ]);

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

      if (!matchedOffice && !isFieldStaff) {
        return res.status(403).json({
          message: `${emp.name} kisi bhi authorized office location ke dayre mein nahi hain (Check-out blocked).`,
        });
      }
    }

    const now = new Date();
    const tz = "Asia/Kolkata";
    const todayStart = momentTz.tz(tz).startOf("day").toDate();

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
          working_hours: hoursCalculated >= 0 ? hoursCalculated : 0,
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
    const supervisorId = req.user.hrm_employee_id;

    console.log("🔍 Fetching team for Supervisor ID:", supervisorId);

    const teamMembers = await db.EmployeeMaster.findAll({
      where: { supervisor_id: supervisorId },
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
    const { startDate, endDate } = req.query;
    const tz = "Asia/Kolkata";

    let start, end;

    if (startDate) {
      start = momentTz.tz(startDate, tz).startOf("day").toDate();
    } else {
      start = momentTz.tz(tz).startOf("month").toDate();
    }

    if (endDate) {
      end = momentTz.tz(endDate, tz).endOf("day").toDate();
    } else {
      end = momentTz.tz(tz).endOf("month").toDate();
    }

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

    const employeeIds = attendanceRecords.map((r) => r.employeeId);
    const checkOuts = await db.CheckOut.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        checkOutTime: { [Op.between]: [start, end] },
      },
    });

    const toIST = (dateObj) => {
      if (!dateObj) return "--:--";
      return momentTz.utc(dateObj).format("hh:mm A");
    };

    const detailedReport = attendanceRecords.map((checkIn) => {
      const checkInDateStr = momentTz
        .utc(checkIn.checkInTime)
        .format("YYYY-MM-DD");

      const checkOut = checkOuts.find(
        (co) =>
          co.employeeId === checkIn.employeeId &&
          momentTz.utc(co.checkOutTime).format("YYYY-MM-DD") === checkInDateStr,
      );

      return {
        id: checkIn.id,
        name: checkIn.employee?.name || "N/A",
        empId: checkIn.employee?.emp_code || "N/A",
        date: momentTz.utc(checkIn.checkInTime).format("DD-MM-YYYY"),
        checkIn: toIST(checkIn.checkInTime),
        checkOut: toIST(checkOut?.checkOutTime),
        totalHours:
          checkOut?.working_hours &&
          !checkOut.working_hours.toString().startsWith("-")
            ? checkOut.working_hours
            : "0h",
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
    const { startDate, endDate } = req.query;
    const tz = "Asia/Kolkata";
    let checkInWhere = {};
    let checkOutWhere = {};

    if (startDate && endDate) {
      const start = momentTz.tz(startDate, tz).startOf("day").toDate();
      const end = momentTz.tz(endDate, tz).endOf("day").toDate();

      checkInWhere.checkInTime = { [Op.between]: [start, end] };
      checkOutWhere.checkOutTime = { [Op.between]: [start, end] };
    }

    const employees = await db.EmployeeMaster.findAll({
      attributes: ["id", "name", "emp_code"],
      include: [
        {
          model: db.CheckIn,
          as: "checkins",
          attributes: ["checkInTime", "address"],
          required: false,
          where: Object.keys(checkInWhere).length ? checkInWhere : undefined,
        },
        {
          model: db.CheckOut,
          as: "checkouts",
          attributes: ["checkOutTime", "address"],
          required: false,
          where: Object.keys(checkOutWhere).length ? checkOutWhere : undefined,
        },
      ],
      order: [["name", "ASC"]],
    });

    let finalReport = [];

    employees.forEach((emp) => {
      const checkins = emp.checkins || [];
      const checkouts = emp.checkouts || [];

      if (checkins.length === 0) {
        finalReport.push({
          date: startDate || momentTz.tz(tz).format("YYYY-MM-DD"),
          empName: emp.name,
          empCode: emp.emp_code,
          location: "N/A",
          checkIn: "---",
          checkOut: "---",
          status: "Absent",
          workingHours: "0h 0m",
          workDone: "No Activity",
        });
      } else {
        checkins.forEach((checkin) => {
          const checkInDate = momentTz
            .utc(checkin.checkInTime)
            .format("YYYY-MM-DD");

          const checkout = checkouts.find(
            (co) =>
              momentTz.utc(co.checkOutTime).format("YYYY-MM-DD") ===
              checkInDate,
          );

          let status = "Short Attendance";
          let workingHours = "0h 0m";
          let checkOutTimeStr = "---";
          let workDoneStr = "Pending Checkout";

          if (checkout) {
            status = "Present";
            checkOutTimeStr = momentTz
              .utc(checkout.checkOutTime)
              .format("hh:mm A");
            workDoneStr = checkout.address || "N/A";

            const duration = momentTz.duration(
              momentTz
                .utc(checkout.checkOutTime)
                .diff(momentTz.utc(checkin.checkInTime)),
            );
            const hours = Math.floor(duration.asHours());
            const minutes = duration.minutes();
            workingHours = hours >= 0 ? `${hours}h ${minutes}m` : "0h 0m";
          }

          finalReport.push({
            date: momentTz.utc(checkin.checkInTime).format("DD-MM-YYYY"),
            empName: emp.name,
            empCode: emp.emp_code,
            location: checkin.address || "N/A",
            checkIn: momentTz.utc(checkin.checkInTime).format("hh:mm A"),
            checkOut: checkOutTimeStr,
            status: status,
            workingHours: workingHours,
            workDone: workDoneStr,
          });
        });
      }
    });

    return res.status(200).json({
      success: true,
      count: finalReport.length,
      attendance: finalReport,
    });
  } catch (error) {
    console.error("❌ Attendance Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getFilteredAttendance = async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;
    const tz = "Asia/Kolkata";

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Please provide both startDate and endDate.",
      });
    }

    const start = momentTz.tz(startDate, tz).startOf("day").toDate();
    const end = momentTz.tz(endDate, tz).endOf("day").toDate();

    const loggedInUserRole = req.user.role ? req.user.role.toUpperCase() : "";
    const loggedInUserId = req.user.id;

    const requester = await db.EmployeeMaster.findOne({
      where: { userId: loggedInUserId },
    });
    const userDept = requester?.department?.toUpperCase() || "";

    const isPrivileged =
      ["ADMIN", "HR", "ACCOUNTS"].includes(loggedInUserRole) ||
      ["HR", "ACCOUNTS"].includes(userDept);

    const whereCondition = {
      checkInTime: { [Op.between]: [start, end] },
    };

    if (!isPrivileged) {
      whereCondition.employeeId = requester.id;
    } else if (employeeId) {
      whereCondition.employeeId = employeeId;
    }

    const records = await db.CheckIn.findAll({
      where: whereCondition,
      include: [
        {
          model: db.EmployeeMaster,
          as: "employee",
          attributes: ["name", "emp_code", "department"],
        },
      ],
      order: [["checkInTime", "ASC"]],
    });

    // FIXED N+1 QUERY OPTIMIZATION HERE
    const employeeIds = records.map((r) => r.employeeId);
    const checkOuts = await db.CheckOut.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        checkOutTime: { [Op.between]: [start, end] },
      },
    });

    const report = records.map((checkIn) => {
      const checkInDateStr = momentTz
        .utc(checkIn.checkInTime)
        .format("YYYY-MM-DD");

      const checkOut = checkOuts.find(
        (co) =>
          co.employeeId === checkIn.employeeId &&
          momentTz.utc(co.checkOutTime).format("YYYY-MM-DD") === checkInDateStr,
      );

      return {
        id: checkIn.id,
        name: checkIn.employee?.name,
        empId: checkIn.employee?.emp_code,
        date: momentTz.utc(checkIn.checkInTime).format("DD-MM-YYYY"),
        checkIn: momentTz.utc(checkIn.checkInTime).format("hh:mm A"),
        checkOut: checkOut
          ? momentTz.utc(checkOut.checkOutTime).format("hh:mm A")
          : null,
        totalHours:
          checkOut?.working_hours &&
          !checkOut.working_hours.toString().startsWith("-")
            ? checkOut.working_hours
            : "0h",
        status: checkOut ? "Completed" : "In-Progress",
      };
    });

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

const getMonthlyPayrollReport = async (req, res) => {
  try {
    const { month } = req.query; // format: 2026-03
    const tz = "Asia/Kolkata";

    if (!month) {
      return res.status(400).json({
        success: false,
        message: "Month is required (YYYY-MM)",
      });
    }

    const startDate = momentTz.tz(month + "-01", tz).startOf("month");
    const endDate = momentTz.tz(startDate, tz).endOf("month");

    const employees = await db.EmployeeMaster.findAll({
      attributes: ["id", "name", "emp_code", "monthly_wages"],
      include: [
        {
          model: db.CheckIn,
          as: "checkins",
          required: false,
          where: {
            checkInTime: {
              [Op.between]: [startDate.toDate(), endDate.toDate()],
            },
          },
        },
        {
          model: db.CheckOut,
          as: "checkouts",
          required: false,
          where: {
            checkOutTime: {
              [Op.between]: [startDate.toDate(), endDate.toDate()],
            },
          },
        },
      ],
    });

    const totalDays = endDate.date();
    const weekends = [];

    for (let d = 1; d <= totalDays; d++) {
      const day = momentTz.tz(`${month}-${d}`, "YYYY-MM-DD", tz);
      if (day.day() === 0 || day.day() === 6) {
        weekends.push(day.format("YYYY-MM-DD"));
      }
    }

    const payroll = employees.map((emp) => {
      const presentDates = new Set();

      emp.checkins.forEach((c) => {
        presentDates.add(momentTz.utc(c.checkInTime).format("YYYY-MM-DD"));
      });

      const workingDays = totalDays - weekends.length;
      const present = presentDates.size;
      const absent = workingDays - present;

      const basic = emp.monthly_wages || 30000;
      const perDay = basic / workingDays;
      const payableAmount = Math.round(present * perDay);

      return {
        empId: emp.id,
        empCode: emp.emp_code,
        empName: emp.name,
        month,
        workingDays,
        present,
        absent,
        monthly_wages: basic,
        payableAmount,
      };
    });

    return res.status(200).json({
      success: true,
      payroll,
    });
  } catch (error) {
    console.error("Payroll Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  handleCheckIn,
  handleCheckOut,
  getAttendanceData,
  getTeamMembers,
  getFilteredAttendance,
  getAllAttendanceData,
  getMonthlyPayrollReport,
};
