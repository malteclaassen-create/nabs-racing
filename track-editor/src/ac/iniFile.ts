/**
 * A reader and writer for Assetto Corsa's .ini files that keeps the file.
 *
 * There is already src/export/ini.ts, but that one GENERATES ini text for a
 * track the editor made up, where every byte is ours to choose. This one has
 * to edit a file somebody else wrote and hand back everything it did not
 * touch: the comments explaining why a surface has that friction, the section
 * order the modder relied on, the blank lines, the CRLF line endings, the
 * stray keys AC ignores but Content Manager reads.
 *
 * A parse-into-objects-and-re-emit round trip throws all of that away. So the
 * file is held as its LINES, each tagged with what it is, and an edit rewrites
 * one line in place. Untouched files come back byte for byte -- which is the
 * whole point of the import feature.
 */

export type IniLineKind = 'blank' | 'comment' | 'section' | 'entry' | 'other';

export interface IniLine {
  kind: IniLineKind;
  /** The line exactly as it was, without its line ending. */
  raw: string;
  /** Section this line belongs to ('' before the first header). */
  section: string;
  /** Entry lines only. */
  key?: string;
  value?: string;
}

export interface IniFile {
  lines: IniLine[];
  /** The line ending the file used, so it is written back the same way. */
  eol: string;
  /** Whether the file ended with a line break. */
  trailingNewline: boolean;
  /** A UTF-8 byte order mark, if there was one. */
  bom: boolean;
}

const decoder = new TextDecoder('utf-8');

export function parseIni(input: string | Uint8Array): IniFile {
  let text = typeof input === 'string' ? input : decoder.decode(input);
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);

  // CRLF wins if the file has any: AC's own files are CRLF, and rewriting a
  // whole file to LF makes a diff that is nothing but noise.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = text.endsWith('\n');
  const rawLines = text.split(/\r\n|\n/);
  if (trailingNewline) rawLines.pop();

  const lines: IniLine[] = [];
  let section = '';
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      lines.push({ kind: 'blank', raw, section });
      continue;
    }
    if (trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      lines.push({ kind: 'comment', raw, section });
      continue;
    }
    const header = /^\[(.*)\]/.exec(trimmed);
    if (header) {
      section = header[1].trim();
      lines.push({ kind: 'section', raw, section });
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      const key = raw.slice(0, eq).trim();
      // Values can carry a trailing comment: `FRICTION=0.96 ; measured`.
      // Kept in `raw`; `value` is only what an edit would replace.
      const value = raw.slice(eq + 1).trim();
      lines.push({ kind: 'entry', raw, section, key, value });
      continue;
    }
    lines.push({ kind: 'other', raw, section });
  }

  return { lines, eol, trailingNewline, bom };
}

export function stringifyIni(file: IniFile): string {
  const body = file.lines.map((l) => l.raw).join(file.eol);
  return (file.bom ? '﻿' : '') + body + (file.trailingNewline ? file.eol : '');
}

const encoder = new TextEncoder();
export function iniBytes(file: IniFile): Uint8Array {
  return encoder.encode(stringifyIni(file));
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Section names in file order, without the empty preamble. */
export function iniSections(file: IniFile): string[] {
  const out: string[] = [];
  for (const l of file.lines) if (l.kind === 'section' && !out.includes(l.section)) out.push(l.section);
  return out;
}

export function iniGet(file: IniFile, section: string, key: string): string | null {
  for (const l of file.lines) {
    if (l.kind === 'entry' && l.section === section && l.key === key) return l.value ?? null;
  }
  return null;
}

/** Every key/value of one section, in order. */
export function iniEntries(file: IniFile, section: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const l of file.lines) {
    if (l.kind === 'entry' && l.section === section) out.push([l.key ?? '', l.value ?? '']);
  }
  return out;
}

/**
 * Sections whose name is `prefix` plus a number, in numeric order.
 *
 * AC counts its sections: MODEL_0, MODEL_1, SURFACE_0. Sorting those as
 * strings puts MODEL_10 between MODEL_1 and MODEL_2, which for models.ini is
 * the load order and therefore actually matters.
 */
export function iniNumbered(file: IniFile, prefix: string): Array<{ index: number; section: string }> {
  const out: Array<{ index: number; section: string }> = [];
  for (const name of iniSections(file)) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    out.push({ index: Number(rest), section: name });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Change one value, keeping the rest of the line.
 *
 * The key's own spelling and indentation stay, and a trailing comment after
 * the value survives. Returns false when there is no such key, so a caller can
 * decide between "add it" and "this file is not what I thought".
 */
export function iniSet(file: IniFile, section: string, key: string, value: string): boolean {
  for (const l of file.lines) {
    if (l.kind !== 'entry' || l.section !== section || l.key !== key) continue;
    const eq = l.raw.indexOf('=');
    const before = l.raw.slice(0, eq + 1);
    const after = l.raw.slice(eq + 1);
    const comment = /\s+[;#].*$/.exec(after);
    l.raw = before + value + (comment ? comment[0] : '');
    l.value = value;
    return true;
  }
  return false;
}

/** Set a value, adding the key (and the section) when it is missing. */
export function iniSetOrAdd(file: IniFile, section: string, key: string, value: string) {
  if (iniSet(file, section, key, value)) return;
  const at = lastLineOfSection(file, section);
  if (at < 0) {
    appendSection(file, section, [[key, value]]);
    return;
  }
  file.lines.splice(at + 1, 0, { kind: 'entry', raw: `${key}=${value}`, section, key, value });
}

/** Index of the last line belonging to `section`, or -1 if there is none. */
function lastLineOfSection(file: IniFile, section: string): number {
  let last = -1;
  for (let i = 0; i < file.lines.length; i++) {
    if (file.lines[i].section === section) last = i;
  }
  // Trailing blank lines belong visually to the gap, not to the section.
  while (last > 0 && file.lines[last].kind === 'blank') last -= 1;
  return last;
}

export function appendSection(file: IniFile, section: string, entries: Array<[string, string]>) {
  if (file.lines.length > 0 && file.lines[file.lines.length - 1].kind !== 'blank') {
    file.lines.push({ kind: 'blank', raw: '', section: '' });
  }
  file.lines.push({ kind: 'section', raw: `[${section}]`, section });
  for (const [key, value] of entries) {
    file.lines.push({ kind: 'entry', raw: `${key}=${value}`, section, key, value });
  }
}

export function removeSection(file: IniFile, section: string) {
  file.lines = file.lines.filter((l) => l.section !== section || l.kind === 'blank');
}

/** An empty file to build from scratch, matching AC's CRLF habit. */
export function emptyIni(): IniFile {
  return { lines: [], eol: '\r\n', trailingNewline: true, bom: false };
}
