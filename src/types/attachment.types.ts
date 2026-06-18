
export type AttachmentType = 'image' | 'audio' | 'file';

export type UploadedAttachment = {
    url: string;
    storage_path: string;
    mime_type: string;
    attachment_type: AttachmentType;
    file_name: string;
    file_size: number;
    duration_ms: number | null;
};

export type MessageAttachmentRecord = {
    id?: string;
    message_id?: string;
    dm_message_id?: string;
    url: string;
    storage_path: string;
    mime_type: string;
    attachment_type: AttachmentType;
    file_name: string;
    file_size: number;
    duration_ms: number | null;
    created_at?: string;
};

export type MediaItem = {
    attachment_id: string;
    message_id: string;
    url: string;
    storage_path: string;
    mime_type: string;
    attachment_type: AttachmentType;
    file_name: string;
    file_size: number;
    duration_ms: number | null;
    created_at?: string;
    message_content: string | null;
    timestamp: string;
    sender: {
        id: string;
        username: string | null;
        avatar_url: string | null;
    } | null;
};



