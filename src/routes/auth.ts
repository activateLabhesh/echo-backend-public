import express from 'express';
import {register,login, handleGoogleOAuth,sendResetPasswordEmail,updatePassword,refreshToken, logout,testRoute, changePassword, authorize, handleOAuthUser } from '../controllers/authController';

const router = express.Router();

router.get('/test', testRoute); 
router.post('/refresh', refreshToken);
router.post('/register',register);
router.post('/login',login);
router.get('/logout',logout);
router.post('/forgot-password', sendResetPasswordEmail);
router.post('/reset-password', updatePassword);
router.post('/change-password', changePassword);
router.get('/authorize', authorize);
router.post('/google-oauth', handleGoogleOAuth);
router.post('/oauth-user', handleOAuthUser);

export default router;
