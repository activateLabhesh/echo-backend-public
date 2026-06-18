export type MessageReactionRecord = {
    id?: string;
    message_id?: string | null;
    dm_message_id?: string | null;
    user_id: string;
    emoji: string;
    created_at?: string;
};

export type MessageReactionSummary = {
    emoji: string;
    count: number;
};

