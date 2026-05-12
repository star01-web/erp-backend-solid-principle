const EmployeeMaster = require("../model/EmployeeMaster.js");
const db = require("../../../common/index.db.js");
const { Op } = require("sequelize");
// const { createEmployeeMiddleware } = require('../middleware/createEmployee_mw.js');
const bcrypt = require("bcrypt");

const CreateEmployee = async (req, res) => {
  // Transaction start taaki dono table sync rahein
  const t = await db.sequelize.transaction();

  try {
    // 1. req.body se saara data extract karein
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
      role, // 'role' login table ke liye
      emp_code,
    } = req.body;

    // Validation (Basic check)
    if (!email || !password || !name || !location_id) {
      return res.status(400).json({
        message:
          "Zaroori fields missing hain (Email, Password, Name, Location).",
      });
    }

    // 2. Password handling: let the User model hook hash the password

    // Pre-check: Email/username/phone uniqueness to provide friendlier errors
    const existingUser = await db.User.findOne({
      where: {
        [Op.or]: [{ email: email }, { username: username || email }],
      },
    });

    if (existingUser) {
      await t.rollback();
      return res.status(409).json({
        message: "Email or username already in use.",
      });
    }

    if (phone) {
      const existingPhone = await db.EmployeeMaster.findOne({
        where: { phone },
      });
      if (existingPhone) {
        await t.rollback();
        return res.status(409).json({ message: "Phone already in use." });
      }
    }

    // 3. STEP 1: Pehle User Table mein entry (Login account banana)
    // Note: 'email' ko hi hum 'username' ki tarah use kar sakte hain ya alag field le sakte hain
    const newUser = await db.User.create(
      {
        name: name,
        email: email,
        username: username || email,
        password: password,
        role: role || "EMPLOYEE",
      },
      { transaction: t },
    );
    console.log("Naye User ki ID hai:", newUser.id);

    // 4. STEP 2: Employee Master Table mein entry
    // Yahan 'userId' mein hum 'newUser.id' daalenge jo abhi-abhi generate hui hai
    const newEmployee = await db.EmployeeMaster.create(
      {
        emp_code,
        name: name,
        email: email,
        phone: phone,
        address: address,
        department: department,
        position: position, // 'Site Supervisor', 'Sales', etc.
        monthly_wages: monthly_wages,
        location_id: location_id,
        supervisor_id: supervisor_id || null,
        userId: newUser.id, // <--- YEH HAI VO LINK (Foreign Key)
        isActive: true,
      },
      { transaction: t },
    );

    // Sab sahi raha toh commit karein
    await t.commit();

    return res.status(201).json({
      status: "Success",
      message: "User Login aur Employee Profile dono ban gaye hain.",
      data: {
        loginId: newUser.id,
        employeeId: newEmployee.id,
      },
    });
  } catch (error) {
    // Agar kahin bhi galti hui toh transaction cancel (Rollback)
    await t.rollback();
    console.error("Error in Registration:", error);

    let errorMessage = error.message;
    if (
      error.name === "SequelizeUniqueConstraintError" ||
      error.name === "SequelizeValidationError"
    ) {
      errorMessage = error.errors.map((e) => e.message).join(", ");
      return res.status(400).json({ message: errorMessage });
    }

    return res.status(500).json({
      message: "Internal Server Error",
      error: errorMessage,
    });
  }
};

const updateEmployee = async (req, res) => {
  const t = await db.sequelize.transaction();

  try {
    const { id } = req.params; // Ye employee_master_id hai

    const {
      name,
      phone,
      role,
      address,
      location_id,
      supervisor_id, // Yahan supervisor_id use ho raha hai
      department,
      position,
      monthly_wages,
      isActive,
    } = req.body;

    const employee = await db.EmployeeMaster.findByPk(id);

    if (!employee) {
      await t.rollback();
      return res.status(404).json({ message: "Employee nahi mila." });
    }

    // 1. Employee Table Update
    await employee.update(
      {
        name,
        phone,
        address,
        location_id: location_id || employee.location_id,
        supervisor_id: supervisor_id || employee.supervisor_id, // Updated key
        department,
        position,
        monthly_wages,
        isActive,
      },
      { transaction: t },
    );

    // 2. User Table Update (Role ke liye)
    // Aapke data mein userId login mapping ke liye hai
    if (role && employee.userId) {
      await db.User.update(
        { role: role },
        { where: { id: employee.userId }, transaction: t },
      );
    }

    await t.commit();

    return res.status(200).json({
      status: "Success",
      message: "Employee data aur Supervisor ID update ho gayi.",
      data: employee,
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error("Update Error:", error);
    return res
      .status(500)
      .json({ message: "Update fail hua.", error: error.message });
  }
};

const getallEmployee = async (req, res) => {
  try {
    const employees = await db.EmployeeMaster.findAll({
      attributes: [
        "employee_master_id",
        "emp_code",
        "name",
        "email",
        "phone",
        "department",
        "position",
        "monthly_wages",
        "location_id",
        "reporting_manager_id",
      ],

      include: [
        {
          model: db.User,
          as: "loginDetails",
          // Agar 'status' column nahi hai, toh use yahan se hata dein
          attributes: ["username", "role"],
        },
        {
          model: db.OfficeLocation,
          as: "location",
          attributes: ["id", "locationName"],
        },
        {
          model: db.EmployeeMaster,
          as: "supervisor",
          attributes: ["employee_master_id", "name"],
        },
      ],

      order: [["createdAt", "DESC"]],
      nest: true,
      raw: true,
    });

    res.status(200).json({
      success: true,
      employees: employees,
    });
  } catch (error) {
    console.error("❌ Get All Employees Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      details: error.message, // Isse aapko exact missing column ka pata chal jayega
    });
  }
};

const getEmployeeProfile = async (req, res) => {
  try {
    // Token se email aur id nikalna
    const emailFromToken = req.user.email;
    const userIdFromToken = req.user.id;

    console.log(
      `🔍 Profile Search: Email - ${emailFromToken}, UserID - ${userIdFromToken}`,
    );

    // Email se search karna sabse safe hai kyunki console mein email dikh raha hai
    const employee = await db.EmployeeMaster.findOne({
      where: {
        [Op.or]: [
          { email: emailFromToken },
          { user_id: userIdFromToken },
          { userId: userIdFromToken },
        ],
      },
      // attributes ko abhi touch mat kijiye, saara data aane dijiye
      raw: true,
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Database mein is email se koi employee nahi mila.",
      });
    }

    // --- DEBUG LOG ---
    console.log("✅ FULL DATA FROM DB:", employee);

    // Frontend ko saaf-suthra data bhejna
    return res.status(200).json({
      success: true,
      data: {
        ...employee,
        // Fallback: Agar emp_code na mile toh hrm_employee_id ka ek part dikha dein
        emp_code:
          employee.emp_code ||
          employee.empCode ||
          "EMP-" + employee.id.substring(0, 5).toUpperCase(),
      },
    });
  } catch (error) {
    console.error("❌ Profile Controller Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const bulkCreateEmployees = async (req, res) => {
  // Transaction start taaki sabhi records sync rahein
  const t = await db.sequelize.transaction();

  try {
    const employeesData = req.body; // Yahan hume ek array of objects milega

    // 1. Validation: Check karein ki data array format mein hai ya nahi
    if (!Array.isArray(employeesData) || employeesData.length === 0) {
      return res.status(400).json({
        message: "Data ek valid Array of Objects format mein hona chahiye.",
      });
    }

    const createdRecords = [];

    // 2. Loop through each employee object
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

      // Basic validation har ek item ke liye
      if (!email || !password || !name || !location_id) {
        throw new Error(
          `'${name || email || "Ek employee"}' ka data in-complete hai. Email, Password, Name aur Location zaroori hain.`,
        );
      }

      // Security: Let User model hash the password via hooks (avoid double-hash)

      // Pre-checks for uniqueness to fail fast with clear messages
      const conflictUser = await db.User.findOne({
        where: { [Op.or]: [{ email }, { username: username || email }] },
        transaction: t,
      });
      if (conflictUser) {
        throw new Error(`User with email/username '${email}' already exists`);
      }
      if (phone) {
        const conflictPhone = await db.EmployeeMaster.findOne({
          where: { phone },
          transaction: t,
        });
        if (conflictPhone) {
          throw new Error(`Phone '${phone}' already in use`);
        }
      }

      // 3. STEP 1: User Table mein entry (Login account)
      const newUser = await db.User.create(
        {
          name: name,
          email: email,
          username: username || email,
          password: password, // model hook will hash
          role: role || "EMPLOYEE",
        },
        { transaction: t },
      );

      // 4. STEP 2: Employee Master Table mein entry
      const newEmployee = await db.EmployeeMaster.create(
        {
          emp_code: emp_code,
          name: name,
          email: email,
          phone: phone,
          address: address,
          department: department,
          position: position,
          monthly_wages: monthly_wages,
          location_id: location_id,
          supervisor_id: supervisor_id || null,
          userId: newUser.id, // User table se mili ID link kar di
          isActive: true,
        },
        { transaction: t },
      );

      // Response ke liye record save kar lete hain
      createdRecords.push({
        emp_code: newEmployee.emp_code,
        loginId: newUser.id,
        employee_master_id: newEmployee.id, // Fixed: usually it's just .id in Sequelize unless explicitly named employee_master_id
      });
    }

    // 5. Agar loop successfully poora ho gaya, toh Database me save (commit) kar do
    await t.commit();

    return res.status(201).json({
      status: "Success",
      message: `${createdRecords.length} Employees successfully create ho gaye hain.`,
      data: createdRecords,
    });
  } catch (error) {
    // Agar loop me kahin bhi error aayi, toh sab kuch wapas (Rollback)
    await t.rollback();

    // Better Error Logging: Check if it's a Sequelize Validation/Unique error
    let errorMessage = error.message;
    if (
      error.name === "SequelizeUniqueConstraintError" ||
      error.name === "SequelizeValidationError"
    ) {
      errorMessage = error.errors.map((e) => e.message).join(", ");
    }

    console.error("Error in Bulk Registration:", errorMessage);

    return res.status(500).json({
      status: "Failed",
      message:
        "Bulk Insert fail hua. Koi bhi record database me save nahi hua.",
      error: errorMessage, // Now the frontend will see EXACTLY what failed (e.g., "email must be unique")
    });
  }
};
module.exports = {
  CreateEmployee,
  updateEmployee,
  getallEmployee,
  getEmployeeProfile,
  bulkCreateEmployees,
};
