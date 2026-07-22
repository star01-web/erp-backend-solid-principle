const { Op } = require("sequelize");
const AppError = require("../../../common/AppError");
const { findMatchingSite } = require("../utils/geo");
const { getAddressFromOSM } = require("../utils/osm");
const {
  TZ,
  momentTz,
  startOfTodayIST,
  startOfDayIST,
  endOfDayIST,
  startOfMonthIST,
  endOfMonthIST,
} = require("../utils/time");

/**
 * Attendance business logic: geofenced check-in/out and attendance reports.
 * Depends only on injected repositories + pure utils.
 */
class AttendanceService {
  constructor({
    employeeRepository,
    checkInRepository,
    checkOutRepository,
    projectSiteRepository,
  }) {
    this.employeeRepo = employeeRepository;
    this.checkInRepo = checkInRepository;
    this.checkOutRepo = checkOutRepository;
    this.siteRepo = projectSiteRepository;
  }

  async checkIn({ requesterUserId, employee_ids, latitude, longitude }) {
    const requesterProfile = await this.employeeRepo.findByUserId(
      requesterUserId,
    );
    if (!requesterProfile) throw new AppError("Profile not found.", 404);

    const requesterEmpId = requesterProfile.id;
    const targetEmployeeIds =
      Array.isArray(employee_ids) && employee_ids.length > 0
        ? employee_ids
        : [requesterEmpId];

    // 1. Already checked in today? (IST safe)
    const startOfDay = startOfTodayIST();
    const alreadyCheckedIn = await this.checkInRepo.findAll(
      {
        employeeId: { [Op.in]: targetEmployeeIds },
        checkInTime: { [Op.gte]: startOfDay },
      },
      { attributes: ["employeeId"] },
    );
    const checkedInIds = alreadyCheckedIn.map((rec) => rec.employeeId);
    const finalIdsToPunch = targetEmployeeIds.filter(
      (id) => !checkedInIds.includes(id),
    );
    if (finalIdsToPunch.length === 0) {
      throw new AppError("Selected employees already checked in today.", 400);
    }

    // 2. Geofencing (multiple offices)
    const allOffices = await this.siteRepo.findAll();
    const matchedOffice = findMatchingSite(allOffices, latitude, longitude);

    const employeesToPunch = await this.employeeRepo.findAll({
      id: { [Op.in]: finalIdsToPunch },
    });
    for (const emp of employeesToPunch) {
      const position = (emp.position || "").toLowerCase();
      const isFieldStaff =
        position.includes("sales") ||
        position.includes("driver") ||
        position.includes("field");
      if (!matchedOffice && !isFieldStaff) {
        throw new AppError(
          `${emp.name} kisi bhi office location ke dayre mein nahi hain.`,
          403,
        );
      }
    }

    // 3. Process & save
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

    const records = await this.checkInRepo.bulkCreate(checkInDataArray);
    return {
      records,
      location: matchedOffice ? matchedOffice.locationName : "Field/On-road",
      address: finalAddress,
    };
  }

  async checkOut({ requesterUserId, employee_ids, latitude, longitude }) {
    const requesterProfile = await this.employeeRepo.findByUserId(
      requesterUserId,
    );
    if (!requesterProfile) throw new AppError("Profile not found.", 404);

    const requesterEmpId = requesterProfile.id;
    const targetEmployeeIds =
      Array.isArray(employee_ids) && employee_ids.length > 0
        ? employee_ids
        : [requesterEmpId];

    const [allOffices, employees, finalAddress] = await Promise.all([
      this.siteRepo.findAll(),
      this.employeeRepo.findAll({ id: { [Op.in]: targetEmployeeIds } }),
      getAddressFromOSM(latitude, longitude),
    ]);

    const matchedOffice = findMatchingSite(allOffices, latitude, longitude);

    for (const emp of employees) {
      const position = (emp.position || "").toLowerCase();
      const isFieldStaff =
        position.includes("sales") || position.includes("driver");
      if (!matchedOffice && !isFieldStaff) {
        throw new AppError(
          `${emp.name} kisi bhi authorized office location ke dayre mein nahi hain (Check-out blocked).`,
          403,
        );
      }
    }

    const now = new Date();
    const todayStart = startOfTodayIST();

    const [allCheckIns, allCheckOuts] = await Promise.all([
      this.checkInRepo.findAll(
        {
          employeeId: { [Op.in]: targetEmployeeIds },
          checkInTime: { [Op.gte]: todayStart },
        },
        { order: [["checkInTime", "DESC"]] },
      ),
      this.checkOutRepo.findAll({
        employeeId: { [Op.in]: targetEmployeeIds },
        checkOutTime: { [Op.gte]: todayStart },
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
      throw new AppError(
        "Check-out nahi ho saka. Ya toh check-in nahi kiya, ya pehle hi check-out ho chuka hai.",
        400,
      );
    }

    const records = await this.checkOutRepo.bulkCreate(checkOutDataArray);
    return {
      records,
      location: matchedOffice ? matchedOffice.locationName : "Field/On-road",
    };
  }

  async getTeamMembers(supervisorId) {
    console.log("🔍 Fetching team for Supervisor ID:", supervisorId);
    return this.employeeRepo.findAll(
      { supervisor_id: supervisorId },
      {
        attributes: ["id", "emp_code", "name", "phone", "email", "position"],
        order: [["name", "ASC"]],
      },
    );
  }

  async getAttendanceData({ startDate, endDate, userId, role }) {
    const start = startDate ? startOfDayIST(startDate) : startOfMonthIST();
    const end = endDate ? endOfDayIST(endDate) : endOfMonthIST();

    const loggedInUserRole = role ? role.toUpperCase() : "";

    const requesterProfile = await this.employeeRepo.findByUserId(userId);
    if (!requesterProfile) throw new AppError("Profile not found.", 404);

    const userDept = requesterProfile.department
      ? requesterProfile.department.toUpperCase()
      : "";
    const isPrivilegedUser =
      loggedInUserRole === "ADMIN" ||
      userDept === "HR" ||
      userDept === "ACCOUNTS";

    const whereCondition = { checkInTime: { [Op.between]: [start, end] } };
    if (!isPrivilegedUser) {
      const teamMembers = await this.employeeRepo.findAll(
        { supervisor_id: requesterProfile.id },
        { attributes: ["id"] },
      );
      const teamIds = teamMembers.map((m) => m.id);
      whereCondition.employeeId = { [Op.in]: [requesterProfile.id, ...teamIds] };
    }

    const attendanceRecords = await this.checkInRepo.findAll(whereCondition, {
      include: [
        {
          association: "employee",
          attributes: ["name", "emp_code", "department"],
        },
      ],
      order: [["checkInTime", "DESC"]],
    });

    const employeeIds = attendanceRecords.map((r) => r.employeeId);
    const checkOuts = await this.checkOutRepo.findAll({
      employeeId: { [Op.in]: employeeIds },
      checkOutTime: { [Op.between]: [start, end] },
    });

    const toIST = (dateObj) => {
      if (!dateObj) return "--:--";
      return momentTz.utc(dateObj).format("hh:mm A");
    };

    return attendanceRecords.map((checkIn) => {
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
  }

  async getAllAttendanceData({ startDate, endDate }) {
    const checkInWhere = {};
    const checkOutWhere = {};
    if (startDate && endDate) {
      const start = startOfDayIST(startDate);
      const end = endOfDayIST(endDate);
      checkInWhere.checkInTime = { [Op.between]: [start, end] };
      checkOutWhere.checkOutTime = { [Op.between]: [start, end] };
    }

    const employees = await this.employeeRepo.findAll(
      {},
      {
        attributes: ["id", "name", "emp_code"],
        include: [
          {
            association: "checkins",
            attributes: ["checkInTime", "address"],
            required: false,
            where: Object.keys(checkInWhere).length ? checkInWhere : undefined,
          },
          {
            association: "checkouts",
            attributes: ["checkOutTime", "address"],
            required: false,
            where: Object.keys(checkOutWhere).length ? checkOutWhere : undefined,
          },
        ],
        order: [["name", "ASC"]],
      },
    );

    const finalReport = [];
    employees.forEach((emp) => {
      const checkins = emp.checkins || [];
      const checkouts = emp.checkouts || [];

      if (checkins.length === 0) {
        finalReport.push({
          date: startDate || momentTz.tz(TZ).format("YYYY-MM-DD"),
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
            status,
            workingHours,
            workDone: workDoneStr,
          });
        });
      }
    });

    return finalReport;
  }

  async getFilteredAttendance({ startDate, endDate, employeeId, userId, role }) {
    if (!startDate || !endDate) {
      throw new AppError("Please provide both startDate and endDate.", 400);
    }

    const start = startOfDayIST(startDate);
    const end = endOfDayIST(endDate);

    const loggedInUserRole = role ? role.toUpperCase() : "";
    const requester = await this.employeeRepo.findByUserId(userId);
    const userDept = requester?.department?.toUpperCase() || "";

    const isPrivileged =
      ["ADMIN", "HR", "ACCOUNTS"].includes(loggedInUserRole) ||
      ["HR", "ACCOUNTS"].includes(userDept);

    const whereCondition = { checkInTime: { [Op.between]: [start, end] } };
    if (!isPrivileged) {
      whereCondition.employeeId = requester.id;
    } else if (employeeId) {
      whereCondition.employeeId = employeeId;
    }

    const records = await this.checkInRepo.findAll(whereCondition, {
      include: [
        {
          association: "employee",
          attributes: ["name", "emp_code", "department"],
        },
      ],
      order: [["checkInTime", "ASC"]],
    });

    const employeeIds = records.map((r) => r.employeeId);
    const checkOuts = await this.checkOutRepo.findAll({
      employeeId: { [Op.in]: employeeIds },
      checkOutTime: { [Op.between]: [start, end] },
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

    return { report, start, end };
  }
}

module.exports = AttendanceService;
