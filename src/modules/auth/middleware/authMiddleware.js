const jwt = require('jsonwebtoken');
const NodeCache = require("node-cache");

// Caching instance create karein (Standard TTL 24 hours rakha hai)
const myCache = new NodeCache({ stdTTL: 86400, checkperiod: 120 });

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access Denied: No Token Provided" });
    }

    try {
        // 1. JWT Signature Verify karein
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');

        // 2. LOCAL CACHE CHECK: Redis ki jagah yahan check hoga
        const cacheKey = `auth_token:${verified.id}`;
        const cachedToken = myCache.get(cacheKey);

        // Agar cache mein token nahi hai, ya match nahi kar raha
        if (!cachedToken || cachedToken !== token) {
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

// Exporting cache instance taaki login/logout routes mein bhi use ho sake
module.exports = { verifyToken, myCache };