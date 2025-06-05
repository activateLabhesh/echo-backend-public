import { Request, Response } from 'express';
import {supabase,supabaseAdmin} from '../client/supabase'

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, 
};

//test route
export const testRoute = (_req: Request, res: Response) => {
  console.log("Test route hit");
  res.status(200).json({ message: 'Test route is working!' });
};

//register route
export const register = async (req: Request, res: Response): Promise <void> => {
  const { email, password ,username } = req.body;
  console.log('Registering user:', { email, password ,username});

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error || !signUpData?.user?.id) {
    res.status(400).json({ message: error?.message });
    return
  }
  const userId = signUpData.user.id;

  const { error: insertError } = await supabaseAdmin
  .from('User')
  .insert([
    {
      id: userId,
      email,
      username,
      passwordHash: '',
      avatarUrl: null,
      status: 'offline',
    },
  ]);

  if (insertError) {
    console.error('Insert error:', insertError.message);
    res.status(500).json({ message: 'Insert Error. Check console ' });
    return
  }

  res.status(201).json({ message: 'User registered.' });
};

// login route
export const login = async (req: Request, res: Response):Promise <void> => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    res.status(401).json({ message: error?.message || 'Login failed' });
    return
  }

  const { access_token, refresh_token, user } = data.session;

  res.cookie('access_token', access_token, cookieOptions);
  res.cookie('refresh_token', refresh_token, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });

  res.status(200).json({ message: 'Logged in', user });
};

//refresh tokens
export const refreshToken = async (req: Request, res: Response): Promise <void> => {
  const refresh_token = req.cookies.refresh_token;

  if (!refresh_token) {
    res.status(401).json({ message: 'Refresh token missing' });
    return
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return
  }

  const { access_token, refresh_token: newRefreshToken } = data.session;

  res.cookie('access_token', access_token, cookieOptions);
  res.cookie('refresh_token', newRefreshToken, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });

  res.status(200).json({ message: 'Token refreshed' });
};

//logout route
export const logout = async (req: Request, res: Response): Promise<void> => {
  const accessToken = req.cookies.access_token;

  if (!accessToken) {
    res.status(400).json({ message: 'Already logged out or no token found' });
    return;
  }

  try {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Logout failed', error: (err as Error).message });
  }
};