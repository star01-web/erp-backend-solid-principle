/**
 * Composition root for the HRM module. Builds repository -> service ->
 * controller graphs and injects collaborators (Dependency Inversion). The
 * shared Sequelize instance is injected into services that own transactions.
 */
const db = require("../../common/index.db");
const BaseRepository = require("../../common/BaseRepository");

const EmployeeRepository = require("./repositories/employee.repository");
const CheckInRepository = require("./repositories/checkIn.repository");
const CheckOutRepository = require("./repositories/checkOut.repository");
const OfficeLocationRepository = require("./repositories/officeLocation.repository");

const EmployeeService = require("./services/employee.service");
const AttendanceService = require("./services/attendance.service");
const PayrollService = require("./services/payroll.service");
const OfficeLocationService = require("./services/officeLocation.service");
const ExportService = require("./services/export.service");

const EmployeeController = require("./controllers/employee.controller");
const AttendanceController = require("./controllers/attendance.controller");
const OfficeLocationController = require("./controllers/officeLocation.controller");
const ExportController = require("./controllers/export.controller");

// Repositories
const employeeRepository = new EmployeeRepository(db.EmployeeMaster);
const checkInRepository = new CheckInRepository(db.CheckIn);
const checkOutRepository = new CheckOutRepository(db.CheckOut);
const officeLocationRepository = new OfficeLocationRepository(db.OfficeLocation);
const userRepository = new BaseRepository(db.User);

// Services
const employeeService = new EmployeeService({
  employeeRepository,
  userRepository,
  sequelize: db.sequelize,
});
const attendanceService = new AttendanceService({
  employeeRepository,
  checkInRepository,
  checkOutRepository,
  officeLocationRepository,
});
const payrollService = new PayrollService({ employeeRepository });
const officeLocationService = new OfficeLocationService({
  officeLocationRepository,
});
const exportService = new ExportService({ employeeRepository });

// Controllers
const employeeController = new EmployeeController({ employeeService });
const attendanceController = new AttendanceController({
  attendanceService,
  payrollService,
});
const officeLocationController = new OfficeLocationController({
  officeLocationService,
});
const exportController = new ExportController({ exportService });

module.exports = {
  employeeController,
  attendanceController,
  officeLocationController,
  exportController,
};
