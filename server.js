import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import engineRoutes from './routes/engine.js';
import workerRoutes from './routes/worker.js';
import { startAutoClaimScheduler } from './services/autoClaimScheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow requests from Vercel frontend (set FRONTEND_URL in Render env vars)
// Falls back to localhost for local development
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Render health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// Main simulation & trigger routes
app.use('/api/engine', engineRoutes);
app.use('/api/worker', workerRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'SwiftShield Backend is running.' });
});

const seedMockWorker = async () => {
  const MOCK_UUID = '11111111-1111-1111-1111-111111111111';
  try {
    const { data, error } = await supabase.from('workers').select('id').eq('id', MOCK_UUID).single();
    if (error && error.code === 'PGRST116') {
      await supabase.from('workers').insert([{
        id: MOCK_UUID,
        full_name: 'Hackathon Demo User',
        vehicle_type: 'Bike',
        active_plan: 'Standard'
      }]);
      console.log('✅ Seeded mock worker for demo simulation');
    }
  } catch (err) {
    console.warn('Could not seed mock worker:', err.message);
  }
};

app.listen(PORT, () => {
  console.log(`🚀 SwiftShield Server running on port ${PORT}`);
  seedMockWorker();
  startAutoClaimScheduler();
});
