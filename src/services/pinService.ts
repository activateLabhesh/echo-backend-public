
type MessagePinRecord = {
    id?: string;
    message_id?: string | null;
    dm_message_id?: string | null;
    pinned_by: string;
    created_at?: string;
};