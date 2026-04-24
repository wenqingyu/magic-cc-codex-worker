const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
export function renderTemplate(template, ctx) {
    return template.replace(PLACEHOLDER, (match, key) => {
        const value = ctx[key];
        return value === undefined ? match : String(value);
    });
}
//# sourceMappingURL=templater.js.map