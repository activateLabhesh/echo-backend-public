import { supabase } from '../client/supabase'


export async function insertChannelMessage(payload: {
    id: string;
    channel_id: string;
    sender_id: string;
    content: string;
    media_url: string | null;
    reply_to: string | null;
}) {
    const { data, error } = await supabase
        .from('messages')
        .insert(payload)
        .select('*')
        .single();

    if (error) {
        throw error;
    }

    return data;
}

export async function fetchChannelMessageById(messageId: string) {
    const { data, error } = await supabase
        .from('messages')
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
        .eq('id', messageId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

export async function fetchServerChannelIds(serverId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('channels')
        .select('id')
        .eq('server_id', serverId);

    if (error) {
        throw error;
    }

    return ((data || []) as Array<{ id: string }>).map((channel) => channel.id);
}


export async function fetchChannelMessages(channel_id: string, offset: number, pageSize: number){

        const { data, error } = await supabase
            .from('messages')
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
            .eq('channel_id', channel_id)
            .order('timestamp', { ascending: false })
            .range(offset, offset + pageSize); // Fetch pageSize + 1 to check hasMore

            

        if (error) {
            console.error('Error fetching messages:', error);
            throw new Error(`Repository error: ${error} `)
        }

        return data;
}

export async function searchChannelMessages(channelIds: string[], query: string, limit: number) {
    const { data, error } = await supabase
        .from('messages')
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
        .in('channel_id', channelIds)
        .ilike('content', `%${query}%`)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchChannelMedia(channelIds: string[]) {
    const { data, error } = await supabase
        .from('messages')
        .select(`
            id,
            channel_id,
            content,
            timestamp,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            )
        `)
        .in('channel_id', channelIds)
        .order('timestamp', { ascending: false });

    if (error) {
        throw error;
    }

    return data || [];
}

export async function fetchChannelwithSender(messageId: string){
    const { data, error } = await supabase
        .from('messages')
        .select('id, channel_id, sender_id')
        .eq('id', messageId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data?.channel_id || !data?.sender_id) {
        return null;
    }

    return { channelId: data.channel_id, senderId: data.sender_id };
}