const db = require('../../../common/db.config');
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const { myCache } = require('../middleware/authMiddleware');

// User Registration
const Registration = async (req, res) => {
    try {
        const {name, email, username, password, role} = req.body;
        // Check if user already exists
        const existingUser = await User.findOne({ where: { email: req.body.email } });
        if(existingUser){
            return res.status(400).json({ message: 'User already exists' });
        }
        const newUser = await User.create({name, email, username, password, role})
        res.status(201).json({ message: 'User registered successfully', user: newUser });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}
// user Profile
const Profile = async (req, res) => {
    try {
        // Safety check: Ensure request is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const userId = req.user.id;

        const user = await User.findByPk(userId, {
            attributes: { exclude: ['password'] }
        });

        // 1. Handle case where user is not found in DB
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 2. Success response
        return res.status(200).json(user);

    } catch (error) {
        console.error('Profile Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
// Change Password
const ChangePassword = async (req, res) => {
    try {
        
        const userId = req.user.id; 
        
       
        const { oldPassword, newPassword } = req.body;

        // Validation: Passwords aaye hain ya nahi
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: 'Both old and new passwords are required' });
        }

        // STEP 2: Database mein User dhoondhein
        const user = await User.findByPk(userId);

        // Check: User database mein hai ya delete ho gaya?
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // STEP 3: Purana Password Verify karein
        // Note: Make sure aapke User model mein validatePassword method ho
        const isMatch = await user.validatePassword(oldPassword);
        
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect old password' });
        }

        // STEP 4: Naya password update karein
        // Sequelize hooks (beforeSave) usually password ko hash kar dete hain via bcrypt
        // Agar hook nahi hai, to yahan hash karke dalein: await bcrypt.hash(newPassword, 10)
        user.password = newPassword; 
        
        await user.save(); // .update() ki jagah .save() hooks ko trigger karta hai (better approach)

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const updateProfile = async (req, res) => {
    try {
        
        const userId = req.user.id; 
        const { name, email, role } = req.body;

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update logic
        await user.update({ name, email, role });

        res.json({ 
            message: 'Profile updated successfully',
            user: { id: user.id, name: user.name, email: user.email } 
        });

    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// User Logout

const logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(400).json({ message: 'Token not provided' });
        }

        // Token ko decode karke userId nikalne ke liye
        const decoded = jwt.decode(token);
        
        if (!decoded || !decoded.id) {
            return res.status(400).json({ message: 'Invalid Token' });
        }

        const userId = decoded.id;

        // 1. Session Token Delete Karein (Redis ki jagah myCache use karein)
        const isDeleted = myCache.del(`auth_token:${userId}`);
        
        console.log(`Cache Delete Result for ID ${userId}:`, isDeleted); 

        // 2. Blacklist Logic (Optional for local memory, par agar karna hai toh aise hoga)
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

        if (expiresIn > 0) {
            // Redis ke set ki jagah myCache.set use karein
            myCache.set(`blacklist:${token}`, 'true', expiresIn);
        }

        res.json({ message: 'Logged out & Session cleared successfully' });

    } catch (error) {
        console.error('Logout Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};


module.exports = {
    Registration,
    Profile,
    ChangePassword,
    updateProfile,
    logout
};