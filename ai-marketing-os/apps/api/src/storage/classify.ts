import { open } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import type { FileCategory } from '@aimos/shared';

/**
 * Tipos aceitos, identificados pelo CONTEÚDO (magic bytes) — a extensão e o
 * Content-Type enviados pelo navegador não são confiáveis.
 */
const ALLOWED_MIME: Record<string, FileCategory> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'image/heic': 'image',
  'image/tiff': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-msvideo': 'video',
  'application/pdf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/zip': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive',
  'image/vnd.adobe.photoshop': 'design',
  'application/x-indesign': 'design',
  'application/postscript': 'design',
  'font/ttf': 'font',
  'font/otf': 'font',
  'font/woff': 'font',
  'font/woff2': 'font',
};

/** Formatos de texto sem assinatura binária: aceitos só por extensão e conteúdo verificado. */
const TEXT_TYPES: Record<string, { mime: string; category: FileCategory }> = {
  '.svg': { mime: 'image/svg+xml', category: 'image' },
  '.csv': { mime: 'text/csv', category: 'spreadsheet' },
  '.txt': { mime: 'text/plain', category: 'document' },
};

/** Tipos que podem ser exibidos inline no navegador; todo o resto é baixado como anexo. */
export const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'video/mp4', 'video/webm']);

export interface Detection {
  mime: string;
  category: FileCategory;
}

export class UnsupportedFileError extends Error {
  constructor(name: string) {
    super(`Tipo de arquivo não permitido: ${name}`);
  }
}

async function head(filePath: string, bytes = 4100): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function detectFile(filePath: string, originalName: string): Promise<Detection> {
  const buf = await head(filePath);
  const ext = originalName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const detected = await fileTypeFromBuffer(buf);

  if (detected) {
    // Arquivos .ai modernos são PDFs; .indd e .psd têm assinatura própria.
    let category = ALLOWED_MIME[detected.mime];
    if (!category) throw new UnsupportedFileError(originalName);
    if (ext === '.ai' && detected.mime === 'application/pdf') category = 'design';
    return { mime: detected.mime, category: refineCategory(category, originalName) };
  }

  const textType = TEXT_TYPES[ext];
  if (textType && isProbablyText(buf)) {
    return { mime: textType.mime, category: refineCategory(textType.category, originalName) };
  }
  throw new UnsupportedFileError(originalName);
}

function isProbablyText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  return !/[\u0000-\u0008\u000E-\u001F]/.test(buf.toString('utf8'));
}

/** Classificação inteligente: o nome do arquivo refina a categoria (logo, manual, catálogo). */
export function refineCategory(base: FileCategory, name: string): FileCategory {
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if ((base === 'image' || base === 'design' || base === 'document') && /\blogo(tipo|marca)?s?\b|[-_ ]logo|logo[-_ ]/.test(n)) return 'logo';
  if (base === 'document' && /manual|brand ?book|guia de marca|guideline|identidade visual/.test(n)) return 'brand_manual';
  if ((base === 'document' || base === 'presentation') && /catalogo|catalog/.test(n)) return 'catalog';
  return base;
}
