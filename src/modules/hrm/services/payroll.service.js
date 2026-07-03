const { Op } = require("sequelize");
const AppError = require("../../../common/AppError");
const { TZ, momentTz } = require("../utils/time");

/**
 * Payroll computation from attendance records.
 */
class PayrollService {
  constructor({ employeeRepository }) {
    this.employeeRepo = employeeRepository;
  }

  async getMonthlyPayroll(month) {
    if (!month) {
      throw new AppError("Month is required (YYYY-MM)", 400);
    }

    const startDate = momentTz.tz(month + "-01", TZ).startOf("month");
    const endDate = momentTz.tz(startDate, TZ).endOf("month");

    const employees = await this.employeeRepo.findAll(
      {},
      {
        attributes: ["id", "name", "emp_code", "monthly_wages"],
        include: [
          {
            association: "checkins",
            required: false,
            where: {
              checkInTime: {
                [Op.between]: [startDate.toDate(), endDate.toDate()],
              },
            },
          },
          {
            association: "checkouts",
            required: false,
            where: {
              checkOutTime: {
                [Op.between]: [startDate.toDate(), endDate.toDate()],
              },
            },
          },
        ],
      },
    );

    const totalDays = endDate.date();
    const weekends = [];
    for (let d = 1; d <= totalDays; d++) {
      const day = momentTz.tz(`${month}-${d}`, "YYYY-MM-DD", TZ);
      if (day.day() === 0 || day.day() === 6) {
        weekends.push(day.format("YYYY-MM-DD"));
      }
    }

    return employees.map((emp) => {
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
  }
}

module.exports = PayrollService;
