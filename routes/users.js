const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../dbcon'); // Import the database connection pool

const adminUsersRouter = express.Router();

// All /admin/users routes are admin-only (RBAC)
adminUsersRouter.use((req, res, next) => {
  const authUser = req.user;
  if (!authUser || (authUser.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
});

// GET /admin/users - Fetch all users
adminUsersRouter.get('/', async (req, res) => {
  try {
    
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users ORDER BY id DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      message: error.message 
    });
  }
});

// GET /admin/users/:id - Fetch single user
adminUsersRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      message: error.message 
    });
  }
});

// POST /admin/users - Create new user
adminUsersRouter.post('/', async (req, res) => {
  try {
    const { name, email, phoneNumber, role, status, avatar, password } = req.body;
    console.log(req.body);
    // Validate required fields
    if (!name || !email || !phoneNumber || !role || !status || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'email', 'phoneNumber', 'role', 'status', 'password']
      });
    }
    
    // Validate role enum
    const validRoles = ['admin', 'manager', 'staff'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role',
        validRoles 
      });
    }
    
    // Validate status enum
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses 
      });
    }
    
    // Check if email or phone number already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR phoneNumber = ?',
      [email, phoneNumber]
    );
    
    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        error: 'Email or phone number already exists' 
      });
    }
    
    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insert new user
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, phoneNumber, role, status, avatar, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, email, phoneNumber, role, status, 'https://example.com/avatars/charlie-davis.jpg' || null, hashedPassword]
    );
    
    // Fetch the created user (without password)
    const [newUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(newUserRows[0]);
    
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle duplicate email/phone error specifically
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        error: 'Email or phone number already exists' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create user',
      message: error.message 
    });
  }
});

// PUT /admin/users/:id - Update user
adminUsersRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phoneNumber, role, status, avatar, password } = req.body;

    // Normalize role/status for consistent validation
    const normalizedRole = role ? role.toLowerCase() : undefined;
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Validate role if provided (accept lowercase values from frontend)
    if (normalizedRole) {
      const validRoles = ['admin', 'manager', 'staff'];
      if (!validRoles.includes(normalizedRole)) {
        return res.status(400).json({ 
          error: 'Invalid role',
          validRoles 
        });
      }
    }
    
    // Validate status if provided
    if (status) {
      const validStatuses = ['active', 'inactive', 'suspended'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: 'Invalid status',
          validStatuses 
        });
      }
    }
    
    // Check if email is being changed and if it already exists
    if (email) {
      const [emailCheck] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );
      
      if (emailCheck.length > 0) {
        return res.status(409).json({ 
          error: 'Email already exists' 
        });
      }
    }
    
    // Check if phone number is being changed and if it already exists
    if (phoneNumber) {
      const [phoneCheck] = await pool.execute(
        'SELECT id FROM users WHERE phoneNumber = ? AND id != ?',
        [phoneNumber, id]
      );
      
      if (phoneCheck.length > 0) {
        return res.status(409).json({ 
          error: 'Phone number already exists' 
        });
      }
    }
    
    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    
    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    
    if (phoneNumber) {
      updateFields.push('phoneNumber = ?');
      updateValues.push(phoneNumber);
    }
    
    if (normalizedRole) {
      updateFields.push('role = ?');
      updateValues.push(normalizedRole);
    }
    
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    
    if (avatar !== undefined) {
      updateFields.push('avatar = ?');
      updateValues.push(avatar);
    }
    
    if (password) {
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      updateFields.push('password = ?');
      updateValues.push(hashedPassword);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ 
        error: 'No fields to update' 
      });
    }
    
    // Add id to values for WHERE clause
    updateValues.push(id);
    
    // Execute update
    await pool.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    // Fetch updated user
    const [updatedUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [id]
    );
    
    res.json(updatedUserRows[0]);
    
  } catch (error) {
    console.error('Error updating user:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        error: 'Email or phone number already exists' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to update user',
      message: error.message 
    });
  }
});

// DELETE /admin/users/:id - Delete user
adminUsersRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id, name FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete user
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ 
      message: 'User deleted successfully',
      deletedUser: {
        id: parseInt(id),
        name: existingUsers[0].name
      }
    });
    
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      error: 'Failed to delete user',
      message: error.message 
    });
  }
});

// PATCH /admin/users/:id/status - Update user status only
adminUsersRouter.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ 
        error: 'Status is required' 
      });
    }
    
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses 
      });
    }
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update status
    await pool.execute(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, id]
    );
    
    // Fetch updated user
    const [updatedUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [id]
    );
    
    res.json(updatedUserRows[0]);
    
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ 
      error: 'Failed to update user status',
      message: error.message 
    });
  }
});

module.exports = adminUsersRouter;