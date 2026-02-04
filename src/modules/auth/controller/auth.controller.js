const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const redisClient = require('../../../common/ridis.config');

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email' });
        }
        // console.log("Input Password:", password);
        const isPasswordValid = await bcrypt.compare(password, user.password);
        // console.log("Password Valid Match Result:", isPasswordValid);

        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        // 3. Token Generate
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, },
            process.env.JWT_SECRET,
            { expiresIn: '20h' }
        );

        const userData = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            loginTime: new Date()
        };

        // 4. Redis mein token store karein
        await redisClient.setEx(
            `auth_token:${user.id}`, 
            23 * 60 * 60,            
            token                    
        );

        res.json({ message: 'Login successful', token, user: userData });

    } catch (err) {
        // The error variable is defined HERE as 'err'
        console.error('Login Error:', err);
        res.status(500).json({ message: err.message }); 
    }
}

module.exports = {
    login, 
};