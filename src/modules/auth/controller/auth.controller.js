const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const { myCache } = require('../middleware/authMiddleware'); // Middleware se cache import karein

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // 1. User find karein
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email' });
        }

        // 2. Password check karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        // 3. Token Generate
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '20h' }
        );

        const userData = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            loginTime: new Date()
        };

        // 4. NODE-CACHE mein token store karein (Redis ki jagah)
        // Key: auth_token:ID, Time: 20 hours (72000 seconds)
        myCache.set(`auth_token:${user.id}`, token, 72000);

        res.json({ message: 'Login successful', token, user: userData });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ message: err.message }); 
    }
}

module.exports = {
    login, 
};