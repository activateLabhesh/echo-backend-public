// POST /servers/:serverId/channels
import express from 'express'
import { 
  createChannel,
  getChannels, 
  joinChannel,
  setChannelRoleAccess,
  getChannelRoleAccess,
  getChannelsWithAccess
} from '../controllers/channelController';
import { authenticate } from '../middleware/authMiddleware';

const route = express.Router();

// Existing routes
route.post('/:server_id/NewChannel', authenticate, createChannel);
route.get('/:server_id/getChannels', authenticate, getChannels);
route.post('/:serverId/joinChannel', authenticate, joinChannel);

// New routes for channel access control
route.get('/:server_id/channels-with-access', authenticate, getChannelsWithAccess);
route.post('/:channel_id/role-access', authenticate, setChannelRoleAccess);
route.get('/:channel_id/role-access', authenticate, getChannelRoleAccess);

export default route;