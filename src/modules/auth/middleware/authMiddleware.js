const jwt = require('jsonwebtoken');
const NodeCache = require("node-cache");

// Caching instance create karein (Standard TTL 24 hours rakha hai)
const myCache = new NodeCache({ stdTTL: 0, checkperiod: 0 }); // 0 = Unlimited (Jab tak server restart na ho)

// Fail-fast: never run without a configured JWT secret (no insecure fallback)
if (!process.env.JWT_SECRET) {
    throw new Error('❌ JWT_SECRET env variable is required and not set.');
}
const JWT_SECRET = process.env.JWT_SECRET;

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access Denied: No Token Provided" });
    }

    try {
        // 1. JWT Signature Verify karein
        const verified = jwt.verify(token, JWT_SECRET);

        // 2. Blacklist check (logout ke baad token reject ho)
        if (myCache.get(`blacklist:${token}`)) {
            return res.status(401).json({ message: "Session Expired or Logged Out. Please Login Again." });
        }

        // 3. Sab sahi hai
        req.user = verified;
        next();

    } catch (error) {
        console.error("Auth Error:", error);
        res.status(403).json({ message: "Invalid Token" });
    }
};

/**
 * RBAC: Allow only the given roles. Usage: authorizeRoles('ADMIN', 'HR')
 * verifyToken ke baad hi use karein (req.user set hona chahiye).
 */
const authorizeRoles = (...allowedRoles) => {
    const normalized = allowedRoles.map((r) => r.toUpperCase());
    return (req, res, next) => {
        const role = req.user && req.user.role ? req.user.role.toUpperCase() : null;
        if (!role || !normalized.includes(role)) {
            return res.status(403).json({ message: "Forbidden: insufficient permissions" });
        }
        next();
    };
};

// Exporting cache instance taaki login/logout routes mein bhi use ho sake
module.exports = { verifyToken, authorizeRoles, myCache };