import dotenv from 'dotenv';
dotenv.config();

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, Response } from 'express';
import http from 'http';

import { createClient } from 'redis';
import authRoutes from './routes/auth';
import channelroutes from './routes/channel';
import contactroutes from "./routes/contact";
import friendroutes from "./routes/friend";
import mentionRoutes from "./routes/mentions";
import messageRoutes from './routes/message';
import notificationRoutes from "./routes/notifications";
import profileRoutes from './routes/profile';
import roleroutes from './routes/roles';
import serverroutes from './routes/servers';

import { rateLimiter } from './middleware/rateLimiter';

//Socket imports
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { subscribeToChannel } from './redis/sub';
import { setIO, setupChatSocket } from './sockets/chatSocket';
import { setupVoiceSocket } from './sockets/voiceSocket';


const app = express();
const httpServer = http.createServer(app);
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

pubClient.connect();
subClient.connect();


// Parse allowed origins from env (supports multiple comma-separated origins)
const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(url => url.trim()) || [
  'http://localhost:3000',
  'https://echo-web-lemon.vercel.app',
  'https://echo.ieeecsvit.com',
  'http://10.0.2.2:5000',
  'http://192.168.1.7:8081'
];

const io = new Server(httpServer, {
  adapter: createAdapter(pubClient, subClient),
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


io.engine.on("connection", (rawSocket) => {
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
app.use('/api/auth', rateLimiter, authRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/newserver', serverroutes);
app.use('/api/channel', channelroutes);
app.use('/api/roles', roleroutes);
app.use('/api/contact', contactroutes);
app.use('/api/friends', friendroutes);
app.use('/api/mentions', mentionRoutes);
app.use('/api/notifications', notificationRoutes);
// Health check endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from echo-backend!', status: 'healthy' });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});