// POST /servers/:serverId/channels
import express from 'express'
import { 
  createChannel,
  getChannels, 
  joinChannel,
  deleteChannel,
  setChannelRoleAccess,
  getChannelRoleAccess,
  getChannelsWithAccess,
  getChannelPermissions
} from '../controllers/channelController';
import {
  getChannelCategories,
  createChannelCategory,
  updateChannelCategory,
  deleteChannelCategory,
  reorderChannelCategories,
  reorderChannels,
  updateChannel
} from '../controllers/channelCategoryController';
import { authenticate } from '../middleware/authMiddleware';

const route = express.Router();

// Channel category routes
route.get('/:server_id/categories', authenticate, getChannelCategories);
route.post('/:server_id/categories', authenticate, createChannelCategory);
route.put('/:server_id/categories/reorder', authenticate, reorderChannelCategories);
route.put('/:server_id/categories/:category_id', authenticate, updateChannelCategory);
route.delete('/:server_id/categories/:category_id', authenticate, deleteChannelCategory);

// Channel reorder routes
 route.put('/:server_id/channels/reorder', authenticate, reorderChannels);
 route.put('/:server_id/channels/:channel_id', authenticate, updateChannel);
 route.delete('/:server_id/channels/:channel_id', authenticate, deleteChannel);

// Existing routes
route.post('/:server_id/NewChannel', authenticate, createChannel);
route.get('/:server_id/getChannels', authenticate, getChannels);
route.post('/:serverId/joinChannel', authenticate, joinChannel);

// Channel access control routes
route.get('/:server_id/channels-with-access', authenticate, getChannelsWithAccess);
route.post('/:channel_id/role-access', authenticate, setChannelRoleAccess);
route.get('/:channel_id/role-access', authenticate, getChannelRoleAccess);

// Get channel permissions for current user
route.get('/channels/:channelId/permissions', authenticate, getChannelPermissions);

export default route;
