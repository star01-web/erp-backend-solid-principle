const EmployeeMaster = require('../model/EmployeeMaster.js');
const db = require('../../../common/index.db.js');
const { Op } = require('sequelize');
// const { createEmployeeMiddleware } = require('../middleware/createEmployee_mw.js');
// const bcrypt = require('bcrypt');

const CreateEmployee = async (req, res) => {
    // Transaction start taaki dono table sync rahein
    const t = await db.sequelize.transaction();

    try {
        // 1. req.body se saara data extract karein
        const { 
            name, email, password, phone, address,username, 
            department, position, monthly_wages, 
            location_id, supervisor_id, role, // 'role' login table ke liye
            emp_code
        } = req.body;

        // Validation (Basic check)
        if (!email || !password || !name || !location_id) {
            return res.status(400).json({ message: "Zaroori fields missing hain (Email, Password, Name, Location)." });
        }

        // 2. Password Hash karein
        // const hashedPassword = await bcrypt.hash(password, 10);

        // 3. STEP 1: Pehle User Table mein entry (Login account banana)
        // Note: 'email' ko hi hum 'username' ki tarah use kar sakte hain ya alag field le sakte hain
        const newUser = await db.User.create({
            
            name: name,
            email: email,
            username: username,
            password: password,
            role: role || 'EMPLOYEE' // Admin/Sales/etc jo aapne registration form se bheja ho
        }, { transaction: t });
        console.log("Naye User ki ID hai:", newUser.id);

        // 4. STEP 2: Employee Master Table mein entry
        // Yahan 'userId' mein hum 'newUser.id' daalenge jo abhi-abhi generate hui hai
        const newEmployee = await db.EmployeeMaster.create({
            emp_code,
            name: name,
            email: email,
            phone: phone,
            address: address,
            department: department,
            position: position, // 'Site Supervisor', 'Sales', etc.
            monthly_wages: monthly_wages,
            location_id: location_id,
            supervisor_id: supervisor_id || null,
            userId: newUser.id, // <--- YEH HAI VO LINK (Foreign Key)
            isActive: true
        }, { transaction: t });

        // Sab sahi raha toh commit karein
        await t.commit();

        return res.status(201).json({
            status: "Success",
            message: "User Login aur Employee Profile dono ban gaye hain.",
            data: {
                loginId: newUser.id,
                employeeId: newEmployee.id
            }
        });

    } catch (error) {
        // Agar kahin bhi galti hui toh transaction cancel (Rollback)
        await t.rollback();
        console.error("Error in Registration:", error);
        return res.status(500).json({ 
            message: "Internal Server Error", 
            error: error.message 
        });
    }
};


const updateEmployee = async (req, res) => {
    // 1. Transaction start karein agar aapne options mein pass kiya hai
    const t = await db.sequelize.transaction();

    try {
        const { id } = req.params;
        
        // 2. Body se data nikaalein (Destructuring)
        const { 
            name, phone, role, address, 
            location_id, supervisor_id, 
            department, position, monthly_wages, isActive 
        } = req.body;

        const employee = await db.EmployeeMaster.findByPk(id);
        
        if (!employee) {
            await t.rollback();
            return res.status(404).json({ message: "Employee nahi mila." });
        }

        // 3. Update execution
        await employee.update({
            name,
            phone,
            role,
            address,
            location_id: location_id || employee.location_id, // Agar null aaye toh purana rakhein
            supervisor_id: supervisor_id || employee.supervisor_id,
            department,
            position,
            monthly_wages,
            isActive
        }, { transaction: t });

        // 4. Commit transaction
        await t.commit();

        return res.status(200).json({
            status: "Success",
            message: "Employee update ho gaya.",
            data: employee
        });

    } catch (error) {
        // 5. Rollback on error
        if (t) await t.rollback();
        console.error("Update Error:", error);
        return res.status(500).json({ message: "Update fail hua.", error: error.message });
    }
};


const getallEmployee = async (req, res) => {
    try {
        const employees = await db.EmployeeMaster.findAll({
            attributes: ['id', 'emp_code', 'name', 'email', 'phone', 'department', 'position']
        });
        res.json({ employees });
    } catch (error) {
        console.error("Get All Employees Error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

const getEmployeeProfile = async (req, res) => {
    try {
        const userIdFromToken = req.user.id;
        const emailFromToken = req.user.email;

        // Debug ke liye: Token se kya aa raha hai
        console.log(`Searching for UserID: ${userIdFromToken} or Email: ${emailFromToken}`);

        const employee = await db.EmployeeMaster.findOne({
            where: {
                [Op.or]: [
                    { user_id: userIdFromToken }, 
                    { email: emailFromToken }
                ]
            },
            // Agar attributes dene par data missing hai, toh temporarily ise hatayein
            // attributes: ['id', 'emp_code', 'name', 'email', 'phone', 'department', 'position'],
            raw: true 
        });

        if (!employee) {
            return res.status(404).json({ 
                success: false, 
                message: "Profile data not found in EmployeeMaster table." 
            });
        }

        // --- IMPORTANT LOGIC ---
        // Agar DB mein column name 'emp_code' hai par JSON mein nahi aa raha,
        // toh manually object assign karein.
        const responseData = {
            id: employee.id || employee.employee_master_id,
            emp_code: employee.emp_code || "NOT_ASSIGNED", // Fallback
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            department: employee.department,
            position: employee.position,
            hrm_employee_id: employee.id // Aapke console log mein ye aa raha tha
        };

        console.log("✅ Sending Data to Frontend:", responseData);

        return res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("❌ Profile Fetch Error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = { CreateEmployee, updateEmployee, getallEmployee, getEmployeeProfile };