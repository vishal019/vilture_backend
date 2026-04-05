const express = require('express');
const router = express.Router();
const pool = require('../dbcon');

// ---------------------------------------------
// GET ALL RATINGS
// ---------------------------------------------
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
        id,
        name AS guestName,
        location AS propertyName,
        image,
        rating,
        text AS review,
        created_at AS date
      FROM testimonials
      ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching ratings:', error);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// ---------------------------------------------
// ADD NEW RATING
// ---------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { guestName, image, rating, review, propertyName, date } = req.body;

    if (!guestName || !rating || !review || !propertyName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const [result] = await pool.execute(
      `INSERT INTO testimonials 
       (name, image, rating, text, location, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [guestName, image, rating, review, propertyName, date]
    );

    const insertedId = result.insertId;

    res.json({
      id: insertedId,
      guestName,
      image,
      rating,
      review,
      propertyName,
      date
    });

  } catch (error) {
    console.error('Error adding rating:', error);
    res.status(500).json({ error: 'Failed to add rating' });
  }
});

// ---------------------------------------------
// DELETE RATING
// ---------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM testimonials WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Rating not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting rating:', error);
    res.status(500).json({ error: 'Failed to delete rating' });
  }
});

module.exports = router;
