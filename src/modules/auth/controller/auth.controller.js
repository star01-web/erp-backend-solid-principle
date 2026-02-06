const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const EmployeeMaster = require('../../hrm/model/EmployeeMaster'); // ✅ Sahi path check karein
const { myCache } = require('../middleware/authMiddleware');

const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // 1. User find karein (Bina include ke, crash se bachne ke liye)
        const user = await User.findOne({ where: { email } });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 2. Password check karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 3. Employee Master se Position alag se fetch karein (Safe Method)
        let userPosition = 'N/A';
        try {
            const empDetail = await EmployeeMaster.findOne({ 
                where: { user_id: user.id } // DB mein check karein column 'userId' hai ya 'user_id'
            });
            if (empDetail) {
                userPosition = empDetail.position;
            }
        } catch (empErr) {
            console.error("EmployeeMaster Fetch Error:", empErr.message);
            // Agar employee table mein error aaye tab bhi login na ruke
        }

        // 4. Token Generate
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
            position: userPosition,
            loginTime: new Date()
        };

        // 5. Cache store
        myCache.set(`auth_token:${user.id}`, token, 72000);

        return res.json({ success: true, message: 'Login successful', token, user: userData });

    } catch (err) {
        console.error('--- SERVER CRASH ERROR ---');
        console.error(err); // Isse terminal mein asli wajah dikhegi
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error: ' + err.message 
        });
    }
}

module.exports = { login };