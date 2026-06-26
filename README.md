# Echo Backend

Echo is a comprehensive, Discord-inspired real-time communication platform engineered specifically for internal chapter operations. This repository contains the robust Node.js backend API built to handle seamless text messaging, voice/video calls, and real-time collaboration.

### Tech Stack
- **Framework:** Node.js, Express, TypeScript
- **Real-Time Communication:** Socket.io, Redis (Adapter & Caching)
- **Database & Storage:** PostgreSQL, Supabase
- **Authentication:** JWT & OAuth 2.0 (Supabase Auth)
- **Media:** LiveKit (WebRTC) for Voice & Video


## Local Development

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Fill in your environment variables in `.env`

4. Start the development server:
```bash
npm run dev
```

The server will run at `http://localhost:5000`

## API Routes

Here is an overview of the core REST endpoints available in the backend:

### Authentication (`/api/auth`)
- `POST /register`, `POST /login`, `GET /logout`, `POST /refresh` - Core user authentication
- `POST /forgot-password`, `POST /reset-password`, `POST /change-password` - Password management
- `GET /authorize`, `POST /oauth-user` - OAuth integrations

### Profiles & Users (`/api/profile`)
- `GET /getProfile`, `GET /:userId` - Fetch user details
- `PATCH /updateProfile`, `PATCH /updatestatus` - Update user information and online status
- `DELETE /deleteProfile`, `DELETE /removeAvatar` - Account management

### Friends & Connections (`/api/friend`)
- `POST /add_friend`, `GET /friend_requests`, `PUT /request` - Friend request management
- `GET /all`, `GET /search` - Fetch and search friends list

### Servers & Roles (`/api/servers`)
- `POST /create`, `GET /getServers`, `POST /joinServer`, `POST /joinwithinvite` - Server management
- `GET /:serverId/members`, `POST /:serverId/members` - Member listing and addition
- `DELETE /.../kick`, `POST /.../ban`, `DELETE /.../unban` - Moderation tools
- `POST /:serverId/leave`, `POST /:serverId/transfer-ownership` - Ownership and leaving
- `GET /:serverId/roles/:roleName/members` - Role-Based Access Control querying

### Messaging & Channels (`/api/message`)
- `GET /fetch` - Fetch channel messages
- `GET /dm/:threadId`, `GET /:userId/getDms` - Direct Message retrieval
- `POST /upload`, `POST /upload_dm` - Send messages with file/image attachments
- `GET /:userId/unread-counts`, `POST /thread/:threadId/mark-read` - Unread tracking

### Mentions (`/api/mentions`)
- `GET /` - Fetch mentions for the current user
- `PATCH /mark-all-read`, `PATCH /:mentionId/read` - Acknowledge mentions
- `GET /search/:serverId` - Search for mentionable users inside a server

## Build Commands

- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run dev` - Start development server

