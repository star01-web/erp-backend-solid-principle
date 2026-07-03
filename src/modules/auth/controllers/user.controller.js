const AppError = require("../../../common/AppError");

/**
 * HTTP layer for user account operations. Reproduces the exact { message }
 * response bodies of the original controller; logic lives in UserService.
 */
class UserController {
  constructor({ userService }) {
    this.userService = userService;
  }

  Registration = async (req, res) => {
    try {
      const { name, email, username, password, role } = req.body;
      const user = await this.userService.register({
        name,
        email,
        username,
        password,
        role,
      });
      return res
        .status(201)
        .json({ message: "User registered successfully", user });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Registration Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  Profile = async (req, res) => {
    try {
      // Safety check: Ensure request is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await this.userService.getProfile(req.user.id);
      return res.status(200).json(user);
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Profile Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  ChangePassword = async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      await this.userService.changePassword(
        req.user.id,
        oldPassword,
        newPassword,
      );
      return res.json({ message: "Password changed successfully" });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Change Password Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  updateProfile = async (req, res) => {
    try {
      const { name, email } = req.body;
      const user = await this.userService.updateProfile(req.user.id, {
        name,
        email,
      });
      return res.json({ message: "Profile updated successfully", user });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Update Profile Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  logout = async (req, res) => {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      this.userService.logout(token);
      return res.json({ message: "Logged out & Session cleared successfully" });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Logout Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };
}

module.exports = UserController;
