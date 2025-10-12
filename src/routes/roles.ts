// At the very top of your roleRoutes.ts file
console.log("--- roleRoutes.ts file has been loaded by the server ---");
 
import {
  getRoleDetailsWithPermissions,
  addRole, 
  editRole, 
  assignRole,
  deleteRole,
  removeRoleFromUser,
  getAvailablePermissions
} from '../controllers/roleController';
import express from 'express';
import { authenticate } from '../middleware/authMiddleware';

const route = express.Router();

// Existing routes
route.get('/:server_id/view', getRoleDetailsWithPermissions);
route.post('/:server_id/Add_Role', authenticate, addRole);
route.post('/:server_id/:role_id/Edit_Role', authenticate, editRole);
route.post('/:server_id/Assign_Role', authenticate, assignRole);

// New routes
route.delete('/:server_id/:role_id', authenticate, deleteRole);
route.post('/:server_id/Remove_Role', authenticate, removeRoleFromUser);
route.get('/permissions', getAvailablePermissions);
export default route;