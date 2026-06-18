import { supabase } from '../client/supabase'
import { MessageAttachmentRecord, UploadedAttachment } from '../types/attachment.types';

export async function uploadAttachment(
    storagePath: string,
    buffer: Buffer,
    contentType: string
): Promise<string> {

    const { error } = await supabase.storage
        .from('attachments')
        .upload(storagePath, buffer, {
            contentType,
            upsert: true
        });

    if (error) {
        throw error;
    }

    const { data } = supabase.storage
        .from('attachments')
        .getPublicUrl(storagePath);

    return data.publicUrl;
}

export async function insertChannelMessageAttachments(
    messageId: string,
    attachments: UploadedAttachment[]
): Promise<MessageAttachmentRecord[]> {
    if (attachments.length === 0) return [];

    const { data, error } = await supabase
        .from('message_attachments')
        .insert(attachments.map((attachment) => ({ message_id: messageId, ...attachment })))
        .select('*');

    if (error) {
        throw error;
    }

    return (data as MessageAttachmentRecord[] | null) || [];
}

export async function insertDmMessageAttachments(
    messageId: string,
    attachments: UploadedAttachment[]
): Promise<MessageAttachmentRecord[]> {
    if (attachments.length === 0) return [];

    const { data, error } = await supabase
        .from('dm_message_attachments')
        .insert(attachments.map((attachment) => ({ dm_message_id: messageId, ...attachment })))
        .select('*');

    if (error) {
        throw error;
    }

    return (data as MessageAttachmentRecord[] | null) || [];
}

export async function fetchChannelAttachmentMap(messageIds: string[]): Promise<Map<string, MessageAttachmentRecord[]>> {
    if (messageIds.length === 0) return new Map();

    const { data, error } = await supabase
        .from('message_attachments')
        .select('*')
        .in('message_id', messageIds)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    const map = new Map<string, MessageAttachmentRecord[]>();
    ((data as MessageAttachmentRecord[] | null) || []).forEach((row) => {
        if (!row.message_id) return;
        const existing = map.get(row.message_id) || [];
        existing.push(row);
        map.set(row.message_id, existing);
    });

    return map;
}

export async function fetchDmAttachmentMap(messageIds: string[]): Promise<Map<string, MessageAttachmentRecord[]>> {
    if (messageIds.length === 0) return new Map();

    const { data, error } = await supabase
        .from('dm_message_attachments')
        .select('*')
        .in('dm_message_id', messageIds)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    const map = new Map<string, MessageAttachmentRecord[]>();
    ((data as MessageAttachmentRecord[] | null) || []).forEach((row) => {
        if (!row.dm_message_id) return;
        const existing = map.get(row.dm_message_id) || [];
        existing.push(row);
        map.set(row.dm_message_id, existing);
    });

    return map;
}
