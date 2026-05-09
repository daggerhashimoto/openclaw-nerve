const SIMPLE_ID_PART = /^[A-Za-z0-9._-]+$/;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeRuntimeIdPart(value: string): string {
  if (SIMPLE_ID_PART.test(value)) return value;
  return `~${base64UrlEncodeUtf8(value)}`;
}

function base64UrlEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = '';
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    encoded += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    encoded += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    encoded += BASE64URL_ALPHABET[(chunk >> 6) & 63];
    encoded += BASE64URL_ALPHABET[chunk & 63];
  }

  if (index < bytes.length) {
    const remaining = bytes.length - index;
    const chunk = (bytes[index] << 16) | (remaining === 2 ? bytes[index + 1] << 8 : 0);
    encoded += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    encoded += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    if (remaining === 2) encoded += BASE64URL_ALPHABET[(chunk >> 6) & 63];
  }

  return encoded;
}
