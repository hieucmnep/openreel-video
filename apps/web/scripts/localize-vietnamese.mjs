import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDisplayStrings, localizeSource } from '../vite-plugins/vietnamese-localization.mjs';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = resolve(root, 'apps/web/src/locales/vi.json');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : /\.[cm]?tsx?$/.test(entry.name) && !/\.(test|spec|d)\./.test(entry.name) ? [resolve(dir, entry.name)] : []);
}
const strings = new Map();
const sources = [];
for (const base of ['apps/web/src', 'packages/core/src', 'packages/ui/src', 'packages/collab/src']) {
  for (const file of files(resolve(root, base))) {
    const code = readFileSync(file, 'utf8');
    sources.push({ file, code });
    for (const entry of collectDisplayStrings(code, file)) {
      if (!strings.has(entry.text)) strings.set(entry.text, file.slice(root.length + 1).replace(/\\/g, '/'));
    }
  }
}
let dictionary = {};
try { dictionary = JSON.parse(readFileSync(catalog, 'utf8')); } catch {}
if (process.argv[2] !== '--translate') {
  dictionary = { ...dictionary, ...JSON.parse(readFileSync(resolve(dirname(catalog), 'vi-messages.json'), 'utf8')), ...JSON.parse(readFileSync(resolve(dirname(catalog), 'vi-overrides.json'), 'utf8')) };
}
const missing = [...strings.keys()].filter(key => !(key in dictionary));
mkdirSync(dirname(catalog), { recursive: true });
const mode = process.argv[2];
if (mode === '--extract') {
  writeFileSync(resolve(root, '.vietnamese-strings.json'), JSON.stringify(Object.fromEntries(strings), null, 2));
} else if (mode === '--missing') {
  console.log(JSON.stringify(missing.filter(text => !/[À-ỹ]/.test(text)).map(text => ({ text, file: strings.get(text) })), null, 2));
} else if (mode === '--check') {
  let replacements = 0;
  for (const [english, vietnamese] of Object.entries(dictionary)) {
    const placeholders = value => (value.match(/__VAR_\d+__/g) ?? []).sort().join(',');
    if (placeholders(english) !== placeholders(vietnamese)) throw new Error(`Placeholder mismatch: ${english}`);
  }
  for (const { file, code } of sources) {
    const result = localizeSource(code, file, dictionary);
    replacements += result.count;
    const parsed = ts.createSourceFile(file, result.code, ts.ScriptTarget.Latest, true);
    if (parsed.parseDiagnostics.length) throw new Error(`Invalid transformed source: ${file}: ${parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
  }
  console.log(`Validated ${sources.length} source files, ${replacements} translated UI occurrences, and all template placeholders.`);
} else if (mode === '--prune') {
  const baseDictionary = JSON.parse(readFileSync(catalog, 'utf8'));
  writeFileSync(catalog, JSON.stringify(Object.fromEntries(Object.entries(baseDictionary).filter(([key]) => strings.has(key))), null, 2) + '\n');
} else if (mode === '--translate') {
  // Explicit maintenance command only. Runtime/build never sends UI text anywhere.
  // Send only extracted static interface copy; no user media, credentials or source code.
  let completed = 0;
  for (let offset = 0; offset < missing.length;) {
    const batch = [];
    let length = 0;
    while (offset < missing.length && (length < 2200 || !batch.length)) {
      const value = missing[offset++];
      batch.push(value);
      length += value.length + 25;
    }
    const query = batch.map((value, i) => `ZXQ${i}QXZ\n${value}`).join('\n');
    let output;
    for (let retry = 0; retry < 4; retry++) {
      try {
        const url = new URL('https://translate.googleapis.com/translate_a/single');
        Object.entries({ client: 'gtx', sl: 'en', tl: 'vi', dt: 't', q: query }).forEach(([key, value]) => url.searchParams.set(key, value));
        const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
        const body = await response.json();
        output = body[0].map(part => part[0] ?? '').join('');
        break;
      } catch (error) {
        if (retry === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * (retry + 1)));
      }
    }
    const parts = output.split(/ZXQ\s*(\d+)\s*QXZ\s*/i);
    for (let i = 1; i < parts.length; i += 2) {
      const original = batch[Number(parts[i])];
      const translated = parts[i + 1].trim().replace(/__\s*VAR\s*_\s*(\d+)\s*__/g, '__VAR_$1__');
      if (!original || !translated) continue;
      const tokens = original.match(/__VAR_\d+__/g) ?? [];
      if (tokens.some(token => translated.split(token).length !== 2)) continue;
      dictionary[original] = translated;
      completed++;
    }
    writeFileSync(catalog, JSON.stringify(Object.fromEntries(Object.entries(dictionary).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
    console.log(`Vietnamese: ${completed}/${missing.length} new entries; ${offset} processed`);
  }
}
console.log(JSON.stringify({ total: strings.size, translated: Object.keys(dictionary).length, missing: [...strings.keys()].filter(key => !(key in dictionary)).length }));
