/**
 * Composition root for the auth module. Constructs the dependency graph
 * (repository -> service -> controller) and injects collaborators, so no inner
 * layer depends on the Sequelize singleton or `new`s its own dependencies.
 */
const db = require("../../common/index.db");
const BaseRepository = require("../../common/BaseRepository");
const { myCache } = require("./middleware/authMiddleware");

const UserRepository = require("./repositories/user.repository");
const AuthService = require("./services/auth.service");
const UserService = require("./services/user.service");
const AuthController = require("./controllers/auth.controller");
const UserController = require("./controllers/user.controller");

// Repositories (data access)
const userRepository = new UserRepository(db.User);
const employeeRepository = new BaseRepository(db.EmployeeMaster);

// Services (business logic) — collaborators injected
const authService = new AuthService({
  userRepository,
  employeeRepository,
  cache: myCache,
  jwtSecret: process.env.JWT_SECRET,
});
const userService = new UserService({ userRepository, cache: myCache });

// Controllers (HTTP)
const authController = new AuthController({ authService });
const userController = new UserController({ userService });

module.exports = { authController, userController };
