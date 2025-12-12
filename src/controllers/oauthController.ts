import { Request, Response } from "express";
import { supabase, supabaseAdmin } from "../client/supabase";

// duplicate cookie options to match authController
const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
};

export const oauthSync = async (req: Request, res: Response) => {
    try {
        // Frontend should send access_token and refresh_token from Supabase session
        const { access_token, refresh_token } = req.body;

        if (!access_token) {
            return res.status(400).json({ message: "access_token required" });
        }

        // Validate access token with Supabase
        const { data: supaUserData, error: getUserError } = await supabase.auth.getUser(access_token);

        if (getUserError || !supaUserData?.user) {
            console.warn("oauthSync: invalid supabase access token", getUserError?.message);
            return res.status(401).json({ message: "Invalid Supabase access token" });
        }

        const sbUser = supaUserData.user; // has id, email, user_metadata, etc.

        // Check if row exists in users table; if not, create it
        const { data: existingUser, error: fetchError } = await supabaseAdmin
            .from("users")
            .select("id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at")
            .eq("id", sbUser.id)
            .maybeSingle();

        let userRow = existingUser;

        if (fetchError) {
            console.error("oauthSync: error fetching users row:", fetchError);
            return res.status(500).json({ message: "Failed to fetch user" });
        }

        if (!userRow) {
            // create minimal user row using supabase user info
            const usernameBase = (sbUser.user_metadata?.full_name || sbUser.email || "user")
                .toString()
                .replace(/\s+/g, "")
                .toLowerCase()
                .slice(0, 20);

            // try inserting with id = auth user id
            const insertPayload = {
                id: sbUser.id,
                email: sbUser.email,
                username: usernameBase,
                fullname: sbUser.user_metadata?.full_name ?? sbUser.email,
                avatar_url: sbUser.user_metadata?.avatar_url ?? sbUser.user_metadata?.picture ?? null,
                bio: "",
                date_of_birth: null,
                status: "offline",
            };

            const { error: insertError, data: inserted } = await supabaseAdmin
                .from("users")
                .insert([insertPayload])
                .select()
                .maybeSingle();

            if (insertError) {
                console.error("oauthSync: insert error:", insertError);
                return res.status(500).json({ message: "Failed to create user row" });
            }

            userRow = inserted;
        }

        // Now set cookies for web (same as login route)
        const isMobileApp = req.headers["x-client-type"] === "Mobile";

        if (!isMobileApp) {
            // set access + refresh cookies (frontend will include them on subsequent requests)
            res.cookie("access_token", access_token, cookieOptions);
            if (refresh_token) {
                res.cookie("refresh_token", refresh_token, {
                    ...cookieOptions,
                    maxAge: 60 * 60 * 24 * 30,
                });
            }
        }

        // Return same shape as login
        return res.status(200).json({
            message: "Logged in",
            user: userRow,
            accessToken: access_token,
            refreshToken: refresh_token,
            // keep expiresIn optional — frontend may not need it
        });
    } catch (err) {
        console.error("oauthSync error:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
};
