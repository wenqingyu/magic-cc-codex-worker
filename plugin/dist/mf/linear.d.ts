/**
 * Minimal Linear GraphQL client: only fetches an issue by identifier.
 * Uses LINEAR_API_KEY from the environment. Returns null on any failure —
 * caller should treat Linear as optional enrichment, not a hard dependency.
 */
export interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    url: string;
    state: {
        name: string;
    };
}
export interface LinearClientOptions {
    apiKey?: string;
    endpoint?: string;
    fetchImpl?: typeof fetch;
}
export declare class LinearClient {
    private readonly apiKey;
    private readonly endpoint;
    private readonly fetchImpl;
    constructor(opts?: LinearClientOptions);
    get isConfigured(): boolean;
    getIssue(identifier: string): Promise<LinearIssue | null>;
}
