const crypto = require('crypto');

const internalAuth = (req, res, next) => {
    try {
        const incomingKey = req.headers['x-internal-key'];
        const storedHash = process.env.INTERNAL_API_KEY_HASH;

        if (!incomingKey) {
            return res.status(401).json({ 
                message: "Unauthorized: API Key is missing" 
            });
        }

        // 1. Incoming plain key ko SHA-256 se hash karein
        const incomingHash = crypto
            .createHash('sha256') 
            .update(incomingKey) 
            .digest('hex');

        // 2. Dono hashes ko compare karein
        // Note: Timing attacks se bachne ke liye crypto.timingSafeEqual use karna best hai
        const storedHashBuffer = Buffer.from(storedHash);
        const incomingHashBuffer = Buffer.from(incomingHash);

        if (storedHashBuffer.length !== incomingHashBuffer.length || 
            !crypto.timingSafeEqual(storedHashBuffer, incomingHashBuffer)) {
            return res.status(403).json({ 
                message: "Forbidden: Frontend-Backend Handshake Failed" 
            });
        }

        next();
    } catch (error) {
        console.error("Auth Hash Error:", error);
        res.status(500).json({ message: "Internal Server Error during validation" });
    }
};

module.exports = internalAuth;