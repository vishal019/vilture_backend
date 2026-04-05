const express = require('express');
const routes = express.Router();
const pool = require('../dbcon');
const app = express();

// Helper function to create database connection
const createConnection = async () => {
    return await pool.getConnection();
};

// Helper function to close database connection
const closeConnection = async (connection) => {
    if (connection) connection.release();
};

app.use(express.json());


// GET /admin/properties/accommodations - Fetch all accommodations
routes.get('/accommodations', async (req, res) => {
    const connection = await createConnection();

    try {
        // Validate and parse query parameters
        const {
            type,
            min_capacity,
            max_capacity,
            is_available,
            min_price,
            max_price,
            search,
            amenities,
            page = 1,
            limit = 500,
            sort = 'created_at',
            order = 'DESC'
        } = req.query;

        const authUser = req.user || null;

        // Validate numeric parameters
        const pageNum = Math.max(1, parseInt(page)) || 1;
        const limitNum = Math.min(100, Math.max(1, parseInt(limit))) || 10;
        const offset = (pageNum - 1) * limitNum;

        // Base query selecting only from accommodations table
        let query = `
            SELECT 
                id,
                name,
                type,
                description,
                price,
                capacity,
                rooms,
                available,
                features,
                images,
                amenity_ids,
                owner_id,
                city_id,
                address,
                latitude,
                longitude,
                package_name,
                package_description,
                package_images,
                adult_price,
                child_price,
                max_guests,
                MaxPersonVilla,
                RatePersonVilla,
                created_at,
                updated_at
            FROM accommodations
        `;

        const conditions = [];
        const params = [];

        // Add filters (all from accommodations table)
        if (type) {
            conditions.push('type = ?');
            params.push(type);
        }

        if (min_capacity) {
            conditions.push('capacity >= ?');
            params.push(min_capacity);
        }

        if (max_capacity) {
            conditions.push('capacity <= ?');
            params.push(max_capacity);
        }

        if (is_available === 'true') {
            conditions.push('available = TRUE');
        } else if (is_available === 'false') {
            conditions.push('available = FALSE');
        }

        if (min_price) {
            conditions.push('price >= ?');
            params.push(min_price);
        }

        if (max_price) {
            conditions.push('price <= ?');
            params.push(max_price);
        }

        if (search) {
            conditions.push('(name LIKE ? OR description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        // Manager: restrict to own accommodations by owner_id
        if (authUser && authUser.role === 'manager') {
            conditions.push('owner_id = ?');
            params.push(authUser.id);
        }

        if (amenities) {
            const amenityIds = amenities.split(',').map(id => parseInt(id.trim()));
            conditions.push(`JSON_OVERLAPS(amenity_ids, ?)`);
            params.push(JSON.stringify(amenityIds));
        }

        // Add WHERE clause if conditions exist
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Validate sort field against actual table columns
        const validSortFields = [
            'id', 'name', 'type', 'price', 'capacity', 'rooms',
            'available', 'created_at', 'updated_at'
        ];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Add sorting
        query += ` ORDER BY ${sortField} ${sortOrder}`;

        // Add pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(limitNum, offset);

        // Execute main query
        const [rows] = await connection.execute(query, params);

        // Get total count (using same conditions)
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM accommodations
            ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
        `;
        const [countRows] = await connection.execute(countQuery, params.slice(0, -2));
        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limitNum);

        // Process JSON fields
        const processJsonField = (field, defaultValue) => {
            try {
                return field ? JSON.parse(field) : defaultValue;
            } catch (e) {
                console.error('JSON parse error:', e.message);
                return defaultValue;
            }
        };

        // Format response (all fields from accommodations table)
        const formattedRows = rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type,
            description: row.description,
            price: row.price,
            capacity: row.capacity,
            rooms: row.rooms,
            available: Boolean(row.available),
            features: processJsonField(row.features, []),
            images: processJsonField(row.images, []),
            amenities: processJsonField(row.amenity_ids, []),
            maxPerson: row.MaxPersonVilla || null,
            ratePerPerson: row.RatePersonVilla || null,
            location: {
                address: row.address,
                coordinates: {
                    latitude: row.latitude,
                    longitude: row.longitude
                }
            },
            ownerId: row.owner_id,
            cityId: row.city_id,
            package: {
                name: row.package_name,
                description: row.package_description,
                images: processJsonField(row.package_images, []),
                pricing: {
                    adult: row.adult_price,
                    child: row.child_price,
                    maxGuests: row.max_guests
                }
            },
            timestamps: {
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }
        }));

        res.json({
            data: formattedRows,
            pagination: {
                total,
                totalPages,
                currentPage: pageNum,
                perPage: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            }
        });

    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            error: 'Failed to fetch accommodations',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    sqlMessage: error.sqlMessage
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});
// GET /admin/properties/accommodations/:id - Fetch single accommodation
routes.get('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Fetching accommodation with ID:', id);

    // Validate ID is a non-negative integer (including 0)
    if (!Number.isInteger(Number(id)) || Number(id) < 0) {
        console.log("Invalid ID format");
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const authUser = req.user || null;
    const connection = await createConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT 
                a.*,
                u.name as owner_name,
                c.name as city_name,
                c.country as country
            FROM accommodations a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN cities c ON a.city_id = c.id
            WHERE a.id = ?${authUser && authUser.role === 'manager' ? ' AND a.owner_id = ?' : ''}`,
            authUser && authUser.role === 'manager' ? [id, authUser.id] : [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const accommodation = rows[0];

        // Helper function to safely parse JSON fields
        const parseJSONField = (field, defaultValue) => {
            try {
                if (field === null || field === undefined) return defaultValue;
                if (typeof field === 'object') return field;
                return JSON.parse(field);
            } catch (e) {
                console.warn(`Failed to parse JSON field ${field}:`, e.message);
                return defaultValue;
            }
        };

        // Determine availability - you might need to adjust this logic based on your actual business rules
        const isAvailable = true; // Replace with your actual availability logic

        // Transform database fields to frontend structure
        const response = {
            id: accommodation.id,
            basicInfo: {
                name: accommodation.name || '',
                description: accommodation.description || '',
                type: accommodation.type || '',
                capacity: accommodation.capacity || 2,
                rooms: accommodation.rooms || 1,
                price: accommodation.price || 0,
                available: isAvailable, // Using the availability flag
                features: parseJSONField(accommodation.features, []),
                images: parseJSONField(accommodation.images, [])
            },
            location: {
                owner: {
                    id: accommodation.owner_id,
                    name: accommodation.owner_name
                },
                city: {
                    id: accommodation.city_id,
                    name: accommodation.city_name,
                    country: accommodation.country
                },
                address: accommodation.address || '',
                coordinates: {
                    latitude: accommodation.latitude,
                    longitude: accommodation.longitude
                }
            },
            amenities: {
                ids: parseJSONField(accommodation.amenity_ids, []),
                // You could add full amenity objects here if needed
            },
            packages: {
                name: accommodation.package_name || '',
                description: accommodation.package_description || '',
                images: parseJSONField(accommodation.package_images, []),
                pricing: {
                    adult: accommodation.adult_price || 0,
                    child: accommodation.child_price || 0,
                    maxGuests: accommodation.max_guests || 2
                }
            },
            metadata: {
                createdAt: accommodation.created_at,
                updatedAt: accommodation.updated_at
            }
        };

        res.json(response);

    } catch (error) {
        console.error('Error fetching accommodation:', error);

        // Handle specific SQL errors
        if (error.code === 'ER_PARSE_ERROR' || error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(500).json({
                error: 'Database query error',
                details: process.env.NODE_ENV === 'development' ? {
                    message: error.message,
                    sql: error.sql,
                    code: error.code
                } : undefined
            });
        }

        res.status(500).json({
            error: 'Failed to fetch accommodation',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});

// POST /admin/properties/accommodations - Create new accommodation
routes.post('/accommodations', async (req, res) => {
    try {
        // Destructure nested structure from frontend
        const authUser = req.user || null;

        const {
            basicInfo,
            location,
            amenities,
            ownerId,
            packages
        } = req.body;

        // Validate required fields
        if (!basicInfo || !basicInfo.name || !basicInfo.type || 
            !basicInfo.capacity || !basicInfo.rooms || !basicInfo.price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const connection = await createConnection();

        // Extract values from nested structure
        const { 
            name, 
            description, 
            type, 
            capacity, 
            rooms, 
            price, 
            features = [], 
            images = [], 
            available = true,
            MaxPersonVilla,
            RatePersonVilla
        } = basicInfo;

        const address = location?.address || null;
        const cityId = location?.cityId || null;
        const latitude = location?.coordinates?.latitude || null;
        const longitude = location?.coordinates?.longitude || null;
        const amenityIds = amenities?.ids || [];

        const packageName = packages?.name || null;
        const packageDescription = packages?.description || null;
        const packageImages = packages?.images || [];
        const adultPrice = packages?.pricing?.adult || 0;
        const childPrice = packages?.pricing?.child || 0;
        const maxGuests = packages?.pricing?.maxGuests || 2;

        // Determine owner: managers can only create their own accommodations
        const resolvedOwnerId =
            authUser && authUser.role === 'manager'
                ? authUser.id
                : ownerId || null;

        // Insert into database
        const [result] = await connection.execute(
            `INSERT INTO accommodations 
            (name, description, type, capacity, rooms, price, features, images, available, owner_id, city_id, 
             address, latitude, longitude, amenity_ids, package_name, package_description, package_images,
             adult_price, child_price, max_guests, MaxPersonVilla, RatePersonVilla) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                description || null,
                type,
                capacity,
                rooms,
                price,
                JSON.stringify(features),
                JSON.stringify(images),
                available,
                resolvedOwnerId,
                cityId || null,
                address,
                latitude,
                longitude,
                JSON.stringify(amenityIds),
                packageName,
                packageDescription,
                JSON.stringify(packageImages),
                adultPrice,
                childPrice,
                maxGuests,
                MaxPersonVilla || null,
                RatePersonVilla || null
            ]
        );

        await closeConnection(connection);

        res.status(201).json({
            message: 'Accommodation created successfully',
            id: result.insertId,
            name: name
        });

    } catch (error) {
        console.error('Error creating accommodation:', error);
        res.status(500).json({
            error: 'Failed to create accommodation',
            details: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});


// PUT /admin/properties/accommodations/:id - Update accommodation
routes.put('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Updating accommodation with ID:', id);
    // Validate ID
    // if (!id || !Number.isInteger(Number(id)) || Number(id) <= 0) {
    //     return res.status(400).json({ error: 'Invalid accommodation ID' });
    // }

    try {
        const connection = await createConnection();
        await connection.beginTransaction();

        try {
            // Check if accommodation exists
            const [existing] = await connection.execute(
                'SELECT * FROM accommodations WHERE id = ? FOR UPDATE',
                [id]
            );

            if (existing.length === 0) {
                await connection.rollback();
                await closeConnection(connection);
                return res.status(404).json({ error: 'Accommodation not found' });
            }

            const current = existing[0];

            // Managers can only update their own accommodations
            if (req.user && req.user.role === 'manager' && current.owner_id !== req.user.id) {
                await connection.rollback();
                await closeConnection(connection);
                return res.status(403).json({ error: 'Not allowed to update this accommodation' });
            }
            const requestBody = req.body;
            console.log(requestBody)
            // Input validation function
            const validateInput = (field, type, required = false) => {
                if (required && field === undefined) {
                    throw new Error(`Missing required field`);
                }

                switch (type) {
                    case 'number':
                        if (field !== undefined && isNaN(Number(field))) {
                            throw new Error(`Invalid number value`);
                        }
                        return field !== undefined ? Number(field) : field;
                    case 'array':
                        if (field && !Array.isArray(field)) {
                            try {
                                return JSON.parse(field);
                            } catch (e) {
                                throw new Error(`Invalid array format`);
                            }
                        }
                        return field;
                    case 'boolean':
                        return Boolean(field);
                    default:
                        return field;
                }
            };

            // Extract values from nested structure
            const basicInfo = requestBody.basicInfo || {};
            const location = requestBody.location || {};
            const amenities = requestBody.amenities || {};
            const packages = requestBody.packages || {};
            
            // Prepare update data with validation
            const updateData = {
                name: validateInput(basicInfo.name ?? current.name, 'string', true),
                description: validateInput(basicInfo.description ?? current.description, 'string', true),
                type: validateInput(basicInfo.type ?? current.type, 'string', true),
                capacity: validateInput(basicInfo.capacity ?? current.capacity, 'number', true),
                rooms: validateInput(basicInfo.rooms ?? current.rooms, 'number', true),
                price: validateInput(basicInfo.price ?? current.price, 'number', true),
                features: JSON.stringify(validateInput(basicInfo.features ?? current.features, 'array')),
                images: JSON.stringify(validateInput(basicInfo.images ?? current.images, 'array')),
                available: validateInput(basicInfo.available ?? current.available, 'boolean'),
                owner_id: validateInput(requestBody.ownerId ?? current.owner_id, 'number'),
                city_id: validateInput(location.cityId ?? current.city_id, 'number'),
                address: validateInput(location.address ?? current.address, 'string'),
                latitude: validateInput(location.coordinates?.latitude ?? current.latitude, 'number'),
                longitude: validateInput(location.coordinates?.longitude ?? current.longitude, 'number'),
                amenity_ids: JSON.stringify(validateInput(amenities.ids ?? current.amenity_ids, 'array')),
                package_name: validateInput(packages.name ?? current.package_name, 'string'),
                package_description: validateInput(packages.description ?? current.package_description, 'string'),
                package_images: JSON.stringify(validateInput(packages.images ?? current.package_images, 'array')),
                adult_price: validateInput(packages.pricing?.adult ?? current.adult_price, 'number'),
                child_price: validateInput(packages.pricing?.child ?? current.child_price, 'number'),
                max_guests: validateInput(packages.pricing?.maxGuests ?? current.max_guests, 'number'),
                MaxPersonVilla: validateInput(basicInfo.MaxPersonVilla ?? current.MaxPersonVilla, 'number'),
                RatePersonVilla: validateInput(basicInfo.RatePersonVilla ?? current.RatePersonVilla, 'number')
            };

            // Additional validation
            if (updateData.capacity <= 0 || updateData.rooms <= 0 || updateData.price <= 0) {
                throw new Error('Capacity, rooms, and price must be positive numbers');
            }

            // Execute update
            const [result] = await connection.execute(
                `UPDATE accommodations SET
                    name = ?, 
                    description = ?, 
                    type = ?, 
                    capacity = ?, 
                    rooms = ?,
                    price = ?, 
                    features = ?, 
                    images = ?, 
                    available = ?, 
                    owner_id = ?,
                    city_id = ?, 
                    address = ?, 
                    latitude = ?, 
                    longitude = ?, 
                    amenity_ids = ?,
                    package_name = ?, 
                    package_description = ?, 
                    package_images = ?,
                    adult_price = ?, 
                    child_price = ?, 
                    max_guests = ?,
                    MaxPersonVilla = ?,
                    RatePersonVilla = ?,
                    updated_at = CURRENT_TIMESTAMP()
                WHERE id = ?`,
                [
                    updateData.name,
                    updateData.description,
                    updateData.type,
                    updateData.capacity,
                    updateData.rooms,
                    updateData.price,
                    updateData.features,
                    updateData.images,
                    updateData.available,
                    updateData.owner_id,
                    updateData.city_id,
                    updateData.address,
                    updateData.latitude,
                    updateData.longitude,
                    updateData.amenity_ids,
                    updateData.package_name,
                    updateData.package_description,
                    updateData.package_images,
                    updateData.adult_price,
                    updateData.child_price,
                    updateData.max_guests,
                    updateData.MaxPersonVilla,
                    updateData.RatePersonVilla,
                    id
                ]
            );

            if (result.affectedRows === 0) {
                await connection.rollback();
                await closeConnection(connection);
                return res.status(404).json({ error: 'No changes made' });
            }

            await connection.commit();
            await closeConnection(connection);

            res.status(200).json({
                id: id,
                message: 'Accommodation updated successfully'
            });

        } catch (error) {
            await connection.rollback();
            await closeConnection(connection);
            console.error('Error updating accommodation:', error);
            
            if (error.message.includes('Missing required') || 
                error.message.includes('Invalid number') ||
                error.message.includes('must be positive')) {
                return res.status(400).json({ error: error.message });
            }

            res.status(500).json({ 
                error: 'Failed to update accommodation',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

    } catch (error) {
        console.error('Database connection error:', error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});


// DELETE /admin/properties/accommodations/:id - Delete accommodation
routes.delete('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Deleting accommodation with ID:', id);
    // Validate ID is a positive integer
    if (!Number.isInteger(Number(id)) || id <= 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const connection = await createConnection();

    try {
        await connection.beginTransaction();

        // 1. Check if accommodation exists
        const [accommodation] = await connection.execute(
            'SELECT id, owner_id FROM accommodations WHERE id = ? FOR UPDATE',
            [id]
        );

        if (accommodation.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const current = accommodation[0];
        // Managers can only delete their own accommodations
        if (req.user && req.user.role === 'manager' && current.owner_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({ error: 'Not allowed to delete this accommodation' });
        }

        // 2. Delete from all child tables
        const childTables = [
            'blocked_dates',
            'accommodation_amenities',
            'bookings',
            'reviews',
            'packages'
        ];

        for (const table of childTables) {
            try {
                await connection.execute(
                    `DELETE FROM ${table} WHERE accommodation_id = ?`,
                    [id]
                );
            } catch (err) {
                // Ignore "table doesn't exist" errors
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            }
        }

        // 3. Finally delete the accommodation
        const [result] = await connection.execute(
            'DELETE FROM accommodations WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No accommodation deleted' });
        }

        await connection.commit();
        res.json({
            message: 'Accommodation and all related data deleted successfully',
            deletedId: id
        });

    } catch (error) {
        await connection.rollback();
        console.error('Database error deleting accommodation:', error);

        // More specific error handling
        let errorMessage = 'Failed to delete accommodation';
        let errorDetails = {};
        
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            errorMessage = 'Cannot delete - accommodation is referenced by other records';
            errorDetails = { hint: 'Please delete related bookings or reviews first' };
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Referenced record not found';
            errorDetails = { hint: 'Database consistency issue detected' };
        } else if (error.code === 'ER_NO_SUCH_TABLE') {
            errorMessage = 'Database table missing';
            errorDetails = { missingTable: error.sqlMessage.match(/Table '(.+)'/)[1] };
        }

        res.status(500).json({
            error: errorMessage,
            ...errorDetails,
            // Always include debug info in development
            ...(process.env.NODE_ENV !== 'production' && {
                details: {
                    code: error.code,
                    message: error.message,
                    sql: error.sql
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});
// PATCH /admin/properties/accommodations/:id/toggle-availability - Toggle availability
routes.patch('/accommodations/:id/toggle-availability', async (req, res) => {
    try {
        const { id } = req.params;
        const { available } = req.body;

        const connection = await createConnection();

        // If setting to available, set available_rooms to 1, if unavailable set to 0
        const available_rooms = available ? 1 : 0;

        const [result] = await connection.execute(
            'UPDATE accommodations SET available_rooms = ? WHERE id = ?',
            [available_rooms, id]
        );

        if (result.affectedRows === 0) {
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        await closeConnection(connection);
        res.json({
            message: 'Availability updated successfully',
            available: available
        });
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

// GET /admin/properties/accommodations/stats - Get accommodation statistics
routes.get('/accommodations/stats', async (req, res) => {
    try {
        const connection = await createConnection();

        const [stats] = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN available_rooms > 0 THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN available_rooms = 0 THEN 1 ELSE 0 END) as unavailable,
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price
            FROM accommodations
        `);

        await closeConnection(connection);
        res.json(stats[0]);
    } catch (error) {
        console.error('Error fetching accommodation stats:', error);
        res.status(500).json({ error: 'Failed to fetch accommodation statistics' });
    }
});

// GET /admin/properties/users
routes.get('/users', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, email FROM users');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /admin/properties/cities
routes.get('/cities', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, country FROM cities WHERE active = 1');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

module.exports = routes;
