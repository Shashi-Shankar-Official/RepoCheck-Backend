const express = require('express');
const router = express.Router();
const { upload, uploadFiles, getAnalysisResults } = require('../controllers/uploadController');

// File upload route - allow up to 3 images or 1 PDF (validation in controller)
router.post('/upload', upload.array('files', 3), uploadFiles);

// Get analysis results route
router.get('/upload', getAnalysisResults);

module.exports = router;