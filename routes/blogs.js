const express = require('express');
const router = express.Router();
const pool = require('../dbcon');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/blogs');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'blog-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only image files
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Helper function to generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Helper function to calculate read time
function calculateReadTime(content) {
  const wordsPerMinute = 200;
  let totalWords = 0;
  
  if (Array.isArray(content)) {
    content.forEach(item => {
      if (item.type === 'paragraph' && item.text) {
        totalWords += item.text.split(/\s+/).length;
      } else if (item.type === 'list' && item.items) {
        item.items.forEach(itemText => {
          totalWords += itemText.split(/\s+/).length;
        });
      } else if (item.type === 'heading' && item.text) {
        totalWords += item.text.split(/\s+/).length;
      }
    });
  }
  
  const minutes = Math.ceil(totalWords / wordsPerMinute);
  return `${minutes} min read`;
}

// GET /admin/blogs - Fetch all blogs (admin only - includes drafts)
router.get('/', async (req, res) => {
  try {
    const { search, category, status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM blogs WHERE 1=1';
    const params = [];
    
    if (search) {
      query += ' AND (title LIKE ? OR excerpt LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [blogs] = await pool.execute(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM blogs WHERE 1=1';
    const countParams = [];
    
    if (search) {
      countQuery += ' AND (title LIKE ? OR excerpt LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    if (category && category !== 'all') {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      blogs: blogs.map(blog => ({
        ...blog,
        content: JSON.parse(blog.content || '[]'),
        tags: JSON.parse(blog.tags || '[]')
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({ error: 'Failed to fetch blogs', message: error.message });
  }
});

// GET /admin/blogs/public/:slug - Fetch single published blog by slug (public endpoint)
// This must come before /:id route
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [blogs] = await pool.execute(
      'SELECT * FROM blogs WHERE slug = ? AND status = ?',
      [slug, 'published']
    );
    
    if (blogs.length === 0) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    const blog = blogs[0];
    res.json({
      id: blog.id.toString(),
      slug: blog.slug,
      title: blog.title,
      excerpt: blog.excerpt,
      author: blog.author,
      date: blog.date,
      readTime: blog.read_time,
      image: blog.image?.startsWith('/uploads') 
        ? `https://euphoriastays.com/${blog.image}` 
        : blog.image,
      category: blog.category,
      tags: JSON.parse(blog.tags || '[]'),
      content: JSON.parse(blog.content || '[]')
    });
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({ error: 'Failed to fetch blog', message: error.message });
  }
});

// GET /admin/blogs/public - Fetch published blogs only (public endpoint)
router.get('/public', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM blogs WHERE status = ?';
    const params = ['published'];
    
    if (search) {
      query += ' AND (title LIKE ? OR excerpt LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [blogs] = await pool.execute(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM blogs WHERE status = ?';
    const countParams = ['published'];
    
    if (search) {
      countQuery += ' AND (title LIKE ? OR excerpt LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    if (category && category !== 'all') {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      blogs: blogs.map(blog => ({
        id: blog.id.toString(),
        slug: blog.slug,
        title: blog.title,
        excerpt: blog.excerpt,
        author: blog.author,
        date: blog.date,
        readTime: blog.read_time,
        image: blog.image?.startsWith('/uploads') 
          ? `https://euphoriastays.com/${blog.image}` 
          : blog.image,
        category: blog.category,
        tags: JSON.parse(blog.tags || '[]'),
        content: JSON.parse(blog.content || '[]')
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching public blogs:', error);
    res.status(500).json({ error: 'Failed to fetch blogs', message: error.message });
  }
});

// GET /admin/blogs/:id - Fetch single blog (admin - includes drafts)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [blogs] = await pool.execute('SELECT * FROM blogs WHERE id = ?', [id]);
    
    if (blogs.length === 0) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    const blog = blogs[0];
    res.json({
      ...blog,
      content: JSON.parse(blog.content || '[]'),
      tags: JSON.parse(blog.tags || '[]')
    });
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({ error: 'Failed to fetch blog', message: error.message });
  }
});

// POST /admin/blogs - Create new blog
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const {
      title,
      excerpt,
      author,
      date,
      category,
      tags,
      content,
      status = 'draft'
    } = req.body;
    
    // Validate required fields
    if (!title || !excerpt || !author || !date || !category || !content) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['title', 'excerpt', 'author', 'date', 'category', 'content']
      });
    }
    
    // Generate slug from title
    let slug = generateSlug(title);
    
    // Check if slug already exists
    const [existing] = await pool.execute('SELECT id FROM blogs WHERE slug = ?', [slug]);
    if (existing.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }
    
    // Parse content and tags
    let contentArray = [];
    let tagsArray = [];
    
    try {
      contentArray = typeof content === 'string' ? JSON.parse(content) : content;
      tagsArray = typeof tags === 'string' ? JSON.parse(tags) : (tags || []);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON format for content or tags' });
    }
    
    // Calculate read time
    const readTime = calculateReadTime(contentArray);
    
    // Handle image upload
    let imageUrl = '';
    if (req.file) {
      // In production, upload to cloud storage (S3, Cloudinary, etc.)
      // For now, return the local path or URL
      imageUrl = `/uploads/blogs/${req.file.filename}`;
    } else if (req.body.image) {
      // If image URL is provided directly
      imageUrl = req.body.image;
    }
    
    // Insert blog into database
    const [result] = await pool.execute(
      `INSERT INTO blogs 
       (slug, title, excerpt, author, date, read_time, image, category, tags, content, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        slug,
        title,
        excerpt,
        author,
        date,
        readTime,
        imageUrl,
        category,
        JSON.stringify(tagsArray),
        JSON.stringify(contentArray),
        status
      ]
    );
    
    // Fetch the created blog
    const [newBlog] = await pool.execute('SELECT * FROM blogs WHERE id = ?', [result.insertId]);
    
    res.status(201).json({
      message: 'Blog created successfully',
      blog: {
        ...newBlog[0],
        content: JSON.parse(newBlog[0].content || '[]'),
        tags: JSON.parse(newBlog[0].tags || '[]')
      }
    });
  } catch (error) {
    console.error('Error creating blog:', error);
    res.status(500).json({ error: 'Failed to create blog', message: error.message });
  }
});

// PUT /admin/blogs/:id - Update blog
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      excerpt,
      author,
      date,
      category,
      tags,
      content,
      status
    } = req.body;
    
    // Check if blog exists
    const [existing] = await pool.execute('SELECT * FROM blogs WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    // Generate slug if title changed
    let slug = existing[0].slug;
    if (title && title !== existing[0].title) {
      slug = generateSlug(title);
      // Check if new slug already exists (excluding current blog)
      const [slugCheck] = await pool.execute('SELECT id FROM blogs WHERE slug = ? AND id != ?', [slug, id]);
      if (slugCheck.length > 0) {
        slug = `${slug}-${Date.now()}`;
      }
    }
    
    // Parse content and tags
    let contentArray = existing[0].content ? JSON.parse(existing[0].content) : [];
    let tagsArray = existing[0].tags ? JSON.parse(existing[0].tags) : [];
    
    if (content) {
      try {
        contentArray = typeof content === 'string' ? JSON.parse(content) : content;
      } catch (parseError) {
        return res.status(400).json({ error: 'Invalid JSON format for content' });
      }
    }
    
    if (tags) {
      try {
        tagsArray = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (parseError) {
        return res.status(400).json({ error: 'Invalid JSON format for tags' });
      }
    }
    
    // Calculate read time
    const readTime = calculateReadTime(contentArray);
    
    // Handle image upload
    let imageUrl = existing[0].image;
    if (req.file) {
      // Delete old image if exists
      if (existing[0].image && existing[0].image.startsWith('/uploads/')) {
        const oldImagePath = path.join(__dirname, '..', existing[0].image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      imageUrl = `/uploads/blogs/${req.file.filename}`;
    } else if (req.body.image && req.body.image !== existing[0].image) {
      imageUrl = req.body.image;
    }
    
    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    
    if (title) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (excerpt) {
      updateFields.push('excerpt = ?');
      updateValues.push(excerpt);
    }
    if (author) {
      updateFields.push('author = ?');
      updateValues.push(author);
    }
    if (date) {
      updateFields.push('date = ?');
      updateValues.push(date);
    }
    if (category) {
      updateFields.push('category = ?');
      updateValues.push(category);
    }
    if (slug) {
      updateFields.push('slug = ?');
      updateValues.push(slug);
    }
    if (readTime) {
      updateFields.push('read_time = ?');
      updateValues.push(readTime);
    }
    if (imageUrl) {
      updateFields.push('image = ?');
      updateValues.push(imageUrl);
    }
    if (tagsArray.length > 0 || tags === '[]') {
      updateFields.push('tags = ?');
      updateValues.push(JSON.stringify(tagsArray));
    }
    if (contentArray.length > 0 || content === '[]') {
      updateFields.push('content = ?');
      updateValues.push(JSON.stringify(contentArray));
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    
    updateFields.push('updated_at = NOW()');
    updateValues.push(id);
    
    const updateQuery = `UPDATE blogs SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(updateQuery, updateValues);
    
    // Fetch updated blog
    const [updated] = await pool.execute('SELECT * FROM blogs WHERE id = ?', [id]);
    
    res.json({
      message: 'Blog updated successfully',
      blog: {
        ...updated[0],
        content: JSON.parse(updated[0].content || '[]'),
        tags: JSON.parse(updated[0].tags || '[]')
      }
    });
  } catch (error) {
    console.error('Error updating blog:', error);
    res.status(500).json({ error: 'Failed to update blog', message: error.message });
  }
});

// DELETE /admin/blogs/:id - Delete blog
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if blog exists
    const [existing] = await pool.execute('SELECT * FROM blogs WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    // Delete associated image if exists
    if (existing[0].image && existing[0].image.startsWith('/uploads/')) {
      const imagePath = path.join(__dirname, '..', existing[0].image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
    
    // Delete blog
    await pool.execute('DELETE FROM blogs WHERE id = ?', [id]);
    
    res.json({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Error deleting blog:', error);
    res.status(500).json({ error: 'Failed to delete blog', message: error.message });
  }
});

module.exports = router;

