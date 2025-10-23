const express = require('express');
const router = express.Router();
const { upload, uploadFiles } = require('../controllers/uploadController');

// File upload route - handles multiple files
router.post('/upload', upload.array('files', 10), uploadFiles);

module.exports = router;