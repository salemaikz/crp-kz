// Цвета и размеры листа PDF сертификата. Цвета — только токены BRAND, других нет.
export const PDF_COLORS = {
  paper: '#FFFFFF',
  ink: '#14161B',
  muted: '#4A4F59',
  soft: '#6B707A',
  accent: '#E31E24',
} as const;

/** A4 альбомный в pt. */
export const A4_LANDSCAPE = { width: 841.89, height: 595.28 } as const;
