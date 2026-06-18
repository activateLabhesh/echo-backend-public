import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { supabase } from '../client/supabase';

const ACCESS_TOKEN_MAX_AGE = 60 * 60; // 1 hour
const REFRESH_THRESHOLD = 5 * 60; // refresh if <5min left
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const ACCESS_TOKEN_COOKIE_MAX_AGE_MS = ACCESS_TOKEN_MAX_AGE * 1000;
const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = REFRESH_TOKEN_MAX_AGE * 1000;
const AUTH_CACHE_MAX_TTL_SECONDS = 60;

interface JwtPayload {
  sub: string;
  email?: string;
  exp?: number;
  iat?: number;
}

interface CachedAuthPayload {
  payload: JwtPayload;
  expiresAtMs: number;
}

interface RefreshedSessionResult {
  payload: JwtPayload;
  accessToken: string;
  refreshToken?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  userEmail?: string;
}

const authPayloadCache = new Map<string, CachedAuthPayload>();

const isMobileClient = (req: Request): boolean => req.headers['x-client-type'] === 'Mobile';

const getBearerToken = (authorization?: string): string | undefined => {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  return authorization.slice(7);
};

const getAccessToken = (req: Request): string | undefined =>
  getBearerToken(req.headers.authorization) || req.body?.access_token || req.cookies?.access_token;

const getRefreshToken = (req: Request, mobileClient: boolean): string | undefined => {
  if (mobileClient) {
    return req.body?.refresh_token || (req.headers['x-refresh-token'] as string | undefined);
  }

  return req.cookies?.refresh_token;
};

const decodeJwtPayload = (token: string): JwtPayload | null => {
  const decoded = jwt.decode(token);

  if (!decoded || typeof decoded !== 'object') {
    return null;
  }

  if (typeof decoded.sub !== 'string' || typeof decoded.exp !== 'number') {
    return null;
  }

  return {
    sub: decoded.sub,
    email: typeof decoded.email === 'string' ? decoded.email : undefined,
    exp: decoded.exp,
    iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
  };
};

const getTokenCacheKey = (token: string): string => createHash('sha256').update(token).digest('hex');

const getCachedAuthPayload = (token: string): JwtPayload | null => {
  const cacheKey = getTokenCacheKey(token);
  const cachedAuthPayload = authPayloadCache.get(cacheKey);

  if (!cachedAuthPayload) {
    return null;
  }

  if (cachedAuthPayload.expiresAtMs <= Date.now()) {
    authPayloadCache.delete(cacheKey);
    return null;
  }

  return cachedAuthPayload.payload;
};

const cacheAuthPayload = (token: string, payload: JwtPayload): void => {
  if (!payload.exp) {
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.min(payload.exp - nowSeconds, AUTH_CACHE_MAX_TTL_SECONDS);

  if (ttlSeconds <= 0) {
    return;
  }

  authPayloadCache.set(getTokenCacheKey(token), {
    payload,
    expiresAtMs: Date.now() + ttlSeconds * 1000,
  });
};

const attachAuthenticatedUser = (req: AuthenticatedRequest, payload: JwtPayload): void => {
  req.user = payload;
  req.userEmail = payload.email;
};

const setWebRefreshCookies = (res: Response, accessToken: string, refreshToken?: string): void => {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE_MS,
  });

  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
    });
  }
};

const setMobileRefreshHeaders = (res: Response, accessToken: string, refreshToken?: string): void => {
  res.setHeader('X-New-Access-Token', accessToken);
  res.setHeader('X-New-Refresh-Token', refreshToken || '');
  res.setHeader('X-Token-Refreshed', 'true');
};

const writeRefreshedSession = (
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken?: string,
): void => {
  if (isMobileClient(req)) {
    setMobileRefreshHeaders(res, accessToken, refreshToken);
    return;
  }

  setWebRefreshCookies(res, accessToken, refreshToken);
};

const refreshSession = async (refreshToken: string): Promise<RefreshedSessionResult | null> => {
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return null;
  }

  const payload = decodeJwtPayload(data.session.access_token);

  if (!payload) {
    return null;
  }

  cacheAuthPayload(data.session.access_token, payload);

  return {
    payload,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
};

const verifyAccessToken = async (token: string): Promise<JwtPayload | null> => {
  const cachedPayload = getCachedAuthPayload(token);
  if (cachedPayload) {
    return cachedPayload;
  }

  const decodedPayload = decodeJwtPayload(token);
  if (!decodedPayload) {
    return null;
  }

  const { data: userData, error: verifyError } = await supabase.auth.getUser(token);

  if (verifyError || !userData?.user) {
    return null;
  }

  const payload: JwtPayload = {
    ...decodedPayload,
    sub: userData.user.id,
    email: userData.user.email ?? decodedPayload.email,
  };

  cacheAuthPayload(token, payload);
  return payload;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const mobileClient = isMobileClient(req);
  const accessToken = getAccessToken(req);
  const refreshToken = getRefreshToken(req, mobileClient);

  if (!accessToken) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  try {
    const payload = await verifyAccessToken(accessToken);

    if (!payload?.exp) {
      throw new Error('Invalid or expired token');
    }

    const timeUntilExpiry = payload.exp - Math.floor(Date.now() / 1000);
    res.setHeader('X-Token-Expires-In', timeUntilExpiry.toString());

    if (timeUntilExpiry < REFRESH_THRESHOLD && timeUntilExpiry > 0 && refreshToken) {
      const refreshedSession = await refreshSession(refreshToken);

      if (refreshedSession) {
        writeRefreshedSession(req, res, refreshedSession.accessToken, refreshedSession.refreshToken);
        attachAuthenticatedUser(authReq, refreshedSession.payload);
        next();
        return;
      }
    }

    attachAuthenticatedUser(authReq, payload);
    next();
    return;
  } catch {
    if (refreshToken) {
      try {
        const refreshedSession = await refreshSession(refreshToken);

        if (!refreshedSession) {
          res.status(401).json({
            message: 'Session expired. Please log in again.',
            code: 'SESSION_EXPIRED',
          });
          return;
        }

        writeRefreshedSession(req, res, refreshedSession.accessToken, refreshedSession.refreshToken);
        attachAuthenticatedUser(authReq, refreshedSession.payload);
        next();
        return;
      } catch {
        res.status(401).json({
          message: 'Session expired. Please log in again.',
          code: 'SESSION_EXPIRED',
        });
        return;
      }
    }

    if (mobileClient) {
      res.status(401).json({
        message: 'Session expired. Please log in again.',
        code: 'SESSION_EXPIRED',
      });
      return;
    }

    res.status(403).json({ message: 'Invalid token' });
  }
};
