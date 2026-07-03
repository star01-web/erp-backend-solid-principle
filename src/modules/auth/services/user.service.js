const jwt = require("jsonwebtoken");
const AppError = require("../../../common/AppError");

/**
 * User account business logic (registration, profile, password, logout).
 */
class UserService {
  constructor({ userRepository, cache }) {
    this.userRepository = userRepository;
    this.cache = cache;
  }

  async register({ name, email, username, password, role }) {
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new AppError("User already exists", 400);
    }
    // User model hook hashes the password
    return this.userRepository.create({ name, email, username, password, role });
  }

  async getProfile(userId) {
    const user = await this.userRepository.findById(userId, {
      attributes: { exclude: ["password"] },
    });
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return user;
  }

  async changePassword(userId, oldPassword, newPassword) {
    if (!oldPassword || !newPassword) {
      throw new AppError("Both old and new passwords are required", 400);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const isMatch = await user.validPassword(oldPassword);
    if (!isMatch) {
      throw new AppError("Incorrect old password", 400);
    }

    user.password = newPassword;
    await user.save(); // beforeUpdate hook re-hashes
  }

  async updateProfile(userId, { name, email }) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    // Only self-editable fields. `role` is deliberately excluded so this
    // endpoint cannot be used for privilege escalation.
    await user.update({ name, email });
    return { id: user.id, name: user.name, email: user.email };
  }

  /**
   * Clears the session cache entry and blacklists the token until it expires.
   */
  logout(token) {
    if (!token) {
      throw new AppError("Token not provided", 400);
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
      throw new AppError("Invalid Token", 400);
    }

    const userId = decoded.id;
    const isDeleted = this.cache.del(`auth_token:${userId}`);
    console.log(`Cache Delete Result for ID ${userId}:`, isDeleted);

    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    if (expiresIn > 0) {
      this.cache.set(`blacklist:${token}`, "true", expiresIn);
    }
  }
}

module.exports = UserService;
