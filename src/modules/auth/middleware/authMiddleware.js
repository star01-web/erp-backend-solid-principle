const jwt = require('jsonwebtoken');
const redisClient = require('../../../common/ridis.config');

const verifyToken = async (req, res, next) => {

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access Denied: No Token Provided" });
    }

    try {
        // 2. Pehle JWT Signature Verify karein
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');

        // 3. REDIS CHECK: Kya ye token Redis mein active hai?
        // (Maan lete hain aapne login ke time key "auth_token:USER_ID" naam se save ki thi)
        const redisKey = `auth_token:${verified.id}`;
        
        const cachedToken = await redisClient.get(redisKey);

        // Agar Redis mein token nahi hai, ya match nahi kar raha (User Logout ho chuka hai)
        if (!cachedToken || cachedToken !== token) {
            return res.status(401).json({ message: "Session Expired. Please Login Again." });
        }

        // 4. Sab sahi hai, User data set karein
        req.user = verified;
        next();

    } catch (error) {
        console.error("Auth Error:", error);
        res.status(403).json({ message: "Invalid Token" });
    }
};

module.exports = verifyToken;