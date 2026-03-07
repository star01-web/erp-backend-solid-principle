const ExcelJS = require("exceljs");
const path = require("path");
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

    // 1. ✅ Absolute Path Fix (Linux Server Friendly)
    // process.cwd() project root (nodejs/) se path uthayega
    const templatePath = path.join(
      process.cwd(),
      "src",
      "modules",
      "hrm",
      "templates",
      "attendance_template.xlsx",
    );

    const workbook = new ExcelJS.Workbook();

    // Check karein ki template exist karta hai ya nahi
    try {
      await workbook.xlsx.readFile(templatePath);
    } catch (readError) {
      console.error("🔍 Template not found at:", templatePath);
      return res.status(500).json({
        success: false,
        message: "Template file missing at " + templatePath,
      });
    }

    const worksheet = workbook.getWorksheet(1);

    // 2. ✅ Dynamic Month & Range Heading
    const monthName = moment(startDate).format("MMMM YYYY");
    const dateRangeStr = `${moment(startDate).format("DD-MM-YYYY")} to ${moment(endDate).format("DD-MM-YYYY")}`;

    // A1 aur A2 cells ko update karna
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Attendance Report of ${monthName}`;

    const rangeCell = worksheet.getCell("A2");
    if (rangeCell) rangeCell.value = `Period: ${dateRangeStr}`;

    // 3. ✅ Data Fetching (With Token-based filtering if needed)
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

    // 4. ✅ Data Filling Logic (Row 4 se shuru)
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

        // In/Out Values
        row.getCell(colIndex).value = cin
          ? moment(cin.checkInTime).format("hh:mm A")
          : "---";
        row.getCell(colIndex + 1).value = cout
          ? moment(cout.checkOutTime).format("hh:mm A")
          : "---";

        // Alignment
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

      // 5. ✅ Borders Apply Karna (Template design preserve rahega)
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

    // 6. ✅ Final Response Settings
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
