const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const db = require('../../../common/index.db'); // Sahi path check karein (User, EmployeeMaster yahan se aayenge)
const { myCache } = require('../middleware/authMiddleware');

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. User table se primary record find karein
        const user = await db.User.findOne({ where: { email } });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 2. Password compare karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 3. Employee Master se profile data fetch karein
        let employeeProfile = null;
        try {
            // Priority 1: user_id se search
            // Priority 2: email se search (Fallback)
            employeeProfile = await db.EmployeeMaster.findOne({
                where: {
                    [Op.or]: [
                        { user_id: user.id },
                        { email: user.email }
                    ]
                }
            });

            if (employeeProfile) {
                // Agar email se mila lekin user_id linked nahi hai, toh link kar dein
                if (!employeeProfile.user_id) {
                    await employeeProfile.update({ user_id: user.id });
                    console.log(`✅ Linked user_id for: ${user.email}`);
                }
                // Sequelize instance ko plain JSON mein badlein
                employeeProfile = employeeProfile.get({ plain: true });
            }
        } catch (err) {
            console.error("❌ EmployeeMaster Fetch Error:", err.message);
        }

        // 4. Supervisor ke under ki Team fetch karein (Agar profile mili hai)
        let teamMembers = [];
        if (employeeProfile) {
            try {
                teamMembers = await db.EmployeeMaster.findAll({
                    where: { 
                        // Is column ka naam apne DB mein check karein (reporting_manager_id / supervisor_id)
                        reporting_manager_id: user.id 
                    },
                    attributes: ['id', 'emp_code', 'first_name', 'last_name', 'position', 'email']
                });
            } catch (teamErr) {
                console.error("❌ Team Fetch Error:", teamErr.message);
            }
        }

        // 5. JWT Token Generate karein
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                position: employeeProfile?.position || 'N/A' 
            },
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '20h' }
        );

        // 6. Final User Data Structure
        const userData = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            position: employeeProfile?.position || 'N/A',
            profile: employeeProfile, // Ab yahan data aayega
            team: teamMembers,         // Supervisor ki team list
            loginTime: new Date()
        };

        // 7. Cache Store
        myCache.set(`auth_token:${user.id}`, token, 72000);

        // Success Response
        return res.json({ 
            success: true, 
            message: 'Login successful', 
            token, 
            user: userData 
        });

    } catch (err) {
        console.error('--- SERVER CRASH ERROR ---', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error: ' + err.message 
        });
    }
};

module.exports = { login };