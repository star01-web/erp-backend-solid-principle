const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const { Op } = require("sequelize");
const db = require("../../../common/index.db");

const exportAttendanceWithTemplate = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Date range is required" });
    }

    // 1. ✅ Path Configuration (Linux & Windows Friendly)
    const templatePath = path.join(
      process.cwd(),
      "src",
      "modules",
      "hrm",
      "templates",
      "attendance_template.xlsx",
    );

    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({
        success: false,
        message: "Template file missing at " + templatePath,
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet(1);

    // 2. ✅ Header & Month Calculation
    const monthName = moment(startDate).format("MMMM YYYY");
    const dateRangeStr = `${moment(startDate).format("DD-MM-YYYY")} to ${moment(endDate).format("DD-MM-YYYY")}`;

    worksheet.getCell("A1").value = `Attendance Report of ${monthName}`;
    const rangeCell = worksheet.getCell("A2");
    if (rangeCell) rangeCell.value = `Period: ${dateRangeStr}`;

    // 3. ✅ Data Fetching
    const employees = await db.EmployeeMaster.findAll({
      attributes: ["id", "name", "emp_code"],
      include: [
        {
          model: db.CheckIn,
          as: "checkins",
          required: false,
          where: {
            checkInTime: {
              [Op.between]: [
                moment(startDate).startOf("day").toDate(),
                moment(endDate).endOf("day").toDate(),
              ],
            },
          },
        },
        {
          model: db.CheckOut,
          as: "checkouts",
          required: false,
          where: {
            checkOutTime: {
              [Op.between]: [
                moment(startDate).startOf("day").toDate(),
                moment(endDate).endOf("day").toDate(),
              ],
            },
          },
        },
      ],
      order: [["name", "ASC"]],
    });

    // 4. ✅ Main Loop for Rows & Calculations
    let currentRow = 4;

    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);
      row.getCell(1).value = emp.name;
      row.getCell(2).value = emp.emp_code;

      let counters = {
        workingDays: 0,
        present: 0,
        shortAttendance: 0,
        absent: 0,
      };

      let datePointer = moment(startDate);
      const end = moment(endDate);
      let colIndex = 3; // Column C se Dates (In/Out) shuru

      while (datePointer <= end) {
        counters.workingDays++;
        const dateStr = datePointer.format("YYYY-MM-DD");

        const cin = emp.checkins.find(
          (c) => moment(c.checkInTime).format("YYYY-MM-DD") === dateStr,
        );
        const cout = emp.checkouts.find(
          (c) => moment(c.checkOutTime).format("YYYY-MM-DD") === dateStr,
        );

        // Data Fill
        row.getCell(colIndex).value = cin
          ? moment(cin.checkInTime).format("hh:mm A")
          : "---";
        row.getCell(colIndex + 1).value = cout
          ? moment(cout.checkOutTime).format("hh:mm A")
          : "---";

        // Calculation Logic
        if (cin) {
          if (cin.status === "Present") {
            counters.present++;
          } else if (cin.status === "Short Attendance") {
            counters.shortAttendance++;
          }
        } else {
          counters.absent++;
        }

        datePointer.add(1, "days");
        colIndex += 2;
      }

      // 5. ✅ Summary Columns (Jo aapne image mein dikhayi hain)
      row.getCell(colIndex).value = counters.workingDays; // Total Working Days
      row.getCell(colIndex + 1).value =
        counters.present + counters.shortAttendance; // Total Present Days
      row.getCell(colIndex + 2).value = counters.absent; // Total Absent Days
      row.getCell(colIndex + 3).value = counters.shortAttendance; // Total Short Attendance Days

      // Formatting & Borders
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

    // 6. ✅ Response Setup
    const fileName = `Attendance_${monthName.replace(/\s/g, "_")}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("❌ Critical Export Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { exportAttendanceWithTemplate };
