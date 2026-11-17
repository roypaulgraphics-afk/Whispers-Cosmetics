export function sanitizeImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 4_000_000) return '';
  if (trimmed.startsWith('preset:')) {
    return /^preset:[a-z_]+$/.test(trimmed) ? trimmed : '';
  }
  if (trimmed.startsWith('/uploads/')) {
    return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : '';
  }
  if (trimmed.startsWith('data:image/')) {
    return /^data:image\/(png|jpe?g|webp);base64,[a-zA-Z0-9+/=]+$/.test(trimmed) ? trimmed : '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return '';
    }
  }
  return '';
}
