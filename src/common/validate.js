/**
 * Express middleware factory that validates a request part against a zod
 * schema. Keeps validation in its own layer (Single Responsibility) instead
 * of scattered `if (!x)` checks inside controllers.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {Object} [options]
 * @param {'body'|'query'|'params'} [options.source='body'] - request part to validate
 * @param {number} [options.status=400] - status code on failure
 * @param {boolean} [options.withSuccess=false] - include `success:false` in the
 *        error body so each module keeps its existing error shape.
 *
 * On success the parsed (and coerced) value is written back to req[source].
 * On failure the FIRST issue's message is returned, letting schemas reproduce
 * the exact Hinglish messages the manual checks used.
 */
const validate =
  (schema, { source = "body", status = 400, withSuccess = false } = {}) =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const message = result.error.issues[0]?.message || "Invalid request data";
      const body = withSuccess ? { success: false, message } : { message };
      return res.status(status).json(body);
    }

    // query/params getters can be read-only on some setups; assign defensively
    try {
      req[source] = result.data;
    } catch (_) {
      /* leave original if not assignable */
    }
    next();
  };

module.exports = validate;
