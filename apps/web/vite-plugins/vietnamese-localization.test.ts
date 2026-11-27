import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { collectDisplayStrings, localizeSource } from './vietnamese-localization.mjs';

describe('Vietnamese UI localization', () => {
  const dictionary = {
    Save: 'Lưu', Cancel: 'Hủy', Export: 'Xuất',
    'Export __VAR_0__ clips': 'Xuất __VAR_0__ đoạn phim',
    'Could not save': 'Không thể lưu',
    'Open &amp; edit': 'Mở và chỉnh sửa',
  };
  it('translates JSX, accessible labels, tooltips and menu labels without touching identifiers or user content', () => {
    const code = `
      const action = { id: "Save", label: "Save", value: "Export" };
      const userContent = { name: "Save", text: "Cancel" };
      const view = <button className="Save" data-testid="Save" title="Save" aria-label="Export" onClick={() => run("Save")}>
        Save
        {mode === "Save" ? "Cancel" : "Export"}
        {project.name}
      </button>;
    `;
    const result = localizeSource(code, 'View.tsx', dictionary).code;
    expect(result).toContain('id: "Save", label: "Lưu", value: "Export"');
    expect(result).toContain('name: "Save", text: "Cancel"');
    expect(result).toContain('className="Save" data-testid="Save" title={"Lưu"} aria-label={"Xuất"}');
    expect(result).toContain('run("Save")');
    expect(result).toContain('mode === "Save" ? "Hủy" : "Xuất"');
    expect(result).toContain('{project.name}');
    expect(result).toContain('{"Lưu"}');
  });
  it('preserves interpolated values and translates notification copy', () => {
    const code = 'toast.error("Could not save"); const view = <span>{`Export ${clips.length} clips`}</span>;';
    const result = localizeSource(code, 'View.tsx', dictionary).code;
    expect(result).toContain('toast.error("Không thể lưu")');
    expect(result).toContain('`Xuất ${clips.length} đoạn phim`');
    const compiled = ts.transpileModule(result, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    expect(compiled.diagnostics).toEqual([]);
  });
  it('rejects missing placeholders rather than silently dropping project data', () => {
    expect(() => localizeSource('<span>{`Export ${count} clips`}</span>', 'View.tsx', {
      'Export __VAR_0__ clips': 'Xuất đoạn phim',
    })).toThrow('Invalid Vietnamese placeholders');
  });
  it('retains unknown text, JSX entities and spacing correctly', () => {
    const code = '<p>Open &amp; edit <b>{filename}</b> Unknown</p>';
    const result = localizeSource(code, 'View.tsx', dictionary).code;
    expect(result).toContain('{"Mở và chỉnh sửa"} <b>{filename}</b> Unknown');
    expect(collectDisplayStrings(code, 'View.tsx').map((entry: { text: string }) => entry.text)).toEqual(['Open &amp; edit', 'Unknown']);
  });
  it('does not translate conditional CSS classes, property access or enum comparisons', () => {
    const code = '<button className={active ? "Save" : "Cancel"} style={{ display: "Export" }} data-state={state === "Save" ? "Export" : "Cancel"} />';
    expect(localizeSource(code, 'View.tsx', dictionary).code).toBe(code);
  });
  it('leaves embedded CSS, code examples and keyboard shortcuts intact', () => {
    const code = '<><style>{`Save`}</style><code>Save</code><kbd>Save</kbd><pre>Save</pre></>';
    expect(localizeSource(code, 'View.tsx', dictionary).code).toBe(code);
  });
  it('preserves spaces around interpolated UI fragments and decodes JSX entities', () => {
    expect(localizeSource('<span>{` · ${count} clips`}</span>', 'View.tsx', { ' · __VAR_0__ clips': '· __VAR_0__ đoạn phim' }).code).toContain('` · ${count} đoạn phim`');
    expect(localizeSource('<span>Open &amp; edit</span>', 'View.tsx', { 'Open &amp; edit': 'Mở &amp; sửa' }).code).toBe('<span>{"Mở & sửa"}</span>');
  });
  it('keeps tab accessibility IDs consistent and never translates their state values', () => {
    const code = 'const panel = workspaceTabPanel("Media source", "audio"); const tabs = <WorkspaceTabs label="Media source" value="audio" />;';
    const result = localizeSource(code, 'View.tsx', { 'Media source': 'Nguồn tư liệu', audio: 'âm thanh' }).code;
    expect(result).toContain('workspaceTabPanel("Nguồn tư liệu", "audio")');
    expect(result).toContain('label={"Nguồn tư liệu"} value="audio"');
  });
  it('translates nested display branches and removes English plural suffixes only in translated sentences', () => {
    const code = '<span>{`Sort: ${recent ? "Recent" : "Name"}; ${count} item${count === 1 ? "" : "s"}`}</span>';
    const result = localizeSource(code, 'View.tsx', { 'Sort: __VAR_0__; __VAR_1__ item__VAR_2__': 'Sắp xếp: __VAR_0__; __VAR_1__ mục__VAR_2__', Recent: 'Gần đây', Name: 'Tên' }).code;
    expect(result).toContain('recent ? "Gần đây" : "Tên"');
    expect(result).toContain('count === 1 ? "" : ""');
    expect(localizeSource('<span>s</span>', 'View.tsx', {}).code).toBe('<span>s</span>');
  });
});
