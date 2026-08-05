const Redis = require("ioredis");

/**
 * Singleton Redis Client for High-Performance Caching & Distributed Locking.
 * Memory Cap Strategy: 30 MB maxmemory target.
 * Rule A: 2-Hour Inactivity Auto-Eviction (Sliding Window on Hit).
 * Rule B: 24-Hour Max TTL Cap & Daily Scheduled Maintenance Flush.
 * Fail-Safe: All operations catch errors and return null to fallback to Direct DB.
 */
class RedisClientManager {
  constructor() {
    this.client = null;
    this.isAlive = false;
    this.SLIDING_IDLE_TTL = 7200; // 2 Hours in seconds
    this.MAX_HARD_TTL = 86400; // 24 Hours in seconds
    this.init();
  }

  init() {
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST || "127.0.0.1";
    const redisPort = Number(process.env.REDIS_PORT) || 6379;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    const options = {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Retry delay capped at 3 seconds to avoid blocking Node event loop
        return Math.min(times * 200, 3000);
      },
      lazyConnect: false,
    };

    if (redisUrl) {
      this.client = new Redis(redisUrl, options);
    } else {
      this.client = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        ...options,
      });
    }

    this.client.on("connect", () => {
      this.isAlive = true;
      console.log("⚡ Redis Client connected successfully.");
      this.configureMemorySettings();
    });

    this.client.on("error", (err) => {
      this.isAlive = false;
      console.warn("⚠️ Redis Client Warning/Error:", err.message);
    });

    this.start24hMaintenanceJob();
  }

  /** Ensure server memory policy stays capped at 30mb with allkeys-lru */
  async configureMemorySettings() {
    try {
      if (this.isAlive) {
        await this.client.config("SET", "maxmemory", "30mb").catch(() => {});
        await this.client.config("SET", "maxmemory-policy", "allkeys-lru").catch(() => {});
      }
    } catch {
      // Configuration commands might be restricted on cloud Redis (e.g. Upstash)
    }
  }

  /**
   * Get cached data with 2-Hour Sliding Window Idle Eviction.
   * On Hit: Automatically executes EXPIRE key 7200 to refresh the 2-hour idle window.
   */
  async getCache(key, resetIdleOnHit = true) {
    if (!this.isAlive || !this.client) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;

      // Sliding Window Rule: Reset 2-hour idle timer on access
      if (resetIdleOnHit) {
        this.client.expire(key, this.SLIDING_IDLE_TTL).catch(() => {});
      }

      return JSON.parse(data);
    } catch (err) {
      return null; // Fallback cleanly to DB
    }
  }

  /**
   * Set cached data with 2-Hour default TTL and 24-Hour Absolute Max Cap.
   */
  async setCache(key, value, ttlSeconds = this.SLIDING_IDLE_TTL) {
    if (!this.isAlive || !this.client) return false;
    try {
      // Rule B: Cap max TTL to 24 Hours (86400s)
      const effectiveTtl = Math.min(Math.max(1, ttlSeconds), this.MAX_HARD_TTL);
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, "EX", effectiveTtl);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Delete keys matching pattern (wildcard cache purge) */
  async delPattern(pattern) {
    if (!this.isAlive || !this.client) return false;
    try {
      const stream = this.client.scanStream({ match: pattern, count: 100 });
      stream.on("data", (keys) => {
        if (keys.length) {
          const pipeline = this.client.pipeline();
          keys.forEach((key) => pipeline.del(key));
          pipeline.exec().catch(() => {});
        }
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Single key deletion */
  async delKey(key) {
    if (!this.isAlive || !this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Distributed Mutex Lock (NX = Only set if not exists, PX = milliseconds TTL) */
  async acquireLock(lockKey, lockValue, ttlMs = 5000) {
    if (!this.isAlive || !this.client) return true; // Fallback to DB transaction lock if Redis offline
    try {
      const result = await this.client.set(lockKey, lockValue, "PX", ttlMs, "NX");
      return result === "OK";
    } catch (err) {
      return true; // Fallback to DB transaction lock
    }
  }

  /** Release Distributed Mutex Lock */
  async releaseLock(lockKey, lockValue) {
    if (!this.isAlive || !this.client) return true;
    try {
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.client.eval(luaScript, 1, lockKey, lockValue);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Daily 24-Hour Maintenance Purge Routine */
  start24hMaintenanceJob() {
    setInterval(() => {
      if (this.isAlive && this.client) {
        console.log("🧹 Running 24-Hour Scheduled Redis Maintenance Purge...");
        this.delPattern("cache:*").catch(() => {});
      }
    }, 86400 * 1000); // Every 24 Hours
  }
}

const redisClient = new RedisClientManager();
module.exports = redisClient;
