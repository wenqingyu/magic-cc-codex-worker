export type TemplateContext = Record<string, string | number | undefined>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(PLACEHOLDER, (match, key) => {
    const value = ctx[key];
    return value === undefined ? match : String(value);
  });
}
