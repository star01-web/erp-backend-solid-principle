const momentTz = require("moment-timezone");

const TZ = "Asia/Kolkata";

// IST day/month boundaries (returned as JS Date for Sequelize comparisons).
const startOfTodayIST = () => momentTz.tz(TZ).startOf("day").toDate();
const startOfDayIST = (d) => momentTz.tz(d, TZ).startOf("day").toDate();
const endOfDayIST = (d) => momentTz.tz(d, TZ).endOf("day").toDate();
const startOfMonthIST = () => momentTz.tz(TZ).startOf("month").toDate();
const endOfMonthIST = () => momentTz.tz(TZ).endOf("month").toDate();

module.exports = {
  TZ,
  momentTz,
  startOfTodayIST,
  startOfDayIST,
  endOfDayIST,
  startOfMonthIST,
  endOfMonthIST,
};
