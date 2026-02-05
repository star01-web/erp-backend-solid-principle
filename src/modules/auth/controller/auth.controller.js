const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const { myCache } = require('../middleware/authMiddleware'); // Middleware se cache import karein

const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password) {
            const error = new Error('Email and password are required');
            error.status = 400;
            throw error;
        }

        if (typeof email !== 'string' || typeof password !== 'string') {
            const error = new Error('Email and password must be strings');
            error.status = 400;
            throw error;
        }
        
        // 1. User find karein
        const user = await User.findOne({ where: { email } });
        if (!user) {
            const error = new Error('Invalid email or password');
            error.status = 401;
            throw error;
        }

        // 2. Password check karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            const error = new Error('Invalid email or password');
            error.status = 401;
            throw error;
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
        console.error('Login Error:', err.message);
        next(err);
    }
}

module.exports = {
    login, 
};