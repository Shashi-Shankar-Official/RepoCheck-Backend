require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();

// 1. Configure CORS options
const corsOptions = {
    origin: [
        'http://localhost:5173', // ✅ Updated: Your Frontend URL
        'http://localhost:5173/', // (Optional) Sometimes browsers add a trailing slash
        process.env.FRONTEND_URL   // Production URL from .env
    ].filter(Boolean),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
};

// 2. Apply CORS Middleware
app.use(cors(corsOptions));

// 3. Handle Preflight Requests
// Using regex /(.*)/ to prevent the "Missing parameter name" crash
app.options(/(.*)/, cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// Basic route for testing
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to RepoCheck Backend API' });
});

// Routes
app.use('/api', uploadRoutes);

// ✅ Updated: Backend defaults to port 5000
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    // console.log(`Server is running on port ${PORT}`);
});