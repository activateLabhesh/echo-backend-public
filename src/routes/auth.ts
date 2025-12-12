import express from 'express';
import {register,login, sendResetPasswordEmail,updatePassword,refreshToken, logout,testRoute,changePassword, authorize } from '../controllers/authController';
import { oauthSync } from '../controllers/oauthController';
const router = express.Router();

router.get('/test', testRoute); 
router.post('/refresh', refreshToken);
router.post('/register',register);
router.post('/login',login);
router.get('/logout',logout);
router.post('/forgot-password', sendResetPasswordEmail);
router.post('/reset-password', updatePassword);
router.post('/change-password', async (req, res, next) => {
    try {
        await changePassword(req, res);
    } catch (err) {
        next(err);
    }
});
router.post('/oauth-sync', async (req, res, next) => {
    try {
        await oauthSync(req, res);
    } catch (err) {
        next(err);
    }
});router.get('/authorize', authorize);

export default router;
