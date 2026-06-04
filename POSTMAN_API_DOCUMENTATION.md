# Echo Backend API - Postman Documentation

**Base URL**: `http://localhost:5000` or `https://your-production-url.com`

---

## Table of Contents
1. [Authentication](#1-authentication)
2. [Profile Management](#2-profile-management)
3. [Servers](#3-servers)
4. [Channels](#4-channels)
5. [Messages](#5-messages)
6. [Roles](#6-roles)
7. [Friends](#7-friends)
8. [Mentions](#8-mentions)
9. [Contact](#9-contact)

---

## 1. Authentication

### 1.1 Test Route
**GET** `/api/auth/test`

**Description**: Health check for auth routes

**Response** (200):
```json
{
  "message": "Auth route is working"
}
```

---

### 1.2 Register
**POST** `/api/auth/register`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "john_doe",
  "fullname": "John Doe"
}
```

**Success Response** (201):
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "username": "john_doe",
    "fullname": "John Doe"
  }
}
```

**Error Response** (400):
```json
{
  "error": "User already exists"
}
```

---

### 1.3 Login
**POST** `/api/auth/login`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Success Response** (200):
```json
{
  "message": "Login successful",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "username": "john_doe",
    "avatar_url": "https://example.com/avatar.jpg"
  }
}
```

**Error Response** (401):
```json
{
  "error": "Invalid credentials"
}
```

---

### 1.4 Logout
**GET** `/api/auth/logout`

**Success Response** (200):
```json
{
  "message": "Logged out successfully"
}
```

---

### 1.5 Refresh Token
**POST** `/api/auth/refresh`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response** (200):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 1.6 Forgot Password
**POST** `/api/auth/forgot-password`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "email": "user@example.com"
}
```

**Success Response** (200):
```json
{
  "message": "Password reset email sent"
}
```

---

### 1.7 Reset Password
**POST** `/api/auth/reset-password`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "token": "reset-token-here",
  "newPassword": "NewSecurePass123!"
}
```

**Success Response** (200):
```json
{
  "message": "Password updated successfully"
}
```

---

### 1.8 Change Password
**POST** `/api/auth/change-password`

**Headers**:
```
Content-Type: application/json
Authorization: Bearer <access_token>
```

**Body**:
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass123!"
}
```

**Success Response** (200):
```json
{
  "message": "Password changed successfully"
}
```

---

### 1.9 OAuth Authorize
**GET** `/api/auth/authorize`

**Description**: Initiates OAuth flow

**Success Response** (302):
Redirects to OAuth provider

---

### 1.10 OAuth User Handler
**POST** `/api/auth/oauth-user`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "code": "oauth-code-here",
  "provider": "google"
}
```

**Success Response** (200):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "username": "john_doe"
  }
}
```

---

## 2. Profile Management

### 2.1 Get Current User Profile
**GET** `/api/profile/getProfile`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "id": "uuid-here",
  "email": "user@example.com",
  "username": "john_doe",
  "fullname": "John Doe",
  "avatar_url": "https://example.com/avatar.jpg",
  "bio": "Software developer",
  "status": "online",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

---

### 2.2 Get User Profile by ID
**GET** `/api/profile/:userId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `userId` (string, required): UUID of the user

**Success Response** (200):
```json
{
  "id": "uuid-here",
  "username": "jane_doe",
  "fullname": "Jane Doe",
  "avatar_url": "https://example.com/avatar.jpg",
  "bio": "Designer",
  "status": "away"
}
```

---

### 2.3 Update Profile
**PATCH** `/api/profile/updateProfile`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Body** (FormData):
- `username` (string, optional)
- `fullname` (string, optional)
- `bio` (string, optional)
- `avatar` (file, optional): Image file

**Success Response** (200):
```json
{
  "message": "Profile updated successfully",
  "user": {
    "id": "uuid-here",
    "username": "updated_username",
    "fullname": "Updated Name",
    "bio": "Updated bio",
    "avatar_url": "https://example.com/new-avatar.jpg"
  }
}
```

---

### 2.4 Update Status
**PATCH** `/api/profile/updatestatus`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body**:
```json
{
  "status": "away"
}
```

**Valid statuses**: `online`, `away`, `busy`, `offline`

**Success Response** (200):
```json
{
  "message": "Status updated successfully",
  "status": "away"
}
```

---

### 2.5 Delete Profile
**DELETE** `/api/profile/deleteProfile`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "message": "Profile deleted successfully"
}
```

---

### 2.6 Remove Avatar
**DELETE** `/api/profile/removeAvatar`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "message": "Avatar removed successfully"
}
```

---

## 3. Servers

### 3.1 Create Server
**POST** `/api/newserver/create/`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Body** (FormData):
- `name` (string, required): Server name
- `description` (string, optional): Server description
- `icon` (file, optional): Server icon image

**Success Response** (201):
```json
{
  "message": "Server created successfully",
  "server": {
    "id": "uuid-here",
    "name": "My Awesome Server",
    "description": "A great community",
    "icon_url": "https://example.com/server-icon.jpg",
    "owner_id": "uuid-here",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### 3.2 Get User's Servers
**GET** `/api/newserver/getServers/`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "servers": [
    {
      "id": "uuid-here",
      "name": "Server 1",
      "description": "Description",
      "icon_url": "https://example.com/icon.jpg",
      "owner_id": "uuid-here",
      "member_count": 42
    }
  ]
}
```

---

### 3.3 Get Server Details
**GET** `/api/newserver/:serverId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required): UUID of the server

**Success Response** (200):
```json
{
  "id": "uuid-here",
  "name": "My Server",
  "description": "Server description",
  "icon_url": "https://example.com/icon.jpg",
  "owner_id": "uuid-here",
  "created_at": "2024-01-01T00:00:00.000Z",
  "member_count": 42,
  "channels": [
    {
      "id": "channel-uuid",
      "name": "general",
      "type": "text"
    }
  ]
}
```

---

### 3.4 Update Server
**PUT** `/api/newserver/:serverId`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**URL Parameters**:
- `serverId` (string, required): UUID of the server

**Body** (FormData):
- `name` (string, optional)
- `description` (string, optional)
- `icon` (file, optional)

**Success Response** (200):
```json
{
  "message": "Server updated successfully",
  "server": {
    "id": "uuid-here",
    "name": "Updated Server Name",
    "description": "Updated description",
    "icon_url": "https://example.com/new-icon.jpg"
  }
}
```

---

### 3.5 Delete Server
**DELETE** `/api/newserver/:serverId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required): UUID of the server

**Success Response** (200):
```json
{
  "message": "Server deleted successfully"
}
```

**Error Response** (403):
```json
{
  "error": "Only the server owner can delete the server"
}
```

---

### 3.6 Join Server
**POST** `/api/newserver/joinServer/`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body**:
```json
{
  "serverId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Joined server successfully",
  "server": {
    "id": "uuid-here",
    "name": "Server Name"
  }
}
```

---

### 3.7 Join with Invite
**POST** `/api/newserver/joinwithinvite`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body**:
```json
{
  "inviteCode": "ABC123XYZ"
}
```

**Success Response** (200):
```json
{
  "message": "Joined server successfully",
  "server": {
    "id": "uuid-here",
    "name": "Server Name"
  }
}
```

---

### 3.8 Get Server Members
**GET** `/api/newserver/:serverId/members`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "members": [
    {
      "user_id": "uuid-here",
      "username": "john_doe",
      "avatar_url": "https://example.com/avatar.jpg",
      "roles": ["Admin", "Moderator"],
      "joined_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3.9 Get Server Member Details
**GET** `/api/newserver/:serverId/members/:userId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)
- `userId` (string, required)

**Success Response** (200):
```json
{
  "user": {
    "id": "uuid-here",
    "username": "john_doe",
    "fullname": "John Doe",
    "avatar_url": "https://example.com/avatar.jpg",
    "bio": "Developer"
  },
  "roles": [
    {
      "id": "role-uuid",
      "name": "Admin",
      "color": "#FF0000"
    }
  ],
  "joined_at": "2024-01-01T00:00:00.000Z"
}
```

---

### 3.10 Get Server Members with Voice Presence
**GET** `/api/newserver/:serverId/members/voice-presence`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "members": [
    {
      "user_id": "uuid-here",
      "username": "john_doe",
      "avatar_url": "https://example.com/avatar.jpg",
      "in_voice": true,
      "voice_channel_id": "channel-uuid"
    }
  ]
}
```

---

### 3.11 Add User to Server
**POST** `/api/newserver/:serverId/members`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `serverId` (string, required)

**Body**:
```json
{
  "userId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "User added to server successfully"
}
```

---

### 3.12 Kick Member
**DELETE** `/api/newserver/:serverId/members/:userId/kick`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)
- `userId` (string, required)

**Success Response** (200):
```json
{
  "message": "Member kicked successfully"
}
```

**Error Response** (403):
```json
{
  "error": "You don't have permission to kick members"
}
```

---

### 3.13 Ban Member
**POST** `/api/newserver/:serverId/members/:userId/ban`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `serverId` (string, required)
- `userId` (string, required)

**Body**:
```json
{
  "reason": "Violating server rules"
}
```

**Success Response** (200):
```json
{
  "message": "Member banned successfully"
}
```

---

### 3.14 Unban Member
**DELETE** `/api/newserver/:serverId/members/:userId/unban`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)
- `userId` (string, required)

**Success Response** (200):
```json
{
  "message": "Member unbanned successfully"
}
```

---

### 3.15 Get Banned Users
**GET** `/api/newserver/:serverId/bans`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "bans": [
    {
      "user_id": "uuid-here",
      "username": "banned_user",
      "avatar_url": "https://example.com/avatar.jpg",
      "reason": "Violating rules",
      "banned_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3.16 Leave Server
**POST** `/api/newserver/:serverId/leave`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "message": "Left server successfully"
}
```

---

### 3.17 Transfer Ownership
**POST** `/api/newserver/:serverId/transfer-ownership`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `serverId` (string, required)

**Body**:
```json
{
  "newOwnerId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Ownership transferred successfully"
}
```

---

### 3.18 Get Server Invites
**GET** `/api/newserver/:serverId/invites`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "invites": [
    {
      "id": "uuid-here",
      "code": "ABC123XYZ",
      "uses": 5,
      "max_uses": 10,
      "expires_at": "2024-12-31T23:59:59.000Z",
      "created_by": "uuid-here",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3.19 Create Server Invite
**POST** `/api/newserver/:serverId/invites`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `serverId` (string, required)

**Body**:
```json
{
  "maxUses": 10,
  "expiresIn": 86400
}
```

**Success Response** (201):
```json
{
  "message": "Invite created successfully",
  "invite": {
    "id": "uuid-here",
    "code": "ABC123XYZ",
    "max_uses": 10,
    "expires_at": "2024-01-02T00:00:00.000Z"
  }
}
```

---

### 3.20 Delete Invite
**DELETE** `/api/newserver/:serverId/invites/:inviteId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)
- `inviteId` (string, required)

**Success Response** (200):
```json
{
  "message": "Invite deleted successfully"
}
```

---

### 3.21 Search Users by Username
**GET** `/api/newserver/search/users`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `q` (string, required): Search query

**Success Response** (200):
```json
{
  "users": [
    {
      "id": "uuid-here",
      "username": "john_doe",
      "fullname": "John Doe",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  ]
}
```

---

### 3.22 Get Role Members
**GET** `/api/newserver/:serverId/roles/:roleName/members`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)
- `roleName` (string, required)

**Success Response** (200):
```json
{
  "users": [
    {
      "id": "uuid-here",
      "username": "john_doe",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  ]
}
```

---

### 3.23 Get Server Roles
**GET** `/api/newserver/:serverId/roles`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required)

**Success Response** (200):
```json
{
  "roles": [
    {
      "id": "uuid-here",
      "name": "Admin",
      "color": "#FF0000",
      "permissions": ["MANAGE_SERVER", "KICK_MEMBERS"],
      "position": 1
    }
  ]
}
```

---

### 3.24 Invite to Server
**POST** `/api/newserver/invite`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "serverId": "uuid-here",
  "email": "friend@example.com"
}
```

**Success Response** (200):
```json
{
  "message": "Invitation sent successfully"
}
```

---

## 4. Channels

### 4.1 Create Channel
**POST** `/api/channel/:server_id/NewChannel`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "name": "general",
  "type": "text",
  "description": "General discussion"
}
```

**Success Response** (201):
```json
{
  "message": "Channel created successfully",
  "channel": {
    "id": "uuid-here",
    "name": "general",
    "type": "text",
    "description": "General discussion",
    "server_id": "uuid-here",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### 4.2 Edit Channel
**PUT** `/api/channel/:server_id/channels/:channel_id`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)
- `channel_id` (string, required)

**Body**:
```json
{
  "name": "announcements",
  "category_id": "category-uuid-here",
  "position": 2,
  "channel_type": "read_only",
  "allowed_role_ids": [],
  "moderator_role_ids": ["role-uuid-here"]
}
```

All fields are optional, but at least one must be provided.

**Success Response** (200):
```json
{
  "id": "uuid-here",
  "server_id": "server-uuid-here",
  "name": "announcements",
  "type": "text",
  "is_private": false,
  "category_id": "category-uuid-here",
  "position": 2,
  "channel_type": "read_only",
  "allowed_role_ids": [],
  "moderator_role_ids": ["role-uuid-here"]
}
```

**Error Response** (400):
```json
{
  "error": "Invalid channel type. Must be: normal, read_only, or role_restricted"
}
```

---

### 4.3 Get Server Channels
**GET** `/api/channel/:server_id/getChannels`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "channels": [
    {
      "id": "uuid-here",
      "name": "general",
      "type": "text",
      "description": "General discussion",
      "position": 0
    },
    {
      "id": "uuid-here-2",
      "name": "voice-chat",
      "type": "voice",
      "description": "Voice channel",
      "position": 1
    }
  ]
}
```

---

### 4.4 Join Channel
**POST** `/api/channel/:serverId/joinChannel`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `serverId` (string, required)

**Body**:
```json
{
  "channelId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Joined channel successfully"
}
```

---

### 4.5 Get Channels with Access
**GET** `/api/channel/:server_id/channels-with-access`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "channels": [
    {
      "id": "uuid-here",
      "name": "general",
      "type": "text",
      "has_access": true
    },
    {
      "id": "uuid-here-2",
      "name": "admin-only",
      "type": "text",
      "has_access": false
    }
  ]
}
```

---

### 4.6 Set Channel Role Access
**POST** `/api/channel/:channel_id/role-access`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `channel_id` (string, required)

**Body**:
```json
{
  "roleId": "uuid-here",
  "canView": true,
  "canSend": true
}
```

**Success Response** (200):
```json
{
  "message": "Channel access updated successfully"
}
```

---

### 4.7 Get Channel Role Access
**GET** `/api/channel/:channel_id/role-access`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `channel_id` (string, required)

**Success Response** (200):
```json
{
  "access": [
    {
      "role_id": "uuid-here",
      "role_name": "Admin",
      "can_view": true,
      "can_send": true
    }
  ]
}
```

---

## 5. Messages

### 5.1 Send Channel Message
**POST** `/api/message/upload`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Body** (FormData):
- `content` (string, optional): Message text
- `channel_id` (string, required): UUID of channel
- `sender_id` (string, required): UUID of sender
- `reply_to` (string, optional): UUID of message being replied to
- `image` (file, optional): Image file (max 6)
- `file` (file, optional): Any file (max 6)

**Success Response** (200):
```json
{
  "id": "uuid-here",
  "content": "Hello world!",
  "channel_id": "uuid-here",
  "sender_id": "uuid-here",
  "media_url": "https://example.com/file.jpg",
  "reply_to": null,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### 5.2 Send DM Message
**POST** `/api/message/upload_dm`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Body** (FormData):
- `content` (string, optional): Message text
- `sender_id` (string, required): UUID of sender
- `receiver_id` (string, required): UUID of receiver
- `reply_to` (string, optional): UUID of message being replied to
- `image` (file, optional): Image file (max 6)
- `file` (file, optional): Any file (max 6)

**Success Response** (200):
```json
{
  "message": {
    "id": "uuid-here",
    "content": "Hey there!",
    "thread_id": "uuid-here",
    "sender_id": "uuid-here",
    "media_url": null,
    "reply_to": null,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### 5.3 Fetch Channel Messages
**GET** `/api/message/fetch`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `channel_id` (string, required): UUID of channel
- `offset` (number, optional): Pagination offset (default: 0)

**Success Response** (200):
```json
{
  "data": [
    {
      "id": "uuid-here",
      "content": "Hello!",
      "sender_id": "uuid-here",
      "username": "john_doe",
      "sender_avatar_url": "https://example.com/avatar.jpg",
      "media_url": null,
      "timestamp": "2024-01-01T00:00:00.000Z",
      "reply_to_message": {
        "id": "uuid-here-2",
        "content": "Hi there",
        "sender_id": "uuid-here-3",
        "users": {
          "username": "jane_doe",
          "avatar_url": "https://example.com/avatar2.jpg"
        }
      }
    }
  ],
  "hasMore": true,
  "totalCount": 150
}
```

---

### 5.4 Get DM Thread Messages
**GET** `/api/message/dm/:threadId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `threadId` (string, required): UUID of DM thread

**Query Parameters**:
- `offset` (number, optional): Pagination offset (default: 0)

**Success Response** (200):
```json
{
  "data": [
    {
      "id": "uuid-here",
      "content": "Hey!",
      "thread_id": "uuid-here",
      "sender_id": "uuid-here",
      "media_url": null,
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ],
  "hasMore": false,
  "totalCount": 42
}
```

---

### 5.5 Get User DMs
**GET** `/api/message/:userId/getDms`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `userId` (string, required): UUID of user

**Query Parameters**:
- `offset` (number, optional): Pagination offset (default: 0)

**Success Response** (200):
```json
{
  "threads": [
    {
      "thread_id": "uuid-here",
      "recipient_id": "uuid-here",
      "other_user": {
        "id": "uuid-here",
        "username": "jane_doe",
        "avatar_url": "https://example.com/avatar.jpg"
      },
      "messages": [
        {
          "id": "uuid-here",
          "content": "Last message",
          "sender_id": "uuid-here",
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
      ],
      "unread_count": 3,
      "latest_message_timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 5.6 Get Unread Message Counts
**GET** `/api/message/:userId/unread-counts`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `userId` (string, required): UUID of user

**Success Response** (200):
```json
{
  "unreadCounts": {
    "thread-uuid-1": 5,
    "thread-uuid-2": 2
  },
  "totalUnread": 7
}
```

---

### 5.7 Mark Thread as Read
**POST** `/api/message/thread/:threadId/mark-read`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `threadId` (string, required): UUID of thread

**Body**:
```json
{
  "userId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "success": true
}
```

---

## 6. Roles

### 6.1 Get All Roles
**GET** `/api/roles/:server_id/all`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "roles": [
    {
      "id": "uuid-here",
      "name": "Admin",
      "color": "#FF0000",
      "permissions": ["MANAGE_SERVER", "KICK_MEMBERS"],
      "position": 1,
      "is_self_assignable": false
    }
  ]
}
```

---

### 6.2 Get User's Roles in Server
**GET** `/api/roles/:server_id/my-roles`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "roles": [
    {
      "id": "uuid-here",
      "name": "Member",
      "color": "#00FF00"
    }
  ]
}
```

---

### 6.3 Get Self-Assignable Roles
**GET** `/api/roles/:server_id/self-assignable`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "roles": [
    {
      "id": "uuid-here",
      "name": "Gamer",
      "color": "#0000FF",
      "description": "For gaming enthusiasts"
    }
  ]
}
```

---

### 6.4 Self-Assign Role
**POST** `/api/roles/:server_id/self-assign`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "roleId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Role assigned successfully"
}
```

---

### 6.5 Self-Unassign Role
**POST** `/api/roles/:server_id/self-unassign`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "roleId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Role removed successfully"
}
```

---

### 6.6 Create Role
**POST** `/api/roles/:server_id/create`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "name": "Moderator",
  "color": "#00FF00",
  "permissions": ["KICK_MEMBERS", "BAN_MEMBERS"],
  "position": 2,
  "is_self_assignable": false
}
```

**Success Response** (201):
```json
{
  "message": "Role created successfully",
  "role": {
    "id": "uuid-here",
    "name": "Moderator",
    "color": "#00FF00",
    "permissions": ["KICK_MEMBERS", "BAN_MEMBERS"],
    "position": 2
  }
}
```

---

### 6.7 Update Role
**PUT** `/api/roles/:server_id/:role_id/update`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)
- `role_id` (string, required)

**Body**:
```json
{
  "name": "Senior Moderator",
  "color": "#00AA00",
  "permissions": ["KICK_MEMBERS", "BAN_MEMBERS", "MANAGE_MESSAGES"]
}
```

**Success Response** (200):
```json
{
  "message": "Role updated successfully",
  "role": {
    "id": "uuid-here",
    "name": "Senior Moderator",
    "color": "#00AA00"
  }
}
```

---

### 6.8 Delete Role
**DELETE** `/api/roles/:server_id/:role_id/delete`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)
- `role_id` (string, required)

**Success Response** (200):
```json
{
  "message": "Role deleted successfully"
}
```

---

### 6.9 Assign Role to User
**POST** `/api/roles/:server_id/assign-to-user`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "userId": "uuid-here",
  "roleId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Role assigned to user successfully"
}
```

---

### 6.10 Remove Role from User
**POST** `/api/roles/:server_id/remove-from-user`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "userId": "uuid-here",
  "roleId": "uuid-here"
}
```

**Success Response** (200):
```json
{
  "message": "Role removed from user successfully"
}
```

---

### 6.11 Get Role Categories
**GET** `/api/roles/:server_id/categories`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "categories": [
    {
      "id": "uuid-here",
      "name": "Staff Roles",
      "position": 0
    }
  ]
}
```

---

### 6.12 Create Role Category
**POST** `/api/roles/:server_id/categories`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)

**Body**:
```json
{
  "name": "Gaming Roles",
  "position": 1
}
```

**Success Response** (201):
```json
{
  "message": "Category created successfully",
  "category": {
    "id": "uuid-here",
    "name": "Gaming Roles",
    "position": 1
  }
}
```

---

### 6.13 Update Role Category
**PUT** `/api/roles/:server_id/categories/:category_id`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**URL Parameters**:
- `server_id` (string, required)
- `category_id` (string, required)

**Body**:
```json
{
  "name": "Elite Gaming Roles",
  "position": 2
}
```

**Success Response** (200):
```json
{
  "message": "Category updated successfully"
}
```

---

### 6.14 Delete Role Category
**DELETE** `/api/roles/:server_id/categories/:category_id`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `server_id` (string, required)
- `category_id` (string, required)

**Success Response** (200):
```json
{
  "message": "Category deleted successfully"
}
```

---

### 6.15 Get Role Details with Permissions
**GET** `/api/roles/:server_id/view`

**URL Parameters**:
- `server_id` (string, required)

**Success Response** (200):
```json
{
  "roles": [
    {
      "id": "uuid-here",
      "name": "Admin",
      "permissions": {
        "MANAGE_SERVER": true,
        "KICK_MEMBERS": true,
        "BAN_MEMBERS": true
      }
    }
  ]
}
```

---

### 6.16 Get Available Permissions
**GET** `/api/roles/permissions`

**Success Response** (200):
```json
{
  "permissions": [
    "MANAGE_SERVER",
    "MANAGE_ROLES",
    "MANAGE_CHANNELS",
    "KICK_MEMBERS",
    "BAN_MEMBERS",
    "MANAGE_MESSAGES",
    "SEND_MESSAGES",
    "READ_MESSAGES"
  ]
}
```

---

## 7. Friends

### 7.1 Add Friend
**POST** `/api/friends/add_friend`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body**:
```json
{
  "friendUsername": "jane_doe"
}
```

**Success Response** (200):
```json
{
  "message": "Friend request sent successfully"
}
```

**Error Response** (404):
```json
{
  "error": "User not found"
}
```

---

### 7.2 Get Friend Requests
**GET** `/api/friends/friend_requests`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "requests": [
    {
      "id": "uuid-here",
      "sender_id": "uuid-here",
      "sender_username": "john_doe",
      "sender_avatar": "https://example.com/avatar.jpg",
      "status": "pending",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 7.3 Respond to Friend Request
**PUT** `/api/friends/request`

**Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body**:
```json
{
  "requestId": "uuid-here",
  "action": "accept"
}
```

**Valid actions**: `accept`, `reject`

**Success Response** (200):
```json
{
  "message": "Friend request accepted"
}
```

---

### 7.4 Get All Friends
**GET** `/api/friends/all`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "friends": [
    {
      "id": "uuid-here",
      "username": "jane_doe",
      "fullname": "Jane Doe",
      "avatar_url": "https://example.com/avatar.jpg",
      "status": "online",
      "friend_since": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 7.5 Search Friends
**GET** `/api/friends/search`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `q` (string, required): Search query

**Success Response** (200):
```json
{
  "friends": [
    {
      "id": "uuid-here",
      "username": "jane_doe",
      "fullname": "Jane Doe",
      "avatar_url": "https://example.com/avatar.jpg",
      "status": "online"
    }
  ]
}
```

---

## 8. Mentions

### 8.1 Get User Mentions
**GET** `/api/mentions/`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20)
- `unreadOnly` (boolean, optional): Filter unread only (default: false)

**Success Response** (200):
```json
[
  {
    "id": "uuid-here",
    "user_id": "uuid-here",
    "message_id": "uuid-here",
    "is_read": false,
    "created_at": "2024-01-01T00:00:00.000Z",
    "message": {
      "id": "uuid-here",
      "content": "Hey @john_doe, check this out!",
      "sender_id": "uuid-here",
      "channel_id": "uuid-here",
      "users": {
        "username": "jane_doe",
        "avatar_url": "https://example.com/avatar.jpg"
      },
      "channels": {
        "name": "general",
        "server_id": "uuid-here",
        "servers": {
          "name": "My Server"
        }
      }
    }
  }
]
```

---

### 8.2 Mark Mention as Read
**PATCH** `/api/mentions/:mentionId/read`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `mentionId` (string, required): UUID of mention

**Success Response** (200):
```json
{
  "success": true
}
```

**Note**: This automatically deletes the notification after marking as read.

---

### 8.3 Mark All Mentions as Read
**PATCH** `/api/mentions/mark-all-read`

**Headers**:
```
Authorization: Bearer <access_token>
```

**Success Response** (200):
```json
{
  "success": true,
  "updatedCount": 5,
  "markedIds": ["uuid-1", "uuid-2", "uuid-3", "uuid-4", "uuid-5"]
}
```

**Note**: This automatically deletes all read notifications.

---

### 8.4 Search Mentionable Users/Roles
**GET** `/api/mentions/search/:serverId`

**Headers**:
```
Authorization: Bearer <access_token>
```

**URL Parameters**:
- `serverId` (string, required): UUID of server

**Query Parameters**:
- `q` (string, required): Search query
- `type` (string, optional): Filter type (`users`, `roles`, or `all` - default: `all`)

**Success Response** (200):
```json
{
  "users": [
    {
      "id": "uuid-here",
      "username": "john_doe",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  ],
  "roles": [
    {
      "id": "uuid-here",
      "name": "Admin",
      "color": "#FF0000"
    }
  ]
}
```

---

## 9. Contact

### 9.1 Submit Contact Form
**POST** `/api/contact/contact`

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "subject": "Question about features",
  "message": "I would like to know more about..."
}
```

**Success Response** (200):
```json
{
  "message": "Contact form submitted successfully"
}
```

---

## Common Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request data",
  "details": "Missing required field: username"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Please login to continue"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "You don't have permission to perform this action"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Something went wrong on our end"
}
```

---

## WebSocket Events

### Connection
**URL**: `ws://localhost:5000/socket.io/`

**Authentication**: Pass JWT token in query params or headers

### Events

#### 1. Join Room
**Emit**: `join_room`
```json
{
  "channelId": "uuid-here"
}
```

#### 2. New Message
**Listen**: `new_message`
```json
{
  "id": "uuid-here",
  "content": "Hello!",
  "sender_id": "uuid-here",
  "channel_id": "uuid-here",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "reply_to_message": {
    "id": "uuid-here",
    "content": "Hi there",
    "users": {
      "username": "jane_doe"
    }
  }
}
```

#### 3. Receive DM
**Listen**: `receive_dm`
```json
{
  "id": "uuid-here",
  "content": "Private message",
  "sender_id": "uuid-here",
  "thread_id": "uuid-here",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### 4. User Status Change
**Listen**: `user_status_changed`
```json
{
  "userId": "uuid-here",
  "status": "online"
}
```

---

## Postman Collection Setup

### Environment Variables
Create an environment with the following variables:

```
BASE_URL: http://localhost:5000
ACCESS_TOKEN: <your-jwt-token>
REFRESH_TOKEN: <your-refresh-token>
USER_ID: <your-user-id>
SERVER_ID: <test-server-id>
CHANNEL_ID: <test-channel-id>
```

### Pre-request Scripts (for authenticated routes)
Add this to collection-level pre-request:

```javascript
pm.environment.set("ACCESS_TOKEN", pm.environment.get("ACCESS_TOKEN"));
```

### Tests (for login routes)
Add this to login request tests:

```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    pm.environment.set("ACCESS_TOKEN", response.access_token);
    pm.environment.set("REFRESH_TOKEN", response.refresh_token);
    pm.environment.set("USER_ID", response.user.id);
}
```

---

## Rate Limiting

The `/api/auth` routes have rate limiting enabled:
- **Window**: 15 minutes
- **Max Requests**: 100 per window per IP

If you exceed the limit, you'll receive:

**Response** (429):
```json
{
  "error": "Too many requests",
  "message": "Please try again later"
}
```

---

## File Upload Guidelines

### Supported File Types
- **Images**: JPEG, PNG, GIF, WebP, BMP, SVG
- **Documents**: TXT, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JSON
- **Archives**: ZIP

### Size Limits
- **Images**: 10MB per file
- **Other files**: 10MB per file
- **Maximum files per upload**: 6

### Upload Format
Use `multipart/form-data` with fields:
- `image`: For image uploads
- `file`: For other file types

---

## Pagination

Many list endpoints support pagination:

**Query Parameters**:
- `offset` (number): Starting position (default: 0)
- `limit` (number): Items per page (default: 15-20)

**Response Structure**:
```json
{
  "data": [...],
  "hasMore": true,
  "totalCount": 150
}
```

---

## Testing Tips

1. **Start with Authentication**: Login first to get your access token
2. **Create Test Data**: Create a server → Create channels → Send messages
3. **Test Permissions**: Try actions with different user roles
4. **Test File Uploads**: Use small files first
5. **Test WebSocket**: Use socket.io client or Postman WebSocket
6. **Check Error Cases**: Try invalid IDs, missing fields, etc.

---

**Last Updated**: January 17, 2026
**API Version**: 1.0.0
**Support**: contact@echo.com
