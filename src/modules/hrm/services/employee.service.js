const { Op } = require("sequelize");
const AppError = require("../../../common/AppError");

/**
 * Employee + login-account business logic. Owns the cross-table (User +
 * EmployeeMaster) transactions. Sequelize instance is injected for transaction
 * management; all reads/writes go through repositories.
 *
 * Each public method maps failures to the EXACT response the original
 * controller produced (status code + envelope), preserving API behavior.
 */
class EmployeeService {
  constructor({ employeeRepository, userRepository, sequelize }) {
    this.employeeRepo = employeeRepository;
    this.userRepo = userRepository;
    this.sequelize = sequelize;
  }

  async createEmployee(data) {
    const {
      name,
      email,
      password,
      phone,
      address,
      username,
      department,
      position,
      monthly_wages,
      location_id,
      supervisor_id,
      role,
      emp_code,
    } = data;

    if (!email || !password || !name || !location_id) {
      throw new AppError(
        "Zaroori fields missing hain (Email, Password, Name, Location).",
        400,
      );
    }

    const t = await this.sequelize.transaction();
    try {
      const existingUser = await this.userRepo.findOne(
        { [Op.or]: [{ email }, { username: username || email }] },
        { transaction: t },
      );
      if (existingUser) {
        await t.rollback();
        throw new AppError("Email or username already in use.", 409);
      }

      if (phone) {
        const existingPhone = await this.employeeRepo.findOne(
          { phone },
          { transaction: t },
        );
        if (existingPhone) {
          await t.rollback();
          throw new AppError("Phone already in use.", 409);
        }
      }

      const newUser = await this.userRepo.create(
        {
          name,
          email,
          username: username || email,
          password,
          role: role || "EMPLOYEE",
        },
        { transaction: t },
      );
      console.log("Naye User ki ID hai:", newUser.id);

      const newEmployee = await this.employeeRepo.create(
        {
          emp_code,
          name,
          email,
          phone,
          address,
          department,
          position,
          monthly_wages,
          location_id,
          supervisor_id: supervisor_id || null,
          user_id: newUser.id,
          isActive: true,
        },
        { transaction: t },
      );

      await t.commit();
      return { loginId: newUser.id, employeeId: newEmployee.id };
    } catch (error) {
      try {
        await t.rollback();
      } catch (_) {
        /* already rolled back */
      }
      if (error instanceof AppError) throw error;

      // Single-create error mapping (matches original controller)
      console.error("Error in Registration:", error);
      if (
        error.name === "SequelizeUniqueConstraintError" ||
        error.name === "SequelizeValidationError"
      ) {
        throw new AppError(error.errors.map((e) => e.message).join(", "), 400);
      }
      const err = new AppError("Internal Server Error", 500);
      err.detail = error.message; // controller renders { message, error }
      throw err;
    }
  }

  async bulkCreateEmployees(employeesData) {
    if (!Array.isArray(employeesData) || employeesData.length === 0) {
      throw new AppError(
        "Data ek valid Array of Objects format mein hona chahiye.",
        400,
      );
    }

    const t = await this.sequelize.transaction();
    try {
      const createdRecords = [];

      for (const empData of employeesData) {
        const {
          name,
          email,
          password,
          phone,
          address,
          username,
          department,
          position,
          monthly_wages,
          location_id,
          supervisor_id,
          role,
          emp_code,
        } = empData;

        if (!email || !password || !name || !location_id) {
          throw new Error(
            `'${name || email || "Ek employee"}' ka data in-complete hai. Email, Password, Name aur Location zaroori hain.`,
          );
        }

        const conflictUser = await this.userRepo.findOne(
          { [Op.or]: [{ email }, { username: username || email }] },
          { transaction: t },
        );
        if (conflictUser) {
          throw new Error(`User with email/username '${email}' already exists`);
        }
        if (phone) {
          const conflictPhone = await this.employeeRepo.findOne(
            { phone },
            { transaction: t },
          );
          if (conflictPhone) {
            throw new Error(`Phone '${phone}' already in use`);
          }
        }

        const newUser = await this.userRepo.create(
          {
            name,
            email,
            username: username || email,
            password,
            role: role || "EMPLOYEE",
          },
          { transaction: t },
        );

        const newEmployee = await this.employeeRepo.create(
          {
            emp_code,
            name,
            email,
            phone,
            address,
            department,
            position,
            monthly_wages,
            location_id,
            supervisor_id: supervisor_id || null,
            user_id: newUser.id,
            isActive: true,
          },
          { transaction: t },
        );

        createdRecords.push({
          emp_code: newEmployee.emp_code,
          loginId: newUser.id,
          employee_master_id: newEmployee.id,
        });
      }

      await t.commit();
      return createdRecords;
    } catch (error) {
      try {
        await t.rollback();
      } catch (_) {
        /* already rolled back */
      }
      let errorMessage = error.message;
      if (
        error.name === "SequelizeUniqueConstraintError" ||
        error.name === "SequelizeValidationError"
      ) {
        errorMessage = error.errors.map((e) => e.message).join(", ");
      }
      console.error("Error in Bulk Registration:", errorMessage);
      // Bulk path always responds 500 with { status:'Failed', message, error }
      const err = new AppError(errorMessage, 500);
      err.bulk = true;
      throw err;
    }
  }

  async updateEmployee(id, data) {
    const {
      name,
      phone,
      role,
      address,
      location_id,
      supervisor_id,
      department,
      position,
      monthly_wages,
      isActive,
    } = data;

    const t = await this.sequelize.transaction();
    try {
      const employee = await this.employeeRepo.findById(id);
      if (!employee) {
        await t.rollback();
        throw new AppError("Employee nahi mila.", 404);
      }

      await employee.update(
        {
          name,
          phone,
          address,
          location_id: location_id || employee.location_id,
          supervisor_id: supervisor_id || employee.supervisor_id,
          department,
          position,
          monthly_wages,
          isActive,
        },
        { transaction: t },
      );

      if (role && employee.user_id) {
        await this.userRepo.update(
          { role },
          { id: employee.user_id },
          { transaction: t },
        );
      }

      await t.commit();
      return employee;
    } catch (error) {
      try {
        await t.rollback();
      } catch (_) {
        /* already rolled back */
      }
      if (error instanceof AppError) throw error;
      console.error("Update Error:", error);
      const err = new AppError("Update fail hua.", 500);
      err.detail = error.message;
      throw err;
    }
  }

  async getAllEmployees() {
    return this.employeeRepo.findAll(
      {},
      {
        attributes: [
          "id",
          "emp_code",
          "name",
          "email",
          "phone",
          "department",
          "position",
          "monthly_wages",
          "location_id",
          "supervisor_id",
        ],
        include: [
          { association: "loginDetails", attributes: ["username", "role"] },
          { association: "location", attributes: ["id", "locationName"] },
          { association: "supervisor", attributes: ["id", "name"] },
        ],
        order: [["createdAt", "DESC"]],
        nest: true,
        raw: true,
      },
    );
  }

  async getEmployeeProfile(emailFromToken, userIdFromToken) {
    console.log(
      `🔍 Profile Search: Email - ${emailFromToken}, UserID - ${userIdFromToken}`,
    );

    const employee = await this.employeeRepo.findByEmailOrUserId(
      emailFromToken,
      userIdFromToken,
      { raw: true },
    );

    if (!employee) {
      throw new AppError(
        "Database mein is email se koi employee nahi mila.",
        404,
      );
    }

    console.log("✅ FULL DATA FROM DB:", employee);

    return {
      ...employee,
      emp_code:
        employee.emp_code ||
        employee.empCode ||
        "EMP-" + employee.id.substring(0, 5).toUpperCase(),
    };
  }
}

module.exports = EmployeeService;
