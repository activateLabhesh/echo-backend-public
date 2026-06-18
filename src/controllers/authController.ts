import { Request, Response } from 'express';
import {supabase,supabaseAdmin} from '../client/supabase'

// Access token expires in 1 hour (matches Supabase JWT expiration)
const ACCESS_TOKEN_MAX_AGE = 60 * 60; // 1 hour in seconds
// Refresh token expires in 30 days
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds

const MOBILE_INACTIVITY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MOBILE_LAST_SEEN_COLUMNS = ['mobile_last_seen_at', 'mobileLastSeenAt'] as const;
const USER_PROFILE_FIELDS = 'id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at';

// Frontend URL for redirects (configurable via env)
const FRONTEND_URL = process.env.FRONTEND_URL?.split(',')[0]?.trim();

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: ACCESS_TOKEN_MAX_AGE,
};

const readMobileLastSeenAt = async (userId: string): Promise<string | null> => {
  for (const column of MOBILE_LAST_SEEN_COLUMNS) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select(column)
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) continue;

    const value = (data as Record<string, unknown>)[column];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
};

const updateMobileLastSeenAt = async (
  userId: string,
  timestampIso: string,
): Promise<boolean> => {
  for (const column of MOBILE_LAST_SEEN_COLUMNS) {
    const { error } = await supabaseAdmin
      .from('users')
      .update({ [column]: timestampIso } as Record<string, string>)
      .eq('id', userId);

    if (!error) return true;
  }

  return false;
};

const isIdleTooLong = (mobileLastSeenAtIso: string, nowMs: number): boolean => {
  const thenMs = Date.parse(mobileLastSeenAtIso);
  if (Number.isNaN(thenMs)) return false;
  return nowMs - thenMs > MOBILE_INACTIVITY_MAX_AGE_MS;
};

const recordMobileActivity = async (userId: string): Promise<void> => {
  await updateMobileLastSeenAt(userId, new Date().toISOString());
};

const verifyMobileActivityWindow = async (userId: string): Promise<boolean> => {
  const mobileLastSeenAt = await readMobileLastSeenAt(userId);

  if (mobileLastSeenAt && isIdleTooLong(mobileLastSeenAt, Date.now())) {
    return false;
  }

  await recordMobileActivity(userId);
  return true;
};

const fetchUserProfile = async (userId: string): Promise<any | null> => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(USER_PROFILE_FIELDS)
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
};


//test route
export const testRoute = (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Test route is working!' });
};

//register route
export const register = async (req: Request, res: Response): Promise <void> => {
  const { email, password ,username, fullname, date_of_birth} = req.body;

  const { data: existingEmail } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('email', email)
  .maybeSingle();

  if (existingEmail) {
    //409 error is for conflicting request
  res.status(409).json({ message: 'Conflict in data: User already registered' });
  return
  }

  const { data: existingUsername } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('username', username)
  .maybeSingle();

  if (existingUsername) {
  res.status(409).json({ message: 'Conflict in data: Username already taken' });
  return
  }

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${FRONTEND_URL}/auth/callback?next=/login`,
    },
  });

  if (error || !signUpData?.user?.id) {
    res.status(400).json({ message: `$Bad Request Message: ${error?.message}` });
    return
  }
  const userId = signUpData.user.id;

  const { error: insertError } = await supabaseAdmin
  .from('users')
  .insert([
    {
      id: userId,
      email,
      username,
      fullname,
      date_of_birth,
      avatar_url: null,
      status: 'offline',
      bio:'', //present in supabase
    },
  ]);

  if (insertError) {

    res.status(500).json({ message: `Insert Error. ${insertError.message}` });
    return
  }

  res.status(201).json({ message: 'User registered.' });
};

// login route
export const login = async (req: Request, res: Response):Promise <void> => {
  const { identifier, password } = req.body;
  const isMobileApp = req.headers['x-client-type'] === 'Mobile'; //checks where the request is from

  let email =identifier;
  //check if identifier is not email, then it is username. search database for that username and extract email from it
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('username', identifier)
      .single();

    if (error || !data) {
      res.status(400).json({ message: 'Invalid username or user not found' });
      return;
    }

    email = data.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    res.status(401).json({ message: error?.message || 'Unauthorized: Login failed' });
    return
  }

  const { access_token, refresh_token, user } = data.session;

  const { data: userDetails, error: fetchError } = await supabaseAdmin
  .from('users')
  .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status,created_at')
  .eq('id', user.id)
  .maybeSingle();

if (fetchError || !userDetails) {
  res.status(500).json({ message: 'Failed to fetch user profile details' });
  return;
}

  if(isMobileApp){
    await recordMobileActivity(user.id);

    res.status(200).json({
      message : "Logged In",
      user: userDetails,
      accessToken:access_token,
      refreshToken:refresh_token,
      expiresIn: data.session.expires_in,
    })
  } else{
    res.cookie('access_token', access_token, cookieOptions);
    res.cookie('refresh_token', refresh_token, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    res.status(200).json({ 
      message: 'Logged in', 
      user: userDetails,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: data.session.expires_in
    });
  }
};

//refresh tokens
export const refreshToken = async (req: Request, res: Response): Promise <void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';

  let refresh_token: string | undefined;

  // Support hybrid approach: try body first (both snake_case and camelCase), then cookies
  // This allows both mobile and web clients to send refresh token in body as fallback
  // Safely access req.body properties in case body is undefined
  refresh_token = req.body?.refresh_token || 
                  req.body?.refreshToken || 
                  req.cookies?.refresh_token;

  if (!refresh_token) {
    res.status(401).json({ message: 'Refresh token missing' });
    return
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return
  }

  const { access_token, refresh_token: newRefreshToken, user } = data.session;
  
  if (isMobileApp) {
    const mobileUserId = user?.id;

    if (typeof mobileUserId !== 'string' || mobileUserId.length === 0) {
      res.status(401).json({ message: 'Invalid refresh session' });
      return;
    }

    const isMobileSessionActive = await verifyMobileActivityWindow(mobileUserId);

    if (!isMobileSessionActive) {
      res.status(401).json({
        message: 'Session expired due to inactivity.',
        code: 'SESSION_INACTIVE',
      });
      return;
    }

    const refreshedUser = await fetchUserProfile(mobileUserId);

    res.status(200).json({
      message: 'Token refreshed',
      accessToken: access_token,
      refreshToken: newRefreshToken,
      user: refreshedUser || user,
      expiresIn: data.session.expires_in  
    });
  } else {
    res.cookie('access_token', access_token, cookieOptions);
    res.cookie('refresh_token', newRefreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    res.status(200).json({ 
      message: 'Token refreshed',
      accessToken: access_token,
      refreshToken: newRefreshToken,
      expiresIn: data.session.expires_in
    });
  }
};

//logout route
export const logout = async (req: Request, res: Response): Promise<void> => {
  // Standardize mobile header check (lowercase header name)
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';
  if(isMobileApp){
    res.status(200).json({ message: 'Logged out successfully' });
    return;
  }
  
  // Check for token in cookies or Authorization header
  const accessToken = req.cookies.access_token || 
    (req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.substring(7) 
      : null);

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

//send reset password link
export const sendResetPasswordEmail = async (req: Request, res: Response):Promise<void> => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ message: 'Email is required to reset password' });
    return
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${FRONTEND_URL}/reset-password`, 
  });

  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password reset email sent' });
  return
};

//update password using reset session
export const updatePassword = async (req: Request, res: Response):Promise<void> => {
  const authHeader = req.headers['authorization'];
  const access_token = authHeader?.split(' ')[1];
  const { new_password } = req.body;

  if (!access_token || !new_password) {
    res.status(400).json({ message: 'Access token and new password are required' });
    return
  }

  //extract user id from the token
  let userId: string;
  try {
    const { data: userData, error } = await supabase.auth.getUser(access_token);
    if (error || !userData?.user) {
      res.status(400).json({ message: 'Invalid access token' });
      return;
    }
    userId = userData.user.id;
  } catch (err) {
    res.status(400).json({ message: 'Invalid access token' });
    return;
  }

  //update password using admin 
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: new_password,
  });

  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password updated successfully' });
  return
};

// change password for logged-in users
export const changePassword = async (req: Request, res: Response): Promise<void> => {

  const authHeader = req.headers['authorization'];
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const cookieToken = req.cookies?.access_token;
  const access_token = headerToken || cookieToken;

  const { new_password } = req.body;

  if (!access_token || !new_password) {
    res.status(400).json({ message: 'Access token and new password are required' });
    return;
  }

  // Validate token with Supabase and extract user id
  let userId: string;
  try {
    const { data: userData, error } = await supabase.auth.getUser(access_token);
    if (error || !userData?.user) {
      res.status(401).json({ message: 'Invalid or expired access token' });
      return;
    }
    userId = userData.user.id;
  } catch (err) {
    res.status(401).json({ message: 'Invalid access token' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: new_password,
    });

    if (error) {

      res.status(400).json({ message: error.message || 'Failed to change password' });
      return;
    }

    res.status(200).json({ message: 'Password changed successfully' });
    return;
  } catch (err: any) {

    res.status(500).json({ message: 'Server error' });
  }
};

export const authorize = async (req: Request, res: Response): Promise<void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';
  const authHeader = req.headers['authorization'];
  const accessToken = authHeader?.split(' ')[1];

  if (!accessToken) {
    res.status(401).json({ message: 'Access token missing' });
    return;
  }

  try {
    const { data: userData, error } = await supabase.auth.getUser(accessToken);

    if (error || !userData.user) {

      res.status(401).json({ message: 'Unauthorized: Invalid or expired access token.' });
      return;
    }

    if (isMobileApp) {
      const isMobileSessionActive = await verifyMobileActivityWindow(userData.user.id);

      if (!isMobileSessionActive) {
        res.status(401).json({
          message: 'Session expired due to inactivity.',
          code: 'SESSION_INACTIVE',
        });
        return;
      }
    }

    res.status(200).json({
      authenticated: true,
      user: {
        id: userData.user.id,
        email: userData.user.email,
      }
    });

  } catch (err: any) {

    // Catch any unexpected errors during token processing
    res.status(500).json({ message: 'Internal server error during authorization.' });
  }
};

//handle OAuth user (Google, etc.)
export const handleOAuthUser = async (req: Request, res: Response): Promise<void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';
  const authHeader = req.headers.authorization;
  const access_token = authHeader?.split(' ')[1];
  // Get refresh token from request body (sent by frontend after Supabase OAuth)
  const refresh_token = req.body.refresh_token || req.body.refreshToken || '';

  if (!access_token) {
    res.status(401).json({ message: 'Access token required' });
    return;
  }

  try {
    // Get user from Supabase auth
    const { data: userData, error: userError } = await supabase.auth.getUser(access_token);

    if (userError || !userData?.user) {

      res.status(401).json({ message: 'Invalid access token' });
      return;
    }

    const supabaseUser = userData.user;

    // Check if user exists in our users table by ID
    let { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
      .eq('id', supabaseUser.id)
      .maybeSingle();

    if (fetchError) {

    }

    // If not found by ID, check by email (user might have registered with email/password before)
    if (!existingUser && supabaseUser.email) {
      const { data: emailUser, error: emailError } = await supabaseAdmin
        .from('users')
        .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
        .eq('email', supabaseUser.email)
        .maybeSingle();

      if (emailError) {

      }

      if (emailUser) {

        // Update the existing user's ID to match the new Supabase OAuth ID
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ id: supabaseUser.id })
          .eq('email', supabaseUser.email);

        if (updateError) {

          // If we can't update the ID, just use the existing user data
          existingUser = emailUser;
        } else {
          // Fetch the updated user
          const { data: updatedUser } = await supabaseAdmin
            .from('users')
            .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
            .eq('id', supabaseUser.id)
            .maybeSingle();
          
          existingUser = updatedUser || emailUser;

        }
      }
    }

    let userDetails = existingUser;

    // If user doesn't exist, create them
    if (!existingUser) {


      // Generate username from email or OAuth name
      let username = supabaseUser.user_metadata?.full_name?.replace(/\s+/g, '_').toLowerCase() 
                     || supabaseUser.email?.split('@')[0] 
                     || `user_${Date.now()}`;

      // Check if username already exists
      const { data: usernameCheck } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      // If username exists, append random numbers
      if (usernameCheck) {
        username = `${username}_${Math.floor(Math.random() * 9999)}`;
      }

      const newUser = {
        id: supabaseUser.id,
        email: supabaseUser.email,
        username: username,
        fullname: supabaseUser.user_metadata?.full_name || '',
        avatar_url: supabaseUser.user_metadata?.avatar_url || null,
        status: 'offline',
        bio: '',
        date_of_birth: null,
      };

      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert([newUser]);

      if (insertError) {

        res.status(500).json({ message: 'Failed to create user record' });
        return;
      }

      // Fetch the newly created user
      const { data: newUserData } = await supabaseAdmin
        .from('users')
        .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
        .eq('id', supabaseUser.id)
        .maybeSingle();

      userDetails = newUserData;

    } else {
      
      // Optionally update avatar if user doesn't have one
      if (!existingUser.avatar_url && supabaseUser.user_metadata?.avatar_url) {
        await supabaseAdmin
          .from('users')
          .update({ avatar_url: supabaseUser.user_metadata.avatar_url })
          .eq('id', supabaseUser.id);
        
        userDetails = { ...existingUser, avatar_url: supabaseUser.user_metadata.avatar_url };
      }
    }

    // Use refresh token from request body (passed by frontend from Supabase session)
    // Note: Server-side supabase.auth.getSession() won't have the user's session

    if (isMobileApp) {
      await recordMobileActivity(supabaseUser.id);

      res.status(200).json({
        message: 'OAuth login successful',
        user: userDetails,
        accessToken: access_token,
        refreshToken: refresh_token,
        isNewUser: !existingUser,
      });
    } else {
      res.cookie('access_token', access_token, cookieOptions);
      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          ...cookieOptions,
          maxAge: REFRESH_TOKEN_MAX_AGE,
        });
      }
      res.status(200).json({
        message: 'OAuth login successful',
        user: userDetails,
        accessToken: access_token,
        refreshToken: refresh_token,
        isNewUser: !existingUser,
      });
    }

  } catch (err: any) {

    res.status(500).json({ message: 'Server error during OAuth login' });
  }
};


export const handleGoogleOAuth = async (req: Request, res: Response): Promise<void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';
  const idToken: string | undefined = req.body?.idToken || req.body?.googleIdToken;

  const USER_FIELDS = 'id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at';

  if (!idToken) {
    res.status(400).json({ message: 'Google ID token required' });
    return;
  }

  try {
    // 1. Decode Google ID token to extract user info
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      res.status(400).json({ message: 'Invalid Google ID token format' });
      return;
    }

    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    const { email, sub: googleId, name, picture } = decoded;

    if (!email || !googleId) {
      res.status(400).json({ message: 'Invalid Google token: missing email or id' });
      return;
    }

    // 2. Find or create user in Supabase Auth
    let supabaseUser: any;
    let isNewSupabaseUser = false;

    const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = usersList?.users?.find((u: any) => u.email === email);

    if (!existingAuthUser) {
      const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: name || email.split('@')[0],
          avatar_url: picture || null,
          provider: 'google',
          provider_id: googleId,
        },
      });

      if (createError || !newAuthUser?.user) {

        res.status(500).json({ message: 'Failed to create authentication user', details: createError?.message });
        return;
      }

      supabaseUser = newAuthUser.user;
      isNewSupabaseUser = true;
    } else {
      supabaseUser = existingAuthUser;

      // Update avatar if changed
      if (picture && supabaseUser.user_metadata?.avatar_url !== picture) {
        await supabaseAdmin.auth.admin.updateUserById(supabaseUser.id, {
          user_metadata: {
            ...supabaseUser.user_metadata,
            avatar_url: picture,
            full_name: name || supabaseUser.user_metadata?.full_name,
          },
        });
      }
    }

    // 3. Generate Supabase session via Admin generateLink + verifyOtp
    //    This bypasses the nonce requirement that breaks iOS Google Sign-In
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (linkError || !linkData) {

      res.status(500).json({ message: 'Failed to generate session', details: linkError?.message });
      return;
    }

    const props = linkData.properties as any;
    const emailOtp: string | undefined = props?.email_otp;
    const hashedToken: string | undefined = props?.hashed_token;

    let sessionData: any = null;
    let sessionError: any = null;

    if (emailOtp) {
      const result = await supabase.auth.verifyOtp({ type: 'email', email, token: emailOtp });
      sessionData = result.data;
      sessionError = result.error;
    } else if (hashedToken) {
      const result = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: hashedToken } as any);
      sessionData = result.data;
      sessionError = result.error;
    } else {
      const actionLink = props?.action_link || '';
      const tokenMatch = actionLink.match(/[?&]token=([^&]+)/);
      const urlToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

      if (urlToken) {
        const result = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: urlToken } as any);
        sessionData = result.data;
        sessionError = result.error;
      } else {
        res.status(500).json({ message: 'Failed to extract session token' });
        return;
      }
    }

    if (sessionError || !sessionData?.session) {

      res.status(500).json({ message: 'Failed to create session', details: sessionError?.message });
      return;
    }

    const { access_token, refresh_token, expires_in } = sessionData.session;

    // 4. Find or create user in 'users' table (using Supabase Auth UUID)
    let { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select(USER_FIELDS)
      .eq('id', supabaseUser.id)
      .maybeSingle();

    if (fetchError) console.error('Error fetching user by ID:', fetchError);

    // If not found by ID, try linking by email (user may exist from email/password signup)
    if (!existingUser && supabaseUser.email) {
      const { data: emailUser, error: emailError } = await supabaseAdmin
        .from('users')
        .select(USER_FIELDS)
        .eq('email', supabaseUser.email)
        .maybeSingle();

      if (emailError) console.error('Error fetching user by email:', emailError);

      if (emailUser) {
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ id: supabaseUser.id })
          .eq('email', supabaseUser.email);

        if (updateError) {

          existingUser = emailUser;
        } else {
          const { data: updatedUser } = await supabaseAdmin
            .from('users')
            .select(USER_FIELDS)
            .eq('id', supabaseUser.id)
            .maybeSingle();
          existingUser = updatedUser || emailUser;
        }
      }
    }

    let userDetails = existingUser;
    const isNewUser = !existingUser;

    if (!existingUser) {
      // Create new user in 'users' table
      let username =
        supabaseUser.user_metadata?.full_name?.replace(/\s+/g, '_').toLowerCase() ||
        supabaseUser.email?.split('@')[0] ||
        `user_${Date.now()}`;

      const { data: usernameCheck } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (usernameCheck) username = `${username}_${Math.floor(Math.random() * 9999)}`;

      const newUser = {
        id: supabaseUser.id,
        email: supabaseUser.email,
        username,
        fullname: supabaseUser.user_metadata?.full_name || '',
        avatar_url: supabaseUser.user_metadata?.avatar_url || null,
        status: 'offline',
        bio: '',
        date_of_birth: null,
      };

      const { error: insertError } = await supabaseAdmin.from('users').insert([newUser]);
      if (insertError) {

        res.status(500).json({ message: 'Failed to create user record', details: insertError.message });
        return;
      }

      const { data: newUserData } = await supabaseAdmin
        .from('users')
        .select(USER_FIELDS)
        .eq('id', supabaseUser.id)
        .maybeSingle();

      userDetails = newUserData;
    } else if (!existingUser.avatar_url && supabaseUser.user_metadata?.avatar_url) {
      // Update avatar if user doesn't have one yet
      await supabaseAdmin
        .from('users')
        .update({ avatar_url: supabaseUser.user_metadata.avatar_url })
        .eq('id', supabaseUser.id);
      userDetails = { ...existingUser, avatar_url: supabaseUser.user_metadata.avatar_url };
    }

    // 5. Return response
    const responseBody = {
      message: 'Google OAuth successful',
      user: userDetails,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      isNewUser,
    };

    if (isMobileApp) {
      await recordMobileActivity(supabaseUser.id);
    }

    if (!isMobileApp) {
      res.cookie('access_token', access_token, cookieOptions);
      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, { ...cookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE });
      }
    }

    res.status(200).json(responseBody);
  } catch (err: any) {

    res.status(500).json({ message: 'Server error during Google OAuth' });
  }
};
