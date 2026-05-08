const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const db = require("../../../common/index.db");
const { myCache } = require("../middleware/authMiddleware");

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. User find karein
    const user = await db.User.findOne({ where: { email } });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    // 2. Password check
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    // 3. Employee Profile Fetch
    let employeeProfile = await db.EmployeeMaster.findOne({
      where: {
        [Op.or]: [{ user_id: user.id }, { email: user.email }],
      },
    });

    let teamMembers = [];
    if (employeeProfile) {
      // Email se mila par user_id link nahi hai, toh link karein
      if (!employeeProfile.user_id) {
        await employeeProfile.update({ user_id: user.id });
      }

      // Team members fetch karein
      try {
        teamMembers = await db.EmployeeMaster.findAll({
          where: { supervisor_id: employeeProfile.id },
          attributes: [
            "id",
            "emp_code",
            "name",
            "phone",
            "address",
            "email",
            "department",
            "position",
          ],
        });
      } catch (teamErr) {
        console.error("❌ Team Fetch Error:", teamErr.message);
      }

      employeeProfile = employeeProfile.get({ plain: true });
    }

    // 4. JWT Token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        hrm_employee_id: employeeProfile ? employeeProfile.id : null,
      },
      process.env.JWT_SECRET || "your_secret_key",
      { expiresIn: "24h" },
    );

    // --- TIMEZONE FIX FOR LOGIN TIME ---
    const loginTimeIST = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // 5. Final Data Structure
    const userData = {
      id: user.id,
      hrm_employee_id: employeeProfile ? employeeProfile.id : null,
      name: user.name,
      email: user.email,
      role: user.role,
      position: employeeProfile ? employeeProfile.position : null,
      profile: employeeProfile, // Isme ab pura data (Phone, Dept, etc.) milega
      team: teamMembers,
      loginTime: loginTimeIST, // Ab ye frontend par sahi dikhega
    };

    // 6. Cache Store
    myCache.set(`auth_token:${user.id}`, token, 72000);

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: userData,
    });
  } catch (err) {
    console.error("--- LOGIN ERROR ---", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { login };
