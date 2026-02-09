const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. User table se record find karein
        const user = await db.User.findOne({ where: { email } });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 2. Password compare karein
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 3. Employee Master se profile fetch karein
        let employeeProfile = await db.EmployeeMaster.findOne({
            where: {
                [Op.or]: [
                    { user_id: user.id },
                    { email: user.email }
                ]
            }
        });

        let teamMembers = [];
        if (employeeProfile) {
            // Agar email se mila par user_id link nahi hai, toh link karein
            if (!employeeProfile.user_id) {
                await employeeProfile.update({ user_id: user.id });
            }

            // --- HIERARCHY LOGIC: supervisor_id use kiya gaya hai ---
            try {
                teamMembers = await db.EmployeeMaster.findAll({
                    where: { 
                        // Team members ka supervisor_id is employee ki ID honi chahiye
                        supervisor_id: employeeProfile.id 
                    },
                    attributes: ['id', 'emp_code', 'name', 'email', 'position']
                });
            } catch (teamErr) {
                console.error("❌ Team Fetch Error:", teamErr.message);
            }
            
            employeeProfile = employeeProfile.get({ plain: true });
        }

        // 4. JWT Token Generate karein
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '20h' }
        );

        // 5. Final User Data Structure (Frontend ke liye)
        const userData = {
            id: user.id,                       // User Table ID
            hrm_employee_id: employeeProfile ? employeeProfile.id : null, // Asli Supervisor ID
            name: user.name,
            email: user.email,
            role: user.role,
            position: employeeProfile ? employeeProfile.position : null,
            profile: employeeProfile,
            team: teamMembers,
            loginTime: new Date()
        };

        // 6. Cache Store
        myCache.set(`auth_token:${user.id}`, token, 72000);

        return res.json({ 
            success: true, 
            message: 'Login successful', 
            token, 
            user: userData 
        });

    } catch (err) {
        console.error('--- SERVER CRASH ERROR ---', err);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = {
    login
};