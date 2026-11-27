import ts from 'typescript';
import { readFileSync } from 'node:fs';

const displayKeys = new Set(['label', 'title', 'description', 'placeholder', 'tooltip', 'helperText', 'helpText', 'emptyMessage', 'emptyText', 'loadingText', 'aria-label', 'aria-description', 'ariaLabel', 'alt', 'confirmLabel', 'cancelLabel', 'actionLabel', 'buttonText', 'header', 'heading', 'subtitle']);
const notifications = /^(?:(?:toast|notify|notification)\.(?:success|error|info|warning|warn|loading|message)|(?:window\.)?(?:alert|confirm|prompt)|setError|setErrorMessage|setStatusMessage|setSuccessMessage|setInitStatus|workspaceTabPanel)$/;
const keyName = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : '';
const decodeEntities = text => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity.toLowerCase()] ?? match;
});

// Follow only value-producing branches. Never translate a condition, lookup key,
// enum, CSS class, URL, event name, project content or persisted identifier.
function isDisplayValue(node, source) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isJsxAttribute(p)) return displayKeys.has(keyName(p.name));
  if (ts.isPropertyAssignment(p) && p.initializer === node) return displayKeys.has(keyName(p.name));
  if (ts.isJsxExpression(p)) return !ts.isJsxAttribute(p.parent) || displayKeys.has(keyName(p.parent.name));
  if (ts.isConditionalExpression(p) && p.condition !== node) return isDisplayValue(p, source);
  if (ts.isParenthesizedExpression(p)) return isDisplayValue(p, source);
  if (ts.isBinaryExpression(p) && p.right === node && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return isDisplayValue(p, source);
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const call = p.expression.getText(source);
    return notifications.test(call) && (p.arguments[0] === node || (/^(toast|notify|notification)\./.test(call) && p.arguments[1] === node));
  }
  return false;
}

export function collectDisplayStrings(code, filename) {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const entries = [];
  function visit(node) {
    if (ts.isJsxElement(node) && /^(style|script|code|pre|kbd)$/.test(node.openingElement.tagName.getText(source))) return;
    if (ts.isJsxText(node)) {
      const raw = node.getText(source);
      const text = raw.replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]/.test(text)) entries.push({ start: node.getStart(source), end: node.end, text, kind: 'jsx', raw });
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && isDisplayValue(node, source)) {
      const expressions = [];
      let text;
      if (ts.isTemplateExpression(node)) {
        text = node.head.text;
        node.templateSpans.forEach((span, i) => {
          expressions.push(span.expression.getText(source));
          text += `__VAR_${i}__` + span.literal.text;
        });
      } else text = node.text;
      if (/[A-Za-z]/.test(text.replace(/__VAR_\d+__/g, ''))) entries.push({ start: node.getStart(source), end: node.end, text, kind: ts.isJsxAttribute(node.parent) ? 'attribute' : 'string', expressions });
      // Expressions inside an interpolated string are data, not more UI labels.
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return entries;
}

export function localizeSource(code, filename, dictionary) {
  const edits = collectDisplayStrings(code, filename).flatMap(entry => {
    let translated = dictionary[entry.text];
    if (typeof translated !== 'string' || translated === entry.text) return [];
    if (entry.kind === 'jsx' || entry.kind === 'attribute') translated = decodeEntities(translated);
    else translated = (entry.text.match(/^\s*/)?.[0] ?? '') + translated.trim() + (entry.text.match(/\s*$/)?.[0] ?? '');
    let replacement;
    if (entry.kind === 'jsx') {
      const leading = entry.raw.match(/^\s*/)?.[0] ?? '';
      const trailing = entry.raw.match(/\s*$/)?.[0] ?? '';
      replacement = leading + '{' + JSON.stringify(translated) + '}' + trailing;
    } else if (entry.kind === 'attribute') replacement = '{' + JSON.stringify(translated) + '}';
    else if (entry.expressions.length) {
      const expected = entry.expressions.map((_, i) => `__VAR_${i}__`);
      if (expected.some(token => translated.split(token).length !== 2)) throw new Error(`Invalid Vietnamese placeholders: ${entry.text}`);
      replacement = '`' + translated.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/__VAR_(\d+)__/g, (_, i) => {
        const expression = entry.expressions[Number(i)]
          .replace(/\?\s*(["'])\1\s*:\s*(["'])s\2/g, '? "" : ""')
          .replace(/\?\s*(["'])s\1\s*:\s*(["'])\2/g, '? "" : ""');
        const prefix = '<span>{';
        const suffix = '}</span>';
        const localized = localizeSource(prefix + expression + suffix, 'expression.tsx', dictionary).code.slice(prefix.length, -suffix.length);
        return '${' + localized + '}';
      }) + '`';
    } else replacement = JSON.stringify(translated);
    return [{ ...entry, replacement }];
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.replacement + code.slice(edit.end);
  return { code, count: edits.length };
}

export function vietnameseLocalizationPlugin() {
  const catalogUrl = new URL('../src/locales/vi.json', import.meta.url);
  const overridesUrl = new URL('../src/locales/vi-overrides.json', import.meta.url);
  const messagesUrl = new URL('../src/locales/vi-messages.json', import.meta.url);
  const readDictionary = () => ({ ...JSON.parse(readFileSync(catalogUrl, 'utf8')), ...JSON.parse(readFileSync(messagesUrl, 'utf8')), ...JSON.parse(readFileSync(overridesUrl, 'utf8')) });
  let dictionary = readDictionary();
  return {
    name: 'openreel-vietnamese',
    enforce: 'pre',
    handleHotUpdate(ctx) {
      if (/\/src\/locales\/vi(?:-overrides|-messages)?\.json$/.test(ctx.file.replace(/\\/g, '/'))) {
        dictionary = readDictionary();
        ctx.server.moduleGraph.invalidateAll();
        ctx.server.ws.send({ type: 'full-reload' });
      }
    },
    transform(code, id) {
      const filename = id.split('?')[0].replace(/\\/g, '/');
      if (!/\.[cm]?tsx?$/.test(filename) || filename.includes('/node_modules/') || /\.(test|spec)\./.test(filename)) return null;
      if (!/\/(apps\/web|packages\/(core|ui|collab))\/src\//.test(filename)) return null;
      const result = localizeSource(code, filename, dictionary);
      return result.count ? { code: result.code, map: null } : null;
    },
  };
}
