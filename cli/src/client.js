// Talking to a deployment's back office: the admin API (/admin/v1) and the MCP server (/mcp),
// both with a personal access token. The CLI uses the MCP tools for customers, entitlements,
// grants, charts and webhooks, so its answers are the same ones an AI assistant gets.

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const VERSION_HEADER = { "mcp-protocol-version": "2025-11-25" };

export function client({ url, token }, fetchImpl = fetch) {
  if (!url) throw new CliError("No deployment set. Run: openpurr login --url https://<your back office>");
  if (!token) throw new CliError("Not signed in. Run: openpurr login (or set OPENPURR_TOKEN).");

  async function request(method, path, body, accept = "application/json") {
    let res;
    try {
      res = await fetchImpl(`${url}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new CliError(`Couldn't reach ${url}: ${err.cause?.message ?? err.message}`);
    }
    return res;
  }

  return {
    url,
    /** Admin API call; throws CliError with the server's message on failure. */
    async api(method, path, body) {
      const res = await request(method, `/admin/v1${path}`, body);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new CliError(`${data.message ?? "Not signed in."} Run: openpurr login`);
      if (!res.ok) {
        const problems = Array.isArray(data.problems) ? `\n${data.problems.map((p) => `  - ${p}`).join("\n")}` : "";
        throw new CliError(`${data.message ?? `HTTP ${res.status}`}${problems}`);
      }
      return data;
    },
    /**
     * Admin API call that returns the status instead of throwing on 4xx/5xx (for commands that
     * decide per status, like import). Throws CliError on 401 and when the server can't be reached.
     */
    async apiStatus(method, path, body) {
      const res = await request(method, `/admin/v1${path}`, body);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new CliError(`${data.message ?? "Not signed in."} Run: openpurr login`);
      return { status: res.status, data, retryAfter: Number(res.headers.get("retry-after")) || null };
    },
    /** Raw text from the admin API (CSV). */
    async apiText(path) {
      const res = await request("GET", `/admin/v1${path}`, undefined, "text/csv");
      if (!res.ok) throw new CliError(`HTTP ${res.status}: ${await res.text()}`);
      return res.text();
    },
    /** Calls an MCP tool. Returns { text, data } or throws CliError with the tool's message. */
    async tool(name, args = {}) {
      let res;
      try {
        res = await fetchImpl(`${url}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...VERSION_HEADER },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        });
      } catch (err) {
        throw new CliError(`Couldn't reach ${url}: ${err.cause?.message ?? err.message}`);
      }
      if (res.status === 401) throw new CliError("Your token isn't valid anymore. Run: openpurr login");
      const msg = await res.json().catch(() => null);
      if (!msg) throw new CliError(`Unexpected answer from ${url}/mcp (HTTP ${res.status}).`);
      if (msg.error) throw new CliError(msg.error.message);
      const text = (msg.result?.content ?? []).map((x) => x.text).join("\n");
      if (msg.result?.isError) throw new CliError(text);
      return { text, data: msg.result?.structuredContent ?? null };
    },
  };
}
