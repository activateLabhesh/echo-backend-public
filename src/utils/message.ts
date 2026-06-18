import { AUDIO_FILE_EXT_SET, AUDIO_MIME_SET, IMAGE_MIME_SET, KNOWN_FILE_MIME_EXT } from './mime';
import { AttachmentType, MessageAttachmentRecord } from '../types/attachment.types';

const GIF_URL_REGEX = /^https?:\/\/\S+\.gif(?:[?#].*)?$/i;
const GIF_DATA_URL_REGEX = /^data:image\/gif(?:;base64)?,/i;

export function parseDurationMs(rawValue: unknown): number | null {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 0) {
        return Math.round(rawValue);
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.round(parsed);
        }
    }

    return null;
}

export function extFromMime(mime: string): string | null {
    const knownExt = KNOWN_FILE_MIME_EXT[mime];
    if (knownExt) return knownExt;

    const subtype = mime.split('/')[1];
    if (!subtype) return null;

    const sanitizedSubtype = subtype
        .split(';')[0]
        .split('+')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');

    return sanitizedSubtype || null;
}

export function sniffImageMime(buffer: Buffer): { mime: string; ext: string } | null {
    if (!buffer || buffer.length < 4) return null;

    const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3];
    if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buffer.length >= 8 && b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
    if (buffer.length >= 6) {
        const sig = buffer.slice(0, 6).toString('ascii');
        if (sig === 'GIF87a' || sig === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
    }
    if (buffer.length >= 12) {
        const riff = buffer.slice(0, 4).toString('ascii');
        const webp = buffer.slice(8, 12).toString('ascii');
        if (riff === 'RIFF' && webp === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
    }
    if (b0 === 0x42 && b1 === 0x4d) return { mime: 'image/bmp', ext: 'bmp' };

    const head = buffer.slice(0, Math.min(512, buffer.length)).toString('utf8').trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) {
        if (head.includes('<svg')) return { mime: 'image/svg+xml', ext: 'svg' };
    }

    return null;
}

export function serializeMediaUrls(urls: string[]): string | null {
    if (!urls.length) return null;
    if (urls.length === 1) return urls[0];
    return JSON.stringify(urls);
}

export function normalizeMediaUrls(mediaUrl: unknown): string[] {
    if (typeof mediaUrl !== 'string') return [];

    const trimmed = mediaUrl.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((item) => typeof item === 'string');
            }
        } catch {
            return [trimmed];
        }
    }

    return [trimmed];
}

export function resolveGifMediaUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (GIF_DATA_URL_REGEX.test(trimmed) || GIF_URL_REGEX.test(trimmed)) {
        return trimmed;
    }

    return null;
}

export function classifyAttachmentType(mimeType: string, originalName?: string): AttachmentType {
    if (IMAGE_MIME_SET.has(mimeType)) {
        return 'image';
    }

    if (mimeType.startsWith('audio/') || AUDIO_MIME_SET.has(mimeType)) {
        return 'audio';
    }

    const extension = originalName?.split('.').pop()?.toLowerCase();
    if (extension && AUDIO_FILE_EXT_SET.has(extension)) {
        return 'audio';
    }

    return 'file';
}

export function getAttachmentPreview(message?: {
    attachments?: MessageAttachmentRecord[];
    media_urls?: unknown;
}): string {
    if (!message) return '';

    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        if (message.attachments.some((attachment) => attachment.attachment_type === 'audio')) {
            return '[Voice message]';
        }

        return '[Attachment]';
    }

    if (Array.isArray(message.media_urls) && message.media_urls.length > 0) {
        return '[Attachment]';
    }

    return '';
}
