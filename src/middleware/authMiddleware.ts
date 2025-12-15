import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../client/supabase';

const ACCESS_TOKEN_MAX_AGE = 60 * 60; // 1 hour
const REFRESH_THRESHOLD = 5 * 60; // refresh if <5min left
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface JwtPayload {
  sub: string;       // Supabase user ID
  email?: string;    // Email
  exp?: number;      // Expiration timestamp
  iat?: number;      // Issued at
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  userEmail?: string;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  console.log("=== AUTH MIDDLEWARE HIT ===");
  console.log("URL:", req.url);
  console.log("Method:", req.method);

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
    console.log("No token provided");
    res.status(401).json({ message: "No token provided" });
    return;
  }

  // Step 1: Validate token with Supabase
  try {
    const { data: userData, error: verifyError } = await supabase.auth.getUser(token);

    if (verifyError || !userData?.user) {
      throw new Error("Invalid or expired token");
    }

    // Step 2: Decode JWT for expiration (Supabase does not provide exp in getUser)
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

    // Step 3: if token will expire soon (<5 min) → auto-refresh
    if (timeUntilExpiry < REFRESH_THRESHOLD && timeUntilExpiry > 0 && refreshToken) {
      console.log(`Token expiring in ${timeUntilExpiry}s → auto-refreshing...`);

      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

      if (!error && data.session) {
        const { access_token: newAccessToken, refresh_token: newRefreshToken } = data.session;

        // Update cookies or headers
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

    // Attach user
    authReq.user = payload;
    authReq.userEmail = payload.email;

    console.log("Auth OK →", payload.sub);
    next();
    return;

  } catch (err: any) {
    console.log("Token validation failed → attempting refresh...");

    // Step 4: Token expired → attempt full refresh
    if (refreshToken) {
      try {
        const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

        if (error || !data.session) {
          console.log("Refresh failed:", error?.message);
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

        // Set new tokens
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

        console.log("Token refreshed after expiry.");

        authReq.user = newPayload;
        authReq.userEmail = newPayload.email;

        next();
        return;

      } catch (refreshError) {
        console.log("Refresh error:", refreshError);
        res.status(401).json({
          message: "Session expired. Please log in again.",
          code: "SESSION_EXPIRED",
        });
        return;
      }
    }

    // No refresh token → fully invalid
    console.log("No refresh token → invalid session");
    res.status(403).json({ message: "Invalid token" });
    return;
  }
};
