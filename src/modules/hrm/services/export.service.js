const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const { Op } = require("sequelize");
const AppError = require("../../../common/AppError");

/**
 * Builds the monthly attendance Excel workbook from the template and writes it
 * to the provided stream. Keeps all spreadsheet layout logic in one place.
 */
class ExportService {
  constructor({ employeeRepository }) {
    this.employeeRepo = employeeRepository;
  }

  /**
   * @returns {Promise<{workbook: ExcelJS.Workbook, fileName: string}>}
   */
  async buildMonthlyAttendanceWorkbook({ startDate, endDate }) {
    if (!startDate || !endDate) {
      throw new AppError("Date range is required", 400);
    }

    const templatePath = path.join(
      process.cwd(),
      "src",
      "modules",
      "hrm",
      "templates",
      "attendance_template.xlsx",
    );
    if (!fs.existsSync(templatePath)) {
      throw new AppError("Template file missing", 500);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet(1);

    const startMom = moment(startDate);
    const endMom = moment(endDate);
    const targetMonth = startMom.month();

    worksheet.getCell("A1").value =
      `Attendance Report of ${startMom.format("MMMM YYYY")}`;

    const employees = await this.employeeRepo.findAll(
      {},
      {
        attributes: ["id", "name", "emp_code"],
        include: [
          {
            association: "checkins",
            required: false,
            where: {
              checkInTime: {
                [Op.between]: [
                  startMom.startOf("day").toDate(),
                  endMom.endOf("day").toDate(),
                ],
              },
            },
          },
          {
            association: "checkouts",
            required: false,
            where: {
              checkOutTime: {
                [Op.between]: [
                  startMom.startOf("day").toDate(),
                  endMom.endOf("day").toDate(),
                ],
              },
            },
          },
        ],
        order: [["name", "ASC"]],
      },
    );

    let currentRow = 4;
    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);
      row.getCell(1).value = emp.name;
      row.getCell(2).value = emp.emp_code;

      const counters = { working: 0, present: 0, short: 0, absent: 0 };

      for (let day = 1; day <= 31; day++) {
        const currentPtr = moment(startDate).date(day);
        const colIdx = 3 + (day - 1) * 2;

        if (
          currentPtr.isBetween(startMom, endMom, null, "[]") &&
          currentPtr.month() === targetMonth
        ) {
          counters.working++;

          const dStr = currentPtr.format("YYYY-MM-DD");
          const cin = emp.checkins.find(
            (c) => moment(c.checkInTime).format("YYYY-MM-DD") === dStr,
          );
          const cout = emp.checkouts.find(
            (c) => moment(c.checkOutTime).format("YYYY-MM-DD") === dStr,
          );

          row.getCell(colIdx).value = cin
            ? moment(cin.checkInTime).format("HH:mm")
            : "-";
          row.getCell(colIdx + 1).value = cout
            ? moment(cout.checkOutTime).format("HH:mm")
            : "-";

          if (cin) {
            if (cin.status === "Present") counters.present++;
            else if (cin.status === "Short Attendance") counters.short++;
          } else {
            counters.absent++;
          }
        } else {
          row.getCell(colIdx).value = "";
          row.getCell(colIdx + 1).value = "";
        }
      }

      row.getCell(65).value = counters.working;
      row.getCell(66).value = counters.present + counters.short;
      row.getCell(67).value = counters.absent;
      row.getCell(68).value = counters.short;

      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      currentRow++;
    });

    const fileName = `Attendance_${startMom.format("MMM_YYYY")}.xlsx`;
    return { workbook, fileName };
  }
}

module.exports = ExportService;
