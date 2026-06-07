export function normalizeTag(tag: string): string {
  const trimmed = tag.trim().toUpperCase();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function encodeTag(tag: string): string {
  return encodeURIComponent(normalizeTag(tag));
}
