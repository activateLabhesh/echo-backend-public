import { supabase } from '../client/supabase';
import { MessageReactionSummary } from '../types/reaction.types';

function buildReactionSummary(rows: Array<{ emoji: string }>): MessageReactionSummary[] {
    const counts = new Map<string, number>();

    rows.forEach((row) => {
        counts.set(row.emoji, (counts.get(row.emoji) || 0) + 1);
    });

    return Array.from(counts.entries())
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }

            return left.emoji.localeCompare(right.emoji);
        });
}

function buildReactionMap<T extends 'message_id' | 'dm_message_id'>(
    rows: Array<Record<T, string | null> & { emoji: string }>,
    key: T
): Map<string, MessageReactionSummary[]> {
    const grouped = new Map<string, Array<{ emoji: string }>>();

    rows.forEach((row) => {
        const targetId = row[key];
        if (!targetId) return;

        const existing = grouped.get(targetId) || [];
        existing.push({ emoji: row.emoji });
        grouped.set(targetId, existing);
    });

    const reactionMap = new Map<string, MessageReactionSummary[]>();
    grouped.forEach((reactionRows, targetId) => {
        reactionMap.set(targetId, buildReactionSummary(reactionRows));
    });

    return reactionMap;
}

export async function fetchChannelReactionMap(messageIds: string[]): Promise<Map<string, MessageReactionSummary[]>> {
    if (messageIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('message_reactions')
        .select('message_id, emoji')
        .in('message_id', messageIds);

    if (error) {
        throw error;
    }

    return buildReactionMap((data || []) as Array<{ message_id: string | null; emoji: string }>, 'message_id');
}

export async function fetchDmReactionMap(messageIds: string[]): Promise<Map<string, MessageReactionSummary[]>> {
    if (messageIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('message_reactions')
        .select('dm_message_id, emoji')
        .in('dm_message_id', messageIds);

    if (error) {
        throw error;
    }

    return buildReactionMap((data || []) as Array<{ dm_message_id: string | null; emoji: string }>, 'dm_message_id');
}
