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

    const templatePath = path.join(
      process.cwd(),
      "src",
      "modules",
      "hrm",
      "templates",
      "attendance_template.xlsx",
    );
    if (!fs.existsSync(templatePath)) {
      return res
        .status(500)
        .json({ success: false, message: "Template file missing" });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.getWorksheet(1);

    const startMom = moment(startDate);
    const endMom = moment(endDate);
    const targetMonth = startMom.month(); // Mahine ka index (0-11) save kar liya

    // 1. Header Update
    worksheet.getCell("A1").value =
      `Attendance Report of ${startMom.format("MMMM YYYY")}`;

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

    let currentRow = 4;
    employees.forEach((emp) => {
      const row = worksheet.getRow(currentRow);
      row.getCell(1).value = emp.name;
      row.getCell(2).value = emp.emp_code;

      let counters = { working: 0, present: 0, short: 0, absent: 0 };

      // ✅ 1 se 31 tak ka FIXED loop (Readability aur fixed columns ke liye)
      for (let day = 1; day <= 31; day++) {
        // Us mahine ki 'day' tarikh banayi
        const currentPtr = moment(startDate).date(day);
        const colIdx = 3 + (day - 1) * 2; // Column C, E, G...

        // ✅ Yeh check karta hai ki kya date us month/range mein hai
        // currentPtr.month() === targetMonth se Feb 29 March nahi banega
        if (
          currentPtr.isBetween(startMom, endMom, null, "[]") &&
          currentPtr.month() === targetMonth
        ) {
          counters.working++; // Sirf valid dinon ko working count karega

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
          // Range se bahar (jaise Feb 29, 30, 31) wale cells ko empty chhod dega
          row.getCell(colIdx).value = "";
          row.getCell(colIdx + 1).value = "";
        }
      }

      // 2. ✅ FIXED Summary Columns (BM se BP - Index 65-68)
      row.getCell(65).value = counters.working; // Total Working Days (e.g. 28 for Feb)
      row.getCell(66).value = counters.present + counters.short; // Total Present
      row.getCell(67).value = counters.absent; // Total Absent
      row.getCell(68).value = counters.short; // Total Short Attendance

      // Styling
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
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (error) {
    console.error("❌ Export Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { exportAttendanceWithTemplate };
