import express from 'express';
import {register,login, sendResetPasswordEmail,updatePassword,refreshToken, logout,testRoute, authorize, handleOAuthUser } from '../controllers/authController';

const router = express.Router();

router.get('/test', testRoute); 
router.post('/refresh', refreshToken);
router.post('/register',register);
router.post('/login',login);
router.get('/logout',logout);
router.post('/forgot-password', sendResetPasswordEmail);
router.post('/reset-password', updatePassword);
router.get('/authorize', authorize);
router.post('/oauth-user', handleOAuthUser);

export default router;
