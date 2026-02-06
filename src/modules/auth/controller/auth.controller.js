const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user.model');
const EmployeeMaster = require('../../hrm/model/EmployeeMaster'); // Sahi path confirm karein
const { myCache } = require('../middleware/authMiddleware');

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. User find karein
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 2. Password check karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 3. Supervisor ka apna full data fetch karein
        let employeeProfile = null;
        let teamMembers = [];

        try {
            // Supervisor ki profile
            employeeProfile = await EmployeeMaster.findOne({ 
                where: { 
                    [Op.or]: [{ user_id: user.id }, { email: user.email }] 
                }
            });

            if (employeeProfile) {
                // Agar profile mili, toh uski ID ko as a 'reporting_manager_id' use karke team dhoondhein
                teamMembers = await EmployeeMaster.findAll({
                    where: { 
                        reporting_manager_id: user.id // Ya employeeProfile.id jo bhi aapke DB mein mapped ho
                    },
                    attributes: ['id', 'emp_code', 'first_name', 'last_name', 'position', 'profile_pc', 'department']
                });
                
                // Agar user_id missing tha toh update kar dein (Auto-link)
                if (!employeeProfile.user_id) {
                    await employeeProfile.update({ user_id: user.id });
                }
            }
        } catch (empErr) {
            console.error("Employee Table Error:", empErr.message);
        }

        // 4. Token Generate
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, position: employeeProfile?.position || 'N/A' },
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '20h' }
        );

        // 5. Final Response Object
        const userData = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            profile: employeeProfile, // Supervisor ki details
            team: teamMembers,         // Supervisor ki team ki list
            loginTime: new Date()
        };

        // 6. Cache and Send Response
        myCache.set(`auth_token:${user.id}`, token, 72000);

        return res.json({ 
            success: true, 
            message: 'Login successful', 
            token, 
            user: userData 
        });

    } catch (err) {
        console.error('--- SERVER ERROR ---', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error: ' + err.message 
        });
    }
}

module.exports = { login };