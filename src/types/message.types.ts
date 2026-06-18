export type ChannelMessageBody = {
    content?: string;
    sender_id?: string;
    channel_id: string;
    reply_to?: string;
    file?: any;
    duration_ms?: string | number;
};

export type DmMessageBody = {
    content?: string;
    sender_id?: string;
    receiver_id: string;
    reply_to?: string;
    duration_ms?: string | number;
};