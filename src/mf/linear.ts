/**
 * Minimal Linear GraphQL client: only fetches an issue by identifier.
 * Uses LINEAR_API_KEY from the environment. Returns null on any failure —
 * caller should treat Linear as optional enrichment, not a hard dependency.
 */
export interface LinearIssue {
  id: string;
  identifier: string; // e.g. "TEAM-123"
  title: string;
  description: string | null;
  url: string;
  state: { name: string };
}

export interface LinearClientOptions {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.linear.app/graphql";

const ISSUE_QUERY = `
query IssueByIdentifier($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name }
  }
}`;

export class LinearClient {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: LinearClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.LINEAR_API_KEY;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getIssue(identifier: string): Promise<LinearIssue | null> {
    if (!this.apiKey) return null;
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.apiKey,
        },
        body: JSON.stringify({ query: ISSUE_QUERY, variables: { id: identifier } }),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { data?: { issue: LinearIssue | null } };
      return payload.data?.issue ?? null;
    } catch {
      return null;
    }
  }
}
