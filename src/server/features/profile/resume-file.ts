/** Résumé uploads: real file-type detection, text extraction and text clean-up. */
import path from 'node:path';
import { MAX_RESUME_BYTES } from '../../../shared/constants';
import { ApiError, badRequest } from '../../errors';

export type ResumeKind = 'pdf' | 'docx' | 'text';

export const MAX_RESUME_TEXT_CHARS = 200_000;

export const RESUME_MIME: Record<ResumeKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  text: 'text/plain',
};

const TEXT_EXTENSIONS = new Set(['', '.txt', '.text', '.md', '.markdown']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const WHAT_TO_UPLOAD = 'Upload a PDF, a Word .docx file or a plain-text file, or paste the text instead.';

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/** Names of entries in a zip archive, read from its local file headers (enough to tell zip-based formats apart). */
function zipEntryNames(bytes: Buffer, limit = 400): string[] {
  const names: string[] = [];
  let offset = 0;
  while (names.length < limit && offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    names.push(bytes.toString('utf8', offset + 30, offset + 30 + nameLength));
    // With a data descriptor (bit 3) the size is only known after the data; fall back to the central directory.
    if (flags & 0x08) break;
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

/** Entry names from the zip's central directory (at the end of the file). */
function zipCentralNames(bytes: Buffer): string[] {
  const names: string[] = [];
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = bytes.indexOf(signature);
  while (offset !== -1 && offset + 46 <= bytes.length && names.length < 2000) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.toString('utf8', offset + 46, offset + 46 + nameLength));
    const next = offset + 46 + nameLength + extraLength + commentLength;
    offset = bytes.readUInt32LE(next) === 0x02014b50 ? next : -1;
  }
  return names;
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out what a résumé upload really is from its bytes and file name (never the client's
 * MIME type). Throws a 400 explaining what to upload instead for anything unsupported.
 */
export function detectResumeKind(fileName: string, bytes: Buffer): ResumeKind {
  if (bytes.length === 0) throw badRequest('The file is empty. ' + WHAT_TO_UPLOAD);
  if (bytes.length > MAX_RESUME_BYTES) throw resumeTooLarge();
  const ext = path.extname(fileName).toLowerCase();

  // The PDF header may be preceded by junk; readers accept it anywhere in the first 1 KB.
  if (bytes.subarray(0, 1024).includes('%PDF-')) return 'pdf';

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = new Set([...zipEntryNames(bytes), ...zipCentralNames(bytes)]);
    if (names.has('word/document.xml')) return 'docx';
    if ([...names].some((n) => n.startsWith('Index/') || n.endsWith('.iwa')) || ext === '.pages') {
      throw badRequest('Apple Pages files cannot be read. In Pages choose File → Export To → PDF (or Word), then upload that file.');
    }
    if (names.has('content.xml') || ext === '.odt') {
      throw badRequest('OpenDocument files cannot be read. Save the document as PDF or Word .docx, then upload that file.');
    }
    throw badRequest(`This is a zip archive, not a résumé document. ${WHAT_TO_UPLOAD}`);
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw badRequest('This is an old-style Word .doc file, which cannot be read. Open it in Word (or Google Docs) and save it as .docx or PDF, then upload that file.');
  }
  if (bytes.subarray(0, 8).toString('latin1').startsWith('{\\rtf')) {
    throw badRequest('RTF files cannot be read. Save the document as PDF or Word .docx, then upload that file.');
  }
  if (looksLikeImage(bytes) || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.tif', '.tiff', '.bmp'].includes(ext)) {
    throw badRequest(`This is an image, and JScout cannot read text from pictures. ${WHAT_TO_UPLOAD}`);
  }
  if (isUtf8Text(bytes)) {
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    if (ext === '.doc' || ext === '.rtf' || ext === '.pages' || ext === '.odt') {
      throw badRequest(`The ${ext} format is not supported. Save the document as PDF or Word .docx, then upload that file.`);
    }
    throw badRequest(`Files ending in ${ext} are not supported. ${WHAT_TO_UPLOAD}`);
  }
  if (TEXT_EXTENSIONS.has(ext) && ext !== '') {
    throw badRequest('This text file is not UTF-8 encoded. Save it as UTF-8 (or paste the text instead) and try again.');
  }
  if (ext === '.pdf') throw badRequest('This file is named .pdf but is not a valid PDF. Try exporting it again, or paste the text instead.');
  if (ext === '.docx') throw badRequest('This file is named .docx but is not a valid Word document. Try saving it again, or paste the text instead.');
  throw badRequest(`This file type is not supported. ${WHAT_TO_UPLOAD}`);
}

function looksLikeImage(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 16).toString('latin1');
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    head.startsWith('GIF8') ||
    (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') ||
    head.slice(4, 12) === 'ftypheic' ||
    head.startsWith('II*\u0000') ||
    head.startsWith('MM\u0000*') ||
    head.startsWith('BM')
  );
}

export function resumeTooLarge(): ApiError {
  return new ApiError(413, 'too_large', `That file is too large. Résumés up to ${Math.round(MAX_RESUME_BYTES / (1024 * 1024))} MB are supported; try exporting a smaller PDF or paste the text instead.`);
}

/** MIME type to store and serve for a detected upload. */
export function resumeMimeType(kind: ResumeKind, fileName: string): string {
  if (kind === 'text' && MARKDOWN_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return 'text/markdown';
  return RESUME_MIME[kind];
}

/** Extract plain text from an upload. Damaged or locked files are a 400. */
export async function extractResumeText(kind: ResumeKind, bytes: Buffer): Promise<string> {
  if (kind === 'text') return bytes.toString('utf8');
  if (kind === 'docx') {
    const { default: mammoth } = await import('mammoth');
    try {
      return (await mammoth.extractRawText({ buffer: bytes })).value;
    } catch {
      throw badRequest('This Word document could not be read; it may be damaged. Try saving it again or export it as PDF.');
    }
  }
  const { getDocumentProxy, extractText } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // pdf.js takes ownership of the array it is given, so hand it a copy; verbosity 0 keeps it from logging.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const { text } = await extractText(pdf, { mergePages: false });
    return text.join('\n\n');
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') {
      throw badRequest('This PDF is password-protected. Remove the password (or print it to a new PDF) and upload it again.');
    }
    throw badRequest('This PDF could not be read; it may be damaged. Try exporting it again, or paste the text instead.');
  } finally {
    await pdf?.loadingTask.destroy();
  }
}

/** Clean extracted or pasted text: unify newlines, drop control characters, squeeze blank runs, cap the length. */
export function normalizeResumeText(raw: string): string {
  let text = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?|[  \f\v]/g, '\n')
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F​-‍⁠﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_RESUME_TEXT_CHARS) {
    const cut = text.lastIndexOf('\n', MAX_RESUME_TEXT_CHARS);
    text = text.slice(0, cut > MAX_RESUME_TEXT_CHARS * 0.9 ? cut : MAX_RESUME_TEXT_CHARS).trimEnd();
  }
  return text;
}

const EXTENSION: Record<ResumeKind, string[]> = {
  pdf: ['.pdf'],
  docx: ['.docx'],
  text: ['.txt', '.text', '.md', '.markdown'],
};

/** A display/download name safe for any file system and HTTP header, with an extension matching the content. */
export function sanitizeFileName(raw: string, kind: ResumeKind): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let name = base
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const allowed = EXTENSION[kind];
  let ext = path.extname(name).toLowerCase();
  if (!allowed.includes(ext)) {
    ext = allowed[0]!;
    name = `${name}${ext}`;
  }
  const stem = name.slice(0, name.length - ext.length).trim().slice(0, 120);
  return `${stem || 'resume'}${ext}`;
}
