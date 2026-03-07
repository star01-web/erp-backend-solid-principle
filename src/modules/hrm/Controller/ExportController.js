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

    // 1. ✅ Absolute Path Calculation (Server-friendly)
    // process.cwd() project ke root (nodejs/) tak ka path nikalta hai
    const templatePath = path.join(
      process.cwd(),
      "src",
      "modules",
      "hrm",
      "templates",
      "attendance_template.xlsx",
    );

    // 2. ✅ Check karein ki file wahan hai ya nahi
    if (!fs.existsSync(templatePath)) {
      console.error("❌ Template file not found at:", templatePath);
      return res.status(500).json({
        success: false,
        message: "Server par template file nahi mili. Path check karein.",
        debugPath: templatePath,
      });
    }

    // 3. ✅ ExcelJS Workbook Load Karein
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet(1);

    // 4. ✅ Dynamic Heading Logic
    const monthName = moment(startDate).format("MMMM YYYY");
    const dateRangeStr = `${moment(startDate).format("DD-MM-YYYY")} to ${moment(endDate).format("DD-MM-YYYY")}`;

    // A1 Cell: Heading
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Attendance Report of ${monthName}`;

    // A2 Cell: Date Range (Optional)
    const rangeCell = worksheet.getCell("A2");
    if (rangeCell) rangeCell.value = `Period: ${dateRangeStr}`;

    // 5. ✅ Database Data Fetching
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

    // 6. ✅ Data Filling Logic (Row 4 se)
    let currentRow = 4;

    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);
      row.getCell(1).value = emp.name;
      row.getCell(2).value = emp.emp_code;

      let datePointer = moment(startDate);
      const end = moment(endDate);
      let colIndex = 3; // Column C se Dates shuru

      while (datePointer <= end) {
        const dateStr = datePointer.format("YYYY-MM-DD");

        const cin = emp.checkins.find(
          (c) => moment(c.checkInTime).format("YYYY-MM-DD") === dateStr,
        );
        const cout = emp.checkouts.find(
          (c) => moment(c.checkOutTime).format("YYYY-MM-DD") === dateStr,
        );

        // Data Insertion
        row.getCell(colIndex).value = cin
          ? moment(cin.checkInTime).format("hh:mm A")
          : "---";
        row.getCell(colIndex + 1).value = cout
          ? moment(cout.checkOutTime).format("hh:mm A")
          : "---";

        // Style Settings
        row.getCell(colIndex).alignment = {
          horizontal: "center",
          vertical: "middle",
        };
        row.getCell(colIndex + 1).alignment = {
          horizontal: "center",
          vertical: "middle",
        };

        datePointer.add(1, "days");
        colIndex += 2;
      }

      // Border set karna
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      currentRow++;
    });

    // 7. ✅ Final Response Delivery
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
    console.error("❌ Export Critical Error:", error);
    res.status(500).json({
      success: false,
      message: "Server side error during excel generation",
      error: error.message,
    });
  }
};

module.exports = { exportAttendanceWithTemplate };
