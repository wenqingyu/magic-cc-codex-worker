export type TemplateContext = Record<string, string | number | undefined>;
export declare function renderTemplate(template: string, ctx: TemplateContext): string;
