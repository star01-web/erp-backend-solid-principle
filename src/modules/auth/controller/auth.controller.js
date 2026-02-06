const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const { myCache } = require('../middleware/authMiddleware'); // Middleware se cache import karein
const EmployeeMaster = require('../models/user.model'); // Employee Master model import karein

const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        // 1. User find karein aur EmployeeMaster se 'position' fetch karein
        // Yahan hum Sequelize ka 'include' use kar rahe hain
        const user = await User.findOne({ 
            where: { email },
            include: [{
                model: EmployeeMaster,
                attributes: ['position'] // Sirf position field chahiye
            }]
        });

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

        // EmployeeMaster se position extract karein (association name ke mutabiq)
        // Agar association ka naam 'EmployeeDetail' hai toh:
        const userPosition = user.EmployeeMaster ? user.EmployeeMaster.position : 'N/A';

        // 3. Token Generate (Payload mein position bhi dal sakte hain)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, position: userPosition },
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '20h' }
        );

        const userData = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            position: userPosition, // <--- Employee Master se aayi hui position
            loginTime: new Date()
        };

        // 4. Cache mein store karein
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