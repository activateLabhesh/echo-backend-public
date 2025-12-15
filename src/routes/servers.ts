
import { Router } from 'express';
import * as serverController from '../controllers/serverController';
import express from 'express';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
import { authenticate } from '../middleware/authMiddleware';
import { 
  screation, 
  getServers, 
  joinServer, 
  inviteToServer, 
  joinWithInvite,
  updateServer,
  getServerDetails,
  getServerMembers,
  getServerMembersWithVoicePresence,
  kickMember,
  banMember,
  leaveServer,
  deleteServer,
  transferOwnership,
  getServerInvites,
  deleteInvite,
  createServerInvite,
  searchUsersByUsername,
  addUserToServer,
  getBannedUsers,
  unbanUser
} from '../controllers/serverController';
import { busboyMiddleware } from '../middleware/busboyMiddleware';

const router = Router();

router.post('/create/', authenticate,busboyMiddleware, screation);
// Existing routes
router.post('/create/', authenticate, busboyMiddleware, screation);
router.get('/getServers/', authenticate, getServers);
router.post('/joinServer/', authenticate, joinServer);
router.post('/joinwithinvite', authenticate, joinWithInvite);
router.post('/invite', inviteToServer);

// More specific routes should come before generic parameterized routes
// User search route
router.get('/search/users', authenticate, searchUsersByUsername);

// Server-specific routes with additional path segments (more specific)
router.get('/:serverId/members', authenticate, getServerMembers);
router.get('/:serverId/members/voice-presence', authenticate, getServerMembersWithVoicePresence);
router.post('/:serverId/members', authenticate, addUserToServer);
router.delete('/:serverId/members/:userId/kick', authenticate, kickMember);
router.post('/:serverId/members/:userId/ban', authenticate, banMember);
router.delete('/:serverId/members/:userId/unban', authenticate, unbanUser);
router.get('/:serverId/bans', authenticate, getBannedUsers);
router.post('/:serverId/leave', authenticate, leaveServer);
router.post('/:serverId/transfer-ownership', authenticate, transferOwnership);

// Invite management routes
router.get('/:serverId/invites', authenticate, getServerInvites);
router.post('/:serverId/invites', authenticate, createServerInvite);
router.delete('/:serverId/invites/:inviteId', authenticate, deleteInvite);

// Generic server management routes (should come last)
router.get('/:serverId', authenticate, getServerDetails);
router.put('/:serverId', authenticate, busboyMiddleware, updateServer);
router.delete('/:serverId', authenticate, deleteServer);

export default router;
