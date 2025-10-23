require('dotenv').config();
const express = require('express');
const cors = require('cors');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();

// Enable CORS for the frontend
app.use(cors({
    origin: [
        'http://localhost:5173',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Middleware to parse JSON bodies
app.use(express.json());

// Basic route for testing
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to RepoCheck Backend API' });
});

// Routes
app.use('/api', uploadRoutes);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});