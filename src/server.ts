import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth';
import messageRoutes from './routes/message';
import profileRoutes from './routes/profile';
import { rateLimiter } from './middleware/rateLimiter';

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: true,
  credentials: false
}));

// Routes with middleware
app.use('/api/auth', rateLimiter, authRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/profile', profileRoutes);

// Health check endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from echo-backend!', status: 'healthy' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
}); 