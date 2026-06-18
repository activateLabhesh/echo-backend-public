


export const IMAGE_MIME_SET = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'
]);

export const AUDIO_MIME_SET = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/opus',
    'audio/flac',
    'audio/x-flac',
    'audio/x-m4a',
    'audio/3gpp',
    'audio/3gpp2',
]);

export const KNOWN_FILE_MIME_EXT: Record<string, string> = {
    // Images
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
    // Text / docs
    'text/plain': 'txt', 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/json': 'json',
    // Archives (optional - comment out if not desired)
    'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
    // Audio
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'mp4', 'audio/aac': 'aac', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/x-m4a': 'm4a', 'audio/3gpp': '3gp', 'audio/3gpp2': '3g2',
};

export const AUDIO_FILE_EXT_SET = new Set([
    'mp3', 'mp4', 'm4a', 'aac', 'wav', 'webm', 'ogg', 'opus', 'flac', 'oga', '3gp', '3g2'
]);
