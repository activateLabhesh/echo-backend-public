const GIF_URL_REGEX = /^https?:\/\/\S+\.gif(?:[?#].*)?$/i;
const GIF_DATA_URL_REGEX = /^data:image\/gif(?:;base64)?,/i;

export const extractGifMediaUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (GIF_DATA_URL_REGEX.test(trimmed) || GIF_URL_REGEX.test(trimmed)) {
    return trimmed;
  }

  return null;
};
