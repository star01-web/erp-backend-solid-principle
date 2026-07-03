const AppError = require("../../../common/AppError");

/**
 * HTTP layer for authentication. Owns request parsing and the exact response
 * shapes; all logic lives in AuthService.
 */
class AuthController {
  constructor({ authService }) {
    this.authService = authService;
  }

  login = async (req, res) => {
    try {
      const { email, password } = req.body;
      const { token, user } = await this.authService.login(email, password);
      return res.json({
        success: true,
        message: "Login successful",
        token,
        user,
      });
    } catch (err) {
      if (err instanceof AppError) {
        return res
          .status(err.statusCode)
          .json({ success: false, message: err.message });
      }
      console.error("--- LOGIN ERROR ---", err);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  };
}

module.exports = AuthController;
