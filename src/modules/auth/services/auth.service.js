const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const AppError = require("../../../common/AppError");

const TEAM_ATTRIBUTES = [
  "id",
  "emp_code",
  "name",
  "phone",
  "address",
  "email",
  "department",
  "position",
];

const TOKEN_TTL_SECONDS = 2592000; // 30 days

/**
 * Login business logic. Depends only on injected repositories + cache + secret,
 * never on the Sequelize singleton directly (Dependency Inversion).
 */
class AuthService {
  constructor({ userRepository, employeeRepository, cache, jwtSecret }) {
    this.userRepository = userRepository;
    this.employeeRepository = employeeRepository;
    this.cache = cache;
    this.jwtSecret = jwtSecret;
  }

  /**
   * @returns {Promise<{token: string, user: object}>}
   * @throws {AppError} 401 on invalid credentials
   */
  async login(email, password) {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new AppError("Invalid email or password", 401);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError("Invalid email or password", 401);
    }

    let employeeProfile = await this.employeeRepository.findOne({
      [Op.or]: [{ user_id: user.id }, { email: user.email }],
    });

    let teamMembers = [];
    if (employeeProfile) {
      // Email se mila par user_id link nahi hai, toh link karein
      if (!employeeProfile.user_id) {
        await employeeProfile.update({ user_id: user.id });
      }

      // Team members fetch karein
      try {
        teamMembers = await this.employeeRepository.findAll(
          { supervisor_id: employeeProfile.id },
          { attributes: TEAM_ATTRIBUTES },
        );
      } catch (teamErr) {
        console.error("❌ Team Fetch Error:", teamErr.message);
      }

      employeeProfile = employeeProfile.get({ plain: true });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        hrm_employee_id: employeeProfile ? employeeProfile.id : null,
      },
      this.jwtSecret,
      { expiresIn: "30d" },
    );

    // --- TIMEZONE FIX FOR LOGIN TIME ---
    const loginTimeIST = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const user_data = {
      id: user.id,
      hrm_employee_id: employeeProfile ? employeeProfile.id : null,
      name: user.name,
      email: user.email,
      role: user.role,
      position: employeeProfile ? employeeProfile.position : null,
      profile: employeeProfile,
      team: teamMembers,
      loginTime: loginTimeIST,
    };

    // Cache Store (30 days)
    this.cache.set(`auth_token:${user.id}`, token, TOKEN_TTL_SECONDS);

    return { token, user: user_data };
  }
}

module.exports = AuthService;
