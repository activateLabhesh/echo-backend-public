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
import friendroutes from "./routes/friend";
import mentionRoutes from "./routes/mentions";
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

import { rateLimiter } from './middleware/rateLimiter';
import { setupChatSocket } from './sockets/chatSocket';
import { subscribeToChannel } from './redis/sub';
import { setupVoiceSocket } from './sockets/voiceSocket';
import {setIO} from "./sockets/chatSocket";

const app = express();
const httpServer = http.createServer(app);
const pubClient = createClient({url: process.env.REDIS_URL});
const subClient = pubClient.duplicate();

pubClient.connect();
subClient.connect();


// Parse allowed origins from env (supports multiple comma-separated origins)
const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(url => url.trim()) || [
  'http://localhost:3000',
  'https://echo-web-lemon.vercel.app',
  'https://echo.ieeecsvit.com'
];

const io = new Server(httpServer, {
  adapter: createAdapter(pubClient,subClient),
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true
  },
  path: '/socket.io/',
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8,
  allowUpgrades: true,
  perMessageDeflate: false,
  httpCompression: false
});


io.engine.on("connection",(rawSocket) => {
  rawSocket.request = null;
})

app.set('socketio', io);
setupChatSocket(io);
subscribeToChannel(io);
setIO(io);
setupVoiceSocket();

// Middleware
app.use(express.json());
app.use(cookieParser());
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type'],
};

app.use(cors(corsOptions));

// Routes with middleware
app.use('/api/auth', authRoutes);
app.use('/api/message', rateLimiter, messageRoutes);
app.use('/api/profile', rateLimiter, profileRoutes);
app.use('/api/newserver', rateLimiter, serverroutes);
app.use('/api/channel', rateLimiter, channelroutes);
app.use('/api/roles', rateLimiter, roleroutes);
app.use('/api/contact', rateLimiter, contactroutes);
app.use('/api/friends', rateLimiter, friendroutes);
app.use('/api/mentions', rateLimiter, mentionRoutes);
// Health check endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from echo-backend!', status: 'healthy' });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
