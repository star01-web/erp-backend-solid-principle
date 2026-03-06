const ExcelJS = require("exceljs");
const path = require("path");
const moment = require("moment");
const { Op } = require("sequelize");
const db = require("../../../common/index.db"); // Aapka db path

const exportAttendanceWithTemplate = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: "Date range is required" });
    }

    // 1. Template File ka Path
    const templatePath = path.join(
      __dirname,
      "../templates/attendance_template.xlsx",
    );

    // 2. ExcelJS Workbook Load Karein
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet(1);

    // 3. Dynamic Heading Set Karein (Month Name)
    const monthName = moment(startDate).format("MMMM YYYY");
    const dateRangeStr = `${moment(startDate).format("DD-MM-YYYY")} to ${moment(endDate).format("DD-MM-YYYY")}`;

    // Maan lijiye A1 mein aapka main title hai
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Attendance Report of ${monthName}`;

    // Maan lijiye A2 mein aap date range dikhana chahte hain
    const rangeCell = worksheet.getCell("A2");
    if (rangeCell) rangeCell.value = `Period: ${dateRangeStr}`;

    // 4. Database se Data Fetch Karein
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
                moment(startDate).startOf("day").format("YYYY-MM-DD HH:mm:ss"),
                moment(endDate).endOf("day").format("YYYY-MM-DD HH:mm:ss"),
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
                moment(startDate).startOf("day").format("YYYY-MM-DD HH:mm:ss"),
                moment(endDate).endOf("day").format("YYYY-MM-DD HH:mm:ss"),
              ],
            },
          },
        },
      ],
      order: [["name", "ASC"]],
    });

    // 5. Data Fill Karne ka Logic (Row 4 se shuru)
    let currentRow = 4;

    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);

      // Column A: Employee Name, Column B: Emp Code (Template ke hisab se adjust karein)
      row.getCell(1).value = emp.name;
      row.getCell(2).value = emp.emp_code;

      let datePointer = moment(startDate);
      const end = moment(endDate);
      let colIndex = 3; // Agar Column C se Dates shuru ho rahi hain

      while (datePointer <= end) {
        const dateStr = datePointer.format("YYYY-MM-DD");

        // Check-in/Out match karein
        const cin = emp.checkins.find(
          (c) => moment(c.checkInTime).format("YYYY-MM-DD") === dateStr,
        );
        const cout = emp.checkouts.find(
          (c) => moment(c.checkOutTime).format("YYYY-MM-DD") === dateStr,
        );

        // Cells mein data bharein
        row.getCell(colIndex).value = cin
          ? moment(cin.checkInTime).format("hh:mm A")
          : "---";
        row.getCell(colIndex + 1).value = cout
          ? moment(cout.checkOutTime).format("hh:mm A")
          : "---";

        // Styling (Optional: Text align center)
        row.getCell(colIndex).alignment = { horizontal: "center" };
        row.getCell(colIndex + 1).alignment = { horizontal: "center" };

        datePointer.add(1, "days");
        colIndex += 2; // Next date ke liye 2 columns aage (In/Out)
      }

      // Har row ke baad borders add karein (Template design maintain rakhne ke liye)
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      row.commit();
      currentRow++;
    });

    // 6. Response Headers aur Download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Attendance_${monthName.replace(" ", "_")}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("❌ Export Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error during export",
      error: error.message,
    });
  }
};

module.exports = { exportAttendanceWithTemplate };
