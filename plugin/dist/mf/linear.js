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
    apiKey;
    endpoint;
    fetchImpl;
    constructor(opts = {}) {
        this.apiKey = opts.apiKey ?? process.env.LINEAR_API_KEY;
        this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    get isConfigured() {
        return Boolean(this.apiKey);
    }
    async getIssue(identifier) {
        if (!this.apiKey)
            return null;
        try {
            const res = await this.fetchImpl(this.endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: this.apiKey,
                },
                body: JSON.stringify({ query: ISSUE_QUERY, variables: { id: identifier } }),
            });
            if (!res.ok)
                return null;
            const payload = (await res.json());
            return payload.data?.issue ?? null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=linear.js.map