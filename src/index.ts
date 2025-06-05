import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express, { Request, Response } from 'express'
import './client/supabase'
import { checkBucketConnection } from './lib/storage'

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth',authRoutes);

checkBucketConnection().catch(console.error)

app.get('/', (_req: Request, res: Response) => {
  res.send('Hello from echo-backend!')
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
