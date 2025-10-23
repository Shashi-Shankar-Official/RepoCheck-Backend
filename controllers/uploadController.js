const multer = require('multer');
const fs = require('fs');

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/') // files will be saved in uploads directory
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname) // unique filename
    }
});

const upload = multer({ storage: storage });

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}

const uploadFiles = async (req, res) => {
    try {
        console.log('Request files:', req.files);
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.' });
        }
        
        // Mock data for demonstration - replace this with your actual analysis logic
        const analysisResult = {
            message: 'Files uploaded successfully',
            files: req.files.map(file => ({
                filename: file.filename,
                size: file.size
            })),
            keyValuePairs: {
                "Red": ["RBC Count", "High virus detection"],
                "Green": ["WBC", "normal levels"],
                "Yellow": ["Urine content", "algo"]
            },
            isLifeThreatening: true
        };
        
        res.status(200).json(analysisResult);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            message: 'Error uploading files', 
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
};

module.exports = {
    upload,
    uploadFiles
};