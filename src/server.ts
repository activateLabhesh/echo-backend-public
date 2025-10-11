import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';

import authRoutes from './routes/auth';
import messageRoutes from './routes/message';
import profileRoutes from './routes/profile';
import channelroutes from './routes/channel';
import serverroutes from './routes/servers';
import roleroutes from './routes/roles';
import contactroutes from "./routes/contact";
import friendroutes from "./routes/friend"

import { rateLimiter } from './middleware/rateLimiter';
import { setupChatSocket } from './sockets/chatSocket';
import { subscribeToChannel } from './redis/sub';
import { setupVoiceSocket } from './sockets/voiceSocket';
import {setIO} from "./sockets/chatSocket";

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

app.set('socketio', io);
setupChatSocket(io);
subscribeToChannel(io);
setIO(io);
setupVoiceSocket();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));


app.set('socketio', io);
// Routes with middleware
app.use('/api/auth', rateLimiter, authRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/newserver', serverroutes);
app.use('/api/channel', channelroutes);
app.use('/api/roles', roleroutes);
app.use('/api/contact', contactroutes);
app.use('/api/friends',friendroutes)
// Health check endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from echo-backend!', status: 'healthy' });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});