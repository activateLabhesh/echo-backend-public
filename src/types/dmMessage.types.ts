export type DmMessageBody = {
    content?: string;
    sender_id?: string;
    receiver_id: string;
    reply_to?: string;
    duration_ms?: string | number;
};

export type DmThread = {
    id: string;
    user1_id: string;
    user2_id: string;
};

export type DmThreadReadStatus = {
    thread_id: string;
    last_read_at: string;
};

export type DmThreadUser = {
    id: string;
    username: string | null;
    avatar_url: string | null;
};

export type DmMessageRecord = {
    id?: string;
    thread_id: string;
    sender_id: string;
    timestamp: string;
    media_url?: unknown;
    content?: string | null;
};
