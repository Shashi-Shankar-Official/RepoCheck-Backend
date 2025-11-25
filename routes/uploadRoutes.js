const express = require('express');
const router = express.Router();
const { upload, uploadFiles, getAnalysisResults } = require('../controllers/uploadController');

// File upload route - handles multiple files
router.post('/upload', upload.array('files', 10), uploadFiles);

// Get analysis results route
router.get('/upload', getAnalysisResults);

module.exports = router;