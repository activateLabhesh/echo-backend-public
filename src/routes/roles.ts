// At the very top of your roleRoutes.ts file
console.log("--- roleRoutes.ts file has been loaded by the server ---");
 
import {
  getRoleDetailsWithPermissions,
  addRole, 
  editRole, 
  assignRole,
  deleteRole,
  removeRoleFromUser,
  getAvailablePermissions,
  // New imports for RBAC
  getAllRoles,
  getSelfAssignableRoles,
  selfAssignRole,
  selfUnassignRole,
  getUserRolesInServer,
  createNewRole,
  updateExistingRole,
  deleteExistingRole,
  assignRoleToUser,
  removeRoleFromMember,
  getRoleCategories,
  createRoleCategory,
  updateRoleCategory,
  deleteRoleCategory,
  checkOwnerOrAdmin
} from '../controllers/roleController';
import express from 'express';
import { authenticate } from '../middleware/authMiddleware';

const route = express.Router();

// Get all roles for a server (any member)
route.get('/:server_id/all', authenticate, getAllRoles);

// Get user's own roles in a server
route.get('/:server_id/my-roles', authenticate, getUserRolesInServer);

// Self-assignable roles (any member)
route.get('/:server_id/self-assignable', authenticate, getSelfAssignableRoles);
route.post('/:server_id/self-assign', authenticate, selfAssignRole);
route.post('/:server_id/self-unassign', authenticate, selfUnassignRole);

// Role CRUD (Owner/Admin)
route.post('/:server_id/create', authenticate, createNewRole);
route.put('/:server_id/:role_id/update', authenticate, updateExistingRole);
route.delete('/:server_id/:role_id/delete', authenticate, deleteExistingRole);

// Assign/Remove roles from members (Owner/Admin)
route.post('/:server_id/assign-to-user', authenticate, assignRoleToUser);
route.post('/:server_id/remove-from-user', authenticate, removeRoleFromMember);

// Role Categories (Owner/Admin)
route.get('/:server_id/categories', authenticate, getRoleCategories);
route.post('/:server_id/categories', authenticate, createRoleCategory);
route.put('/:server_id/categories/:category_id', authenticate, updateRoleCategory);
route.delete('/:server_id/categories/:category_id', authenticate, deleteRoleCategory);

// Existing routes (kept for backward compatibility)
route.get('/:server_id/view', getRoleDetailsWithPermissions);
route.post('/:server_id/Add_Role', authenticate, addRole);
route.post('/:server_id/:role_id/Edit_Role', authenticate, editRole);
route.post('/:server_id/Assign_Role', authenticate, assignRole);

// Old routes
route.delete('/:server_id/:role_id', authenticate, deleteRole);
route.post('/:server_id/Remove_Role', authenticate, removeRoleFromUser);
route.get('/permissions', getAvailablePermissions);

export default route;