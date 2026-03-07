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

    // 1. ✅ Template Path Setup
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

    // 2. ✅ Dynamic Header (A1 mein Month Name)
    const startMom = moment(startDate);
    const endMom = moment(endDate);
    const monthName = startMom.format("MMMM YYYY");

    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Attendance Report of ${monthName}`;

    const rangeCell = worksheet.getCell("A2");
    if (rangeCell) {
      rangeCell.value = `Period: ${startMom.format("DD-MM-YYYY")} to ${endMom.format("DD-MM-YYYY")}`;
    }

    // 3. ✅ Fetch Data from Database
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
                startMom.startOf("day").toDate(),
                endMom.endOf("day").toDate(),
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
                startMom.startOf("day").toDate(),
                endMom.endOf("day").toDate(),
              ],
            },
          },
        },
      ],
      order: [["name", "ASC"]],
    });

    // 4. ✅ Data Filling Logic (Row 4 onwards)
    let currentRow = 4;

    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);

      // Basic Info
      row.getCell(1).value = emp.name; // Column A
      row.getCell(2).value = emp.emp_code; // Column B

      let counters = { working: 0, present: 0, short: 0, absent: 0 };
      let datePtr = moment(startDate);
      let colIdx = 3; // Column C se Dates shuru

      while (datePtr <= endMom) {
        counters.working++;
        const dStr = datePtr.format("YYYY-MM-DD");

        const cin = emp.checkins.find(
          (c) => moment(c.checkInTime).format("YYYY-MM-DD") === dStr,
        );
        const cout = emp.checkouts.find(
          (c) => moment(c.checkOutTime).format("YYYY-MM-DD") === dStr,
        );

        // Fill In/Out
        row.getCell(colIdx).value = cin
          ? moment(cin.checkInTime).format("hh:mm A")
          : "---";
        row.getCell(colIdx + 1).value = cout
          ? moment(cout.checkOutTime).format("hh:mm A")
          : "---";

        // Logic for Calculations
        if (cin) {
          if (cin.status === "Present") counters.present++;
          else if (cin.status === "Short Attendance") counters.short++;
        } else {
          counters.absent++;
        }

        datePtr.add(1, "days");
        colIdx += 2; // Jump 2 columns for next date
      }

      // 5. ✅ Summary Columns (As per your uploaded image)
      row.getCell(colIdx).value = counters.working; // Total Working Days
      row.getCell(colIdx + 1).value = counters.present + counters.short; // Total Present
      row.getCell(colIdx + 2).value = counters.absent; // Total Absent
      row.getCell(colIdx + 3).value = counters.short; // Total Short Attendance

      // Apply Borders & Center Align
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

    // 6. ✅ Final Response Delivery
    const finalFileName = `Attendance_${monthName.replace(/\s/g, "_")}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${finalFileName}`,
    );

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (error) {
    console.error("❌ Export Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { exportAttendanceWithTemplate };
