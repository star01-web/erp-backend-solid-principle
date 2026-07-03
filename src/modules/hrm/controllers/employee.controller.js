const AppError = require("../../../common/AppError");

/**
 * HTTP layer for employee management. Reproduces each endpoint's exact response
 * envelope; logic + transactions live in EmployeeService.
 */
class EmployeeController {
  constructor({ employeeService }) {
    this.employeeService = employeeService;
  }

  CreateEmployee = async (req, res) => {
    try {
      const { loginId, employeeId } =
        await this.employeeService.createEmployee(req.body);
      return res.status(201).json({
        status: "Success",
        message: "User Login aur Employee Profile dono ban gaye hain.",
        data: { loginId, employeeId },
      });
    } catch (error) {
      if (error instanceof AppError) {
        const body = { message: error.message };
        if (error.detail !== undefined) body.error = error.detail;
        return res.status(error.statusCode).json(body);
      }
      return res
        .status(500)
        .json({ message: "Internal Server Error", error: error.message });
    }
  };

  bulkCreateEmployees = async (req, res) => {
    try {
      const data = await this.employeeService.bulkCreateEmployees(req.body);
      return res.status(201).json({
        status: "Success",
        message: `${data.length} Employees successfully create ho gaye hain.`,
        data,
      });
    } catch (error) {
      if (error instanceof AppError && error.bulk) {
        return res.status(500).json({
          status: "Failed",
          message:
            "Bulk Insert fail hua. Koi bhi record database me save nahi hua.",
          error: error.message,
        });
      }
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      return res.status(500).json({
        status: "Failed",
        message:
          "Bulk Insert fail hua. Koi bhi record database me save nahi hua.",
        error: error.message,
      });
    }
  };

  updateEmployee = async (req, res) => {
    try {
      const employee = await this.employeeService.updateEmployee(
        req.params.id,
        req.body,
      );
      return res.status(200).json({
        status: "Success",
        message: "Employee data aur Supervisor ID update ho gayi.",
        data: employee,
      });
    } catch (error) {
      if (error instanceof AppError) {
        const body = { message: error.message };
        if (error.detail !== undefined) body.error = error.detail;
        return res.status(error.statusCode).json(body);
      }
      return res
        .status(500)
        .json({ message: "Update fail hua.", error: error.message });
    }
  };

  getallEmployee = async (req, res) => {
    try {
      const employees = await this.employeeService.getAllEmployees();
      return res.status(200).json({ success: true, employees });
    } catch (error) {
      console.error("❌ Get All Employees Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        details: error.message,
      });
    }
  };

  getEmployeeProfile = async (req, res) => {
    try {
      const data = await this.employeeService.getEmployeeProfile(
        req.user.email,
        req.user.id,
      );
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("❌ Profile Controller Error:", error.message);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  };
}

module.exports = EmployeeController;
