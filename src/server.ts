import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import messages from './routes/message';
import profileRoutes from './routes/profile';
import serverless from 'serverless-http';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth';
import messageRoutes from './routes/message';
import './client/supabase';
import { checkBucketConnection } from './lib/storage';

import { subscribeToChannel } from './redis/sub';
import { setupVoiceSocket } from './sockets/voiceSocket';
import { setupChatSocket } from './sockets/chatSocket';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors());

app.use('/api/auth', authRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/profiles', profileRoutes);

app.get('/', (_req: Request, res: Response) => {
  res.send('Hello from echo-backend!');
});

checkBucketConnection().catch(console.error);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

setupChatSocket(io);
subscribeToChannel(io);
setupVoiceSocket(io);

const handler = serverless(app);
export { handler };

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () => {
    console.log(`✅ Local server running at http://localhost:${PORT}`);
  });
}
