import { describe, expect, it } from 'vitest';
import { MAX_RESUME_BYTES } from '../../../shared/constants';
import { detectResumeKind, extractResumeText, normalizeResumeText, resumeMimeType, sanitizeFileName } from './resume-file';
import { makeDocx, makePdf, makeZip } from './test-fixtures';

const text = (s: string) => Buffer.from(s, 'utf8');

describe('detectResumeKind', () => {
  it('detects PDF, DOCX and text from the bytes, whatever the name says', () => {
    expect(detectResumeKind('cv.pdf', makePdf(['Jane']))).toBe('pdf');
    expect(detectResumeKind('upload', makePdf(['Jane']))).toBe('pdf');
    expect(detectResumeKind('cv.docx', makeDocx(['Jane']))).toBe('docx');
    expect(detectResumeKind('cv.pdf', makeDocx(['Jane']))).toBe('docx');
    expect(detectResumeKind('cv.txt', text('Jane Doe\n'))).toBe('text');
    expect(detectResumeKind('cv.md', text('# Jane Doe\n'))).toBe('text');
    expect(detectResumeKind('cv', text('Jane Doe'))).toBe('text');
  });

  it.each([
    ['old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), /old-style Word \.doc/],
    ['cv.rtf', text('{\\rtf1\\ansi Jane}'), /RTF files cannot be read/],
    ['cv.pages', makeZip({ 'Index/Document.iwa': 'x' }), /Apple Pages/],
    ['cv.odt', makeZip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' }), /OpenDocument/],
    ['cv.xlsx', makeZip({ 'xl/workbook.xml': '<x/>' }), /zip archive/],
    ['scan.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), /image/],
    ['scan.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), /image/],
    ['cv.html', text('<html><body>Jane</body></html>'), /\.html are not supported/],
    ['cv.pdf', text('not really a pdf'), /named \.pdf but is not a valid PDF/],
    ['cv.txt', Buffer.from([0xff, 0xfe, 0x4a, 0x00, 0x61, 0x00]), /not UTF-8 encoded/],
    ['cv.bin', Buffer.from([0x00, 0x01, 0x02, 0xff]), /not supported/],
    ['empty.pdf', Buffer.alloc(0), /empty/],
  ])('rejects %s with a helpful message', (name, bytes, message) => {
    expect(() => detectResumeKind(name, bytes)).toThrow(message);
  });

  it('enforces the size limit with a 413', () => {
    const big = Buffer.alloc(MAX_RESUME_BYTES + 1, 0x61);
    expect(() => detectResumeKind('cv.txt', big)).toThrow(expect.objectContaining({ status: 413 }));
  });
});

describe('extractResumeText', () => {
  it('extracts text from a real PDF', async () => {
    const pdf = makePdf(['Jane Doe', 'Austin, TX | jane.doe@example.com', 'EXPERIENCE', 'Senior Software Engineer, Acme Corp   Jan 2020 - Present']);
    const extracted = await extractResumeText('pdf', pdf);
    expect(extracted).toContain('Jane Doe');
    expect(extracted).toContain('jane.doe@example.com');
    expect(extracted).toMatch(/Senior Software Engineer, Acme Corp\s+Jan 2020 - Present/);
  });

  it('returns no text for an image-only PDF and rejects a damaged one', async () => {
    expect((await extractResumeText('pdf', makePdf([]))).trim()).toBe('');
    await expect(extractResumeText('pdf', Buffer.from('%PDF-1.4\nthis is not really a pdf'))).rejects.toThrow(/could not be read/);
  });

  it('extracts text from a real DOCX, keeping tabs', async () => {
    const docx = makeDocx(['Priya Raman', 'Senior Data Analyst\tMar 2021 – Present', 'Northwind Analytics & Co']);
    const extracted = await extractResumeText('docx', docx);
    expect(extracted).toContain('Priya Raman');
    expect(extracted).toContain('Senior Data Analyst\tMar 2021 – Present');
    expect(extracted).toContain('Northwind Analytics & Co');
    await expect(extractResumeText('docx', makeZip({ 'word/document.xml': '<oops' }))).rejects.toThrow(/could not be read/);
  });
});

describe('normalizeResumeText', () => {
  it('unifies newlines, strips control characters and squeezes blank runs', () => {
    const raw = '\uFEFFJane\r\nDoe\u0000\u0007\rEngineer\u00A0Lead   \n\n\n\n\nSkills\f\u200BGo\t ';
    expect(normalizeResumeText(raw)).toBe('Jane\nDoe\nEngineer Lead\n\nSkills\nGo');
  });

  it('caps very long text at a line break', () => {
    const long = `${'word '.repeat(19)}\n`.repeat(3000);
    const out = normalizeResumeText(long);
    expect(out.length).toBeLessThanOrEqual(200_000);
    expect(out.endsWith('word')).toBe(true);
  });
});

describe('file names and types', () => {
  it('sanitises names and makes the extension match the content', () => {
    expect(sanitizeFileName('C:\\Users\\me\\My "CV" <final>.pdf', 'pdf')).toBe('My CV final.pdf');
    expect(sanitizeFileName('../../etc/passwd', 'text')).toBe('passwd.txt');
    expect(sanitizeFileName('resume.doc', 'docx')).toBe('resume.doc.docx');
    expect(sanitizeFileName('...', 'pdf')).toBe('resume.pdf');
    expect(sanitizeFileName(`${'x'.repeat(300)}.PDF`, 'pdf')).toBe(`${'x'.repeat(120)}.pdf`);
    expect(sanitizeFileName('Notes.MD', 'text')).toBe('Notes.md');
  });

  it('maps kinds to MIME types', () => {
    expect(resumeMimeType('pdf', 'x.pdf')).toBe('application/pdf');
    expect(resumeMimeType('text', 'x.md')).toBe('text/markdown');
    expect(resumeMimeType('text', 'x.txt')).toBe('text/plain');
    expect(resumeMimeType('docx', 'x.docx')).toContain('wordprocessingml');
  });
});
