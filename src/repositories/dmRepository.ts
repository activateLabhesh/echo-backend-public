import { supabase } from '../client/supabase';
import * as DmMessageTypes from '../types/dmMessage.types';

export async function fetchDmThread(threadId: string): Promise<DmMessageTypes.DmThread | null> {
    const { data, error } = await supabase
        .from('dm_threads')
        .select('id, user1_id, user2_id')
        .eq('id', threadId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as DmMessageTypes.DmThread | null) || null;
}

export async function findDmThread(user1Id: string, user2Id: string): Promise<DmMessageTypes.DmThread | null> {
    const { data, error } = await supabase
        .from('dm_threads')
        .select('id, user1_id, user2_id')
        .eq('user1_id', user1Id)
        .eq('user2_id', user2Id)
        .single();

    if (error) {
        throw error;
    }

    return (data as DmMessageTypes.DmThread | null) || null;
}

export async function createDmThread(user1Id: string, user2Id: string): Promise<DmMessageTypes.DmThread> {
    const { data, error } = await supabase
        .from('dm_threads')
        .insert({ user1_id: user1Id, user2_id: user2Id })
        .select('id, user1_id, user2_id')
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as DmMessageTypes.DmThread;
}

export async function insertDmMessage(payload: {
    id: string;
    content: string;
    media_url: string | null;
    thread_id: string;
    sender_id: string;
    reply_to: string | null;
}) {
    const { data, error } = await supabase
        .from('dm_messages')
        .insert(payload)
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

export async function fetchDmMessageById(messageId: string) {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            *,
            reply_to_message:reply_to (
              id, content, sender_id, users (username, avatar_url)
            )
        `)
        .eq('id', messageId)
        .single();

    if (error) {
        throw error;
    }

    return data;
}

export async function searchDmMessages(threadId: string, query: string, limit: number) {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            *,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            ),
            reply_to_message:reply_to (
                id,
                content,
                sender_id,
                users (username, avatar_url)
            )
        `)
        .eq('thread_id', threadId)
        .ilike('content', `%${query}%`)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchDmMediaMessages(threadId: string) {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            id,
            thread_id,
            content,
            timestamp,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            )
        `)
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false });

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchDmThreadMessages(threadId: string, offset: number, pageSize: number) {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            *,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            )
        `)
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .range(offset, offset + pageSize);

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchUserDmThreads(userId: string): Promise<DmMessageTypes.DmThread[]> {
    const { data, error } = await supabase
        .from('dm_threads')
        .select('id, user1_id, user2_id')
        .or(`user1_id.eq."${userId}",user2_id.eq."${userId}"`);

    if (error) {
        throw error;
    }

    return (data as DmMessageTypes.DmThread[] | null) || [];
}

export async function fetchUsersByIds(userIds: string[]): Promise<DmMessageTypes.DmThreadUser[]> {
    if (userIds.length === 0) return [];

    const { data, error } = await supabase
        .from('users')
        .select('id, username, avatar_url')
        .in('id', userIds);

    if (error) {
        throw error;
    }

    return (data as DmMessageTypes.DmThreadUser[] | null) || [];
}

export async function fetchThreadReadStatuses(userId: string, threadIds: string[]): Promise<DmMessageTypes.DmThreadReadStatus[]> {
    if (threadIds.length === 0) return [];

    const { data, error } = await supabase
        .from('thread_read_status')
        .select('thread_id, last_read_at')
        .eq('user_id', userId)
        .in('thread_id', threadIds);

    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    return (data as DmMessageTypes.DmThreadReadStatus[] | null) || [];
}

export async function fetchThreadLatestMessage(threadId: string): Promise<DmMessageTypes.DmMessageRecord | null> {
    const { data, error } = await supabase
        .from('dm_messages')
        .select('id, thread_id, sender_id, timestamp, media_url, content')
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as DmMessageTypes.DmMessageRecord | null) || null;
}

export async function fetchThreadUnreadCount(threadId: string, userId: string, lastReadAt?: string): Promise<number> {
    let query = supabase
        .from('dm_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .neq('sender_id', userId);

    if (lastReadAt) {
        query = query.gt('timestamp', lastReadAt);
    }

    const { count, error } = await query;

    if (error) {
        throw error;
    }

    return count || 0;
}

export async function fetchThreadMessagesPage(threadId: string, limit: number) {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            *,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            )
        `)
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchLatestThreadMessageTimestamp(threadId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('dm_messages')
        .select('timestamp')
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    return data?.timestamp || null;
}

export async function upsertThreadReadStatus(threadId: string, userId: string, lastReadAt: string): Promise<void> {
    const { error } = await supabase
        .from('thread_read_status')
        .upsert(
            {
                thread_id: threadId,
                user_id: userId,
                last_read_at: lastReadAt,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: 'thread_id,user_id',
            }
        );

    if (error) {
        throw error;
    }
}

export async function getThreads(messageId: string){
        const { data: message, error: messageError } = await supabase
            .from('dm_messages')
            .select('id, thread_id, sender_id')
            .eq('id', messageId)
            .maybeSingle();
    
        if (messageError) {
            throw messageError;
        }
    
        if (!message?.thread_id) {
            return null;
        }

        return message;
}

export async function getUsersFromDm(threadId: string){
        const { data: thread, error: threadError } = await supabase
            .from('dm_threads')
            .select('id, user1_id, user2_id')
            .eq('id', threadId)
            .maybeSingle();
    
        if (threadError) {
            throw threadError;
        }
    
        if (!thread) {
            throw new Error("no thread found here")
        }

        return thread;
    
}