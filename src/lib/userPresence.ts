import { supabaseAdmin } from "../client/supabase";

const LAST_SEEN_COLUMNS = ["last_seen_at", "lastSeenAt"] as const;

const updateLastSeenAt = async (userId: string, timestamp: string): Promise<void> => {
  let lastError: unknown = null;

  for (const column of LAST_SEEN_COLUMNS) {
    const { error } = await supabaseAdmin
      .from("users")
      .update({ [column]: timestamp } as any)
      .eq("id", userId);

    if (!error) {
      return;
    }

    lastError = error;
  }

  if (lastError) {
    throw lastError;
  }
};

export const markUserOnline = async (userId: string): Promise<void> => {
  const timestamp = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("users")
    .update({ status: "online" })
    .eq("id", userId);

  if (error) {
    throw error;
  }

  await updateLastSeenAt(userId, timestamp);
};

export const markUserOffline = async (userId: string): Promise<void> => {
  const timestamp = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("users")
    .update({ status: "offline" })
    .eq("id", userId);

  if (error) {
    throw error;
  }

  await updateLastSeenAt(userId, timestamp);
};
