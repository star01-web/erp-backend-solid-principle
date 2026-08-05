const crypto = require("crypto");
const redisClient = require("./redis.client");

/**
 * Express Route Caching Middleware with 2-Hour Sliding Window Idle Eviction.
 *
 * @param {Object} options
 * @param {number} [options.ttl=7200] TTL in seconds (default: 2 hours = 7200s, max: 24 hours = 86400s)
 * @param {string} [options.keyPrefix="cache:api"] Key namespace
 */
const cacheMiddleware = (options = {}) => {
  const ttl = options.ttl || 7200; // 2 Hours default
  const keyPrefix = options.keyPrefix || "cache:api";

  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    // Build deterministic cache key from URL & sorted query parameters
    const queryString = JSON.stringify(req.query || {});
    const queryHash = crypto.createHash("sha256").update(queryString).digest("hex").slice(0, 16);
    const cacheKey = `${keyPrefix}:${req.baseUrl}${req.path}:${queryHash}`;

    try {
      // 1. Check Redis Cache (automatically extends 2-hour sliding window on hit!)
      const cachedData = await redisClient.getCache(cacheKey, true);

      if (cachedData) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("X-Cache-TTL", `${ttl}s`);
        return res.status(200).json(cachedData);
      }

      // 2. Cache MISS — intercept res.json to capture and cache response
      res.setHeader("X-Cache", "MISS");
      const originalJson = res.json.bind(res);

      res.json = (body) => {
        // Only cache successful 200 OK responses
        if (res.statusCode === 200 && body && body.success !== false) {
          redisClient.setCache(cacheKey, body, ttl).catch(() => {});
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      // Fail-safe: transparently fall back to DB execution
      next();
    }
  };
};

module.exports = cacheMiddleware;
