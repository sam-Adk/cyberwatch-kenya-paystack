/**
 * routes/uploadRoutes.js
 * Handles image uploads to Cloudinary
 */

const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const { protect } = require('../middleware/authMiddleware');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Use memory storage — no temp files on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed'), false);
  }
});

// POST /api/upload/image — admin only
router.post('/image', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image provided' });

    // Upload buffer directly to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder:         'cyberwatch-kenya',
          transformation: [
            { width: 1200, height: 600, crop: 'fill', gravity: 'auto' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    res.json({
      success:   true,
      imageUrl:  result.secure_url,
      publicId:  result.public_id,
      width:     result.width,
      height:    result.height
    });

  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ success: false, message: 'Image upload failed: ' + error.message });
  }
});

// DELETE /api/upload/image — remove from Cloudinary
router.delete('/image', protect, async (req, res) => {
  try {
    const { publicId } = req.body;
    if (!publicId) return res.status(400).json({ success: false, message: 'No publicId provided' });
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

module.exports = router;
