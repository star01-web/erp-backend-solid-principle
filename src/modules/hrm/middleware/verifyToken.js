const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ message: "Access Denied: No Token Provided" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Token ka sara data (id, email, role) req.user mein aa jayega
        next();
    } catch (error) {
        return res.status(403).json({ message: "Invalid or Expired Token" });
    }
};

module.exports = {verifyToken};