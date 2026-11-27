import labels from './vi-overrides.json';

/** Translate an internal UI label at its rendering boundary, never its stored key. */
export function uiLabel(value: string | undefined): string {
  if (!value) return '';
  return (labels as Record<string, string>)[value] ?? value;
}
