/**
 * Operational error carrying an HTTP status code. Services throw these for
 * expected failures (validation, not-found, conflicts); the global error
 * handler in app.js maps `statusCode` -> res.status and `message` -> body.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.status = statusCode; // app.js reads err.status || err.statusCode
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
