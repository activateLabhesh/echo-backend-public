import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../client/supabase';

const ACCESS_TOKEN_MAX_AGE = 60 * 60; // 1 hour
const REFRESH_THRESHOLD = 5 * 60; // refresh if <5min left
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface JwtPayload {
  sub: string;
  email?: string;
  exp?: number;
  iat?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  userEmail?: string;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  
  let token: string | undefined;
  let refreshToken: string | undefined;

  const isMobileApp = req.headers["x-client-type"] === "Mobile";

  // Access token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies?.access_token) {
    token = req.cookies.access_token;
  }

  // Refresh token
  if (isMobileApp) {
    refreshToken = req.body?.refresh_token || (req.headers["x-refresh-token"] as string);
  } else if (req.cookies?.refresh_token) {
    refreshToken = req.cookies.refresh_token;
  }

  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  // Validate the token with Supabase
  try {
    const { data: userData, error: verifyError } = await supabase.auth.getUser(token);

    if (verifyError || !userData?.user) {
      throw new Error("Invalid or expired token");
    }

    // Decode to extract exp
    const decoded: any = jwt.decode(token);
    const exp = decoded?.exp;

    if (!exp) {
      res.status(401).json({ message: "Invalid token (missing exp)" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = exp - now;

    res.setHeader("X-Token-Expires-In", timeUntilExpiry.toString());

    const payload: JwtPayload = {
      sub: userData.user.id,
      email: userData.user.email,
      exp,
    };

    // Auto-refresh if token expiring soon
    if (timeUntilExpiry < REFRESH_THRESHOLD && timeUntilExpiry > 0 && refreshToken) {
      console.log(`Token expiring in ${timeUntilExpiry}s → auto-refreshing...`);

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (!error && data.session) {
        const { access_token: newAccessToken, refresh_token: newRefreshToken } = data.session;

        if (isMobileApp) {
          res.setHeader("X-New-Access-Token", newAccessToken);
          res.setHeader("X-New-Refresh-Token", newRefreshToken || "");
          res.setHeader("X-Token-Refreshed", "true");
        } else {
          res.cookie("access_token", newAccessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            maxAge: ACCESS_TOKEN_MAX_AGE,
          });

          if (newRefreshToken) {
            res.cookie("refresh_token", newRefreshToken, {
              httpOnly: true,
              secure: true,
              sameSite: "none",
              path: "/",
              maxAge: REFRESH_TOKEN_MAX_AGE,
            });
          }
        }

        console.log("Token auto-refreshed successfully.");
      }
    }

    authReq.user = payload;
    authReq.userEmail = payload.email;

    next();
    return;
  } catch (err) {
    console.log("Token check failed → attempting refresh...");

    if (refreshToken) {
      try {
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (error || !data.session) {
          res.status(401).json({
            message: "Session expired. Please log in again.",
            code: "SESSION_EXPIRED",
          });
          return;
        }

        const { access_token: newAccessToken, refresh_token: newRefreshToken } = data.session;

        const decoded: any = jwt.decode(newAccessToken);

        const newPayload: JwtPayload = {
          sub: decoded.sub,
          email: decoded.email,
          exp: decoded.exp,
        };

        if (isMobileApp) {
          res.setHeader("X-New-Access-Token", newAccessToken);
          res.setHeader("X-New-Refresh-Token", newRefreshToken || "");
          res.setHeader("X-Token-Refreshed", "true");
        } else {
          res.cookie("access_token", newAccessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            maxAge: ACCESS_TOKEN_MAX_AGE,
          });

          if (newRefreshToken) {
            res.cookie("refresh_token", newRefreshToken, {
              httpOnly: true,
              secure: true,
              sameSite: "none",
              path: "/",
              maxAge: REFRESH_TOKEN_MAX_AGE,
            });
          }
        }

        authReq.user = newPayload;
        authReq.userEmail = newPayload.email;

        next();
        return;
      } catch (refreshError) {
        res.status(401).json({
          message: "Session expired. Please log in again.",
          code: "SESSION_EXPIRED",
        });
        return;
      }
    }

    res.status(403).json({ message: "Invalid token" });
    return;
  }
};
