const multer = require('multer');
const fs = require('fs');
// Using node-fetch for compatibility with older Node.js versions
const fetch = require('node-fetch'); 
const Tesseract = require('tesseract.js'); 
const { GoogleGenAI, Type } = require('@google/genai');
const poppler = require('pdf-poppler'); // Requires installation of Poppler utilities on the OS

// Initialize Gemini Client
// The SDK automatically looks for the GEMINI_API_KEY environment variable.
const ai = new GoogleGenAI({}); 

// --- 1. Multer Configuration ---
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

// --- 2. Constants for Normal Ranges and Order ---
const NORMAL_RANGES = {
    "Hemoglobin (g/dL)": [12.0, 16.0],
    "RBC Count (mil/cumm)": [4.2, 5.4],
    "PCV/HCT (%)": [36.0, 46.0],
    "MCV (fL)": [80.0, 100.0],
    "MCH (pg)": [27.0, 33.0],
    "MCHC (g/dL)": [32.0, 36.0],
    "RDW-CV (%)": [11.5, 14.5],
    "Platelet Count (x10^3/uL)": [150, 450],
    "WBC/TLC Count (/cumm)": [4000, 11000],
    "Neutrophils (%)": [40, 70],
    "Lymphocytes (%)": [20, 40],
    "Monocytes (%)": [2, 10],
    "Eosinophils (%)": [1, 6],
    "Basophils (%)": [0, 1],
    "Blood Urea (mg/dL)": [10, 40],
    "Serum Creatinine (mg/dL)": [0.6, 1.3],
    "Sodium (mEq/L)": [135, 145],
    "Potassium (mEq/L)": [3.5, 5.0],
    "Chloride (mEq/L)": [98, 107],
};

const ORDERED_KEYS = Object.keys(NORMAL_RANGES); // This maintains the strict order
const FLASK_BACKEND_URL = 'https://flaskbackend-pp80.onrender.com/predict';

// --- 3. Helper Functions ---

/**
 * Converts the first page of a PDF to a PNG image file using pdf-poppler.
 * @param {string} pdfPath - The path to the input PDF file.
 * @returns {string} The path to the created PNG file.
 */
const convertPdfToImage = async (pdfPath) => {
    const outputDir = 'uploads/';
    const outputFileName = `page1-${Date.now()}`;
    
    const options = {
        format: 'png',
        out_dir: outputDir,
        out_prefix: outputFileName,
        page: 1, 
        scale: 2048 // High DPI for better OCR
    };

    console.log(`Converting PDF to image: ${pdfPath}`);
    await poppler.convert(pdfPath, options);

    // Poppler creates a file like 'uploads/page1-timestamp-1.png'
    return `${outputDir}${outputFileName}-1.png`;
};

/**
 * Calculates the percentage deviation from the nearest normal limit.
 * @param {number} value - The actual lab result value.
 * @param {Array<number>} range - The [lower, upper] limits of the normal range.
 * @returns {number} The deviation percentage (positive for high, negative for low, 0 for normal), rounded to 1 decimal.
 */
const calculateDeviation = (value, [lower, upper]) => {
    if (value >= lower && value <= upper) {
        return 0; // Value is within normal range
    }

    let deviation;
    let limit;

    if (value > upper) {
        limit = upper;
        deviation = ((value - limit) / limit) * 100;
    } else {
        limit = lower;
        deviation = ((value - limit) / limit) * 100;
    }

    return Math.round(deviation * 10) / 10;
};


// --- 4. Gemini JSON Schema ---
const labResultSchema = {
    type: Type.OBJECT,
    properties: {
        "features": {
            type: Type.ARRAY,
            description: "A list of 19 numeric lab values in the strict required order.",
            items: {
                type: Type.NUMBER 
            }
        }
    },
    required: ["features"],
    description: "Extracted lab values formatted as a sequential list for the machine learning model."
};


// --- 5. Main Controller Function: uploadFiles ---
const uploadFiles = async (req, res) => {
    const filesToCleanUp = []; // To track all original and generated image files
    
    try {
        console.log('Request files:', req.files);
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.' });
        }
        // --- Custom validation: allow up to 3 images or 1 PDF, not both ---
        const imageFiles = req.files.filter(f => f.mimetype.startsWith('image/'));
        const pdfFiles = req.files.filter(f => f.mimetype === 'application/pdf');
        if ((pdfFiles.length > 1) || (imageFiles.length > 3) || (pdfFiles.length > 0 && imageFiles.length > 0)) {
            // Clean up uploaded files
            req.files.forEach(f => fs.unlink(f.path, () => {}));
            return res.status(400).json({ message: 'Upload a maximum of 3 images OR 1 PDF only.' });
        }
        
        // Add original files to cleanup list
        req.files.forEach(f => filesToCleanUp.push(f.path));


        // --- Stage 1: File Preprocessing and OCR Extraction ---
        let combinedText = '';

        for (const file of req.files) {
            let filePathForOCR = file.path;

            // Handle PDF conversion
            if (file.mimetype === 'application/pdf') {
                try {
                    filePathForOCR = await convertPdfToImage(file.path);
                    filesToCleanUp.push(filePathForOCR); // Add temporary image file for deletion
                } catch (pdfError) {
                    console.error(`PDF conversion failed for ${file.filename}:`, pdfError);
                    // Skip to the next file if conversion fails
                    continue; 
                }
            }

            console.log(`Starting OCR for file: ${file.filename} using path: ${filePathForOCR}`);
            
            // Run Tesseract
            const { data: { text } } = await Tesseract.recognize(filePathForOCR, 'eng');
            combinedText += `\n\n--- Start of ${file.filename} ---\n${text}\n--- End of ${file.filename} ---`;
        }

        if (!combinedText.trim()) {
            return res.status(400).json({ message: 'Files uploaded, but failed to extract any meaningful text via OCR.' });
        }
        
        // --- Stage 2: Structured Data Extraction using Gemini API ---
        const systemInstruction = `You are an expert medical data extractor. Your task is to analyze the provided raw text from a medical lab report and extract exactly 19 lab values.
        
        The extracted values MUST be returned as a single list of numbers under the key "features" in the JSON object.
        
        The required order is strictly: ${ORDERED_KEYS.join(', ')}.

        For any of these 19 fields that you **cannot find** a value for in the provided text, you **MUST** use the default value of **0** (zero) in the corresponding position in the list. Do not use null or strings; all items must be numbers.

        ---
        Here is an example of the expected output:
        { "features": [13.5, 4.8, 40.2, 90.1, 29.5, 34.0, 12.8, 250, 8000, 60, 30, 5, 2, 0, 25, 1.0, 140, 4.2, 102] }
        
        Here is a sample of the kind of text you may receive:
        "Hemoglobin: 13.5 g/dL\nRBC Count: 4.8 mil/cumm\nPCV/HCT: 40.2%\nMCV: 90.1 fL\nMCH: 29.5 pg\nMCHC: 34.0 g/dL\nRDW-CV: 12.8%\nPlatelet Count: 250 x10^3/uL\nWBC/TLC Count: 8000 /cumm\nNeutrophils: 60%\nLymphocytes: 30%\nMonocytes: 5%\nEosinophils: 2%\nBasophils: 0%\nBlood Urea: 25 mg/dL\nSerum Creatinine: 1.0 mg/dL\nSodium: 140 mEq/L\nPotassium: 4.2 mEq/L\nChloride: 102 mEq/L"
        
        If the field name in the text is slightly different (e.g., "Hb" for Hemoglobin, or "WBC" for "WBC/TLC Count"), use your best judgment to match it to the correct field in the required order. Ignore any extra or unrelated values.`;
        
        const geminiResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: combinedText,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: labResultSchema,
            },
        });

        const structuredData = JSON.parse(geminiResponse.text);
        const labValues = structuredData.features || [];
        console.log('--- Structured Data from Gemini ---');
        console.log(`Array Length: ${labValues.length}`);
        console.log(JSON.stringify(structuredData, null, 2));
        
        // --- Stage 3: Send Structured Data to Flask Backend (Logged) ---
        console.log(`Sending POST request to Flask backend: ${FLASK_BACKEND_URL}`);

        const fetchResponse = await fetch(FLASK_BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(structuredData),
        });

        if (fetchResponse.ok) {
            const flaskResult = await fetchResponse.json();
            console.log('--- Final Response from Flask Backend (Logged) ---');
            console.log(JSON.stringify(flaskResult, null, 2));
        } else {
            console.error(`Flask backend request failed: ${fetchResponse.status}`);
        }
        
        // --- Stage 4: Calculate Deviations and Prepare Frontend Response ---
        const analysisItems = [];
        let isLifeThreatening = false; 

        for (let i = 0; i < labValues.length && i < ORDERED_KEYS.length; i++) {
            const name = ORDERED_KEYS[i];
            const value = labValues[i];
            const range = NORMAL_RANGES[name];
            
            // Handle Missing Value Default (0)
            if (value === 0 && (range[0] !== 0 || range[1] !== 0)) {
                 analysisItems.push({
                    category: "Yellow", // Yellow category for missing/defaulted value
                    name: name + " (Missing/Defaulted)",
                    deviation: 0 
                });
                continue;
            }

            const deviation = calculateDeviation(value, range);
            const absDeviation = Math.abs(deviation);
            let category;

            // NEW CATEGORIZATION LOGIC: Green, Yellow(0,5], Red-Yellow(6,20], Red else
            if (deviation === 0) {
                category = "Green";
            } else if (absDeviation > 0 && absDeviation <= 5) {
                category = "Yellow"; 
            } else if (absDeviation > 5 && absDeviation <= 20) {
                category = "Red-Yellow"; 
            } else { // absDeviation > 20
                category = "Red"; 
                isLifeThreatening = true; 
            }

            analysisItems.push({
                category: category,
                name: name,
                deviation: deviation 
            });
        }

        // Final response structure
        const analysisResult = {
            message: 'File analysis complete. Deviations calculated.',
            files: req.files.map(file => ({
                filename: file.filename,
                size: file.size
            })),
            items: analysisItems, 
            isLifeThreatening: isLifeThreatening 
        };

        console.log('Analysis result being sent to frontend:', JSON.stringify(analysisResult, null, 2));

        // --- Cleanup ---
        filesToCleanUp.forEach(filePath => {
            fs.unlink(filePath, (err) => {
                if (err) console.error(`Failed to delete file ${filePath}:`, err);
            });
        });

        res.status(200).json(analysisResult);

    } catch (error) {
        console.error('Upload/Processing error:', error);
        
        // Cleanup remaining files in case of an error
        filesToCleanUp.forEach(filePath => {
            fs.unlink(filePath, (err) => {
                if (err) console.error(`Failed to delete file on error ${filePath}:`, err);
            });
        });

        res.status(500).json({ 
            message: 'Error processing files or communicating with backend', 
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
};


// --- 6. Secondary Controller Function: getAnalysisResults (Unchanged) ---
const getAnalysisResults = async (req, res) => {
    try {
        const analysisResult = {
            message: 'Analysis results retrieved successfully',
            files: [
                {
                    filename: 'sample-report.pdf',
                    size: 256000
                }
            ],
            items: [
                { category: "Red", name: "RBC Count", deviation: 45 },
                { category: "Red", name: "High virus detection", deviation: 85 },
                { category: "Green", name: "WBC", deviation: 5 },
                { category: "Green", name: "Normal levels", deviation: 0 },
                { category: "Yellow", name: "Urine content", deviation: -30 },
                { category: "Yellow", name: "Algo", deviation: 25 }
            ],
            isLifeThreatening: true
        };

        console.log('Analysis result being sent to frontend:', JSON.stringify(analysisResult, null, 2));

        res.status(200).json(analysisResult);
    } catch (error) {
        console.error('Error retrieving analysis results:', error);
        res.status(500).json({ 
            message: 'Error retrieving analysis results', 
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
};

module.exports = {
    upload,
    uploadFiles,
    getAnalysisResults
};