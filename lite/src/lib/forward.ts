// Forward mode, for moving a deployment to the Standard edition (docs/migrating-from-lite-to-standard.md).
// With the FORWARD_TO secret set, a Worker sends every request on to that origin unchanged (method,
// path, query, headers, body), answers with whatever it answers, and touches nothing else: no D1,
// no jobs. Deleting the secret is the rollback.
//
// Three headers tell the new origin about the original request. It trusts them only when
// X-Openpurr-Forwarded matches its own FORWARD_SECRET:
//   X-Openpurr-Forwarded   the shared secret
//   X-Openpurr-Origin      the origin the client called (https://purchases.example.com), so
//                          signatures, Pub/Sub audiences, cookies and OAuth stay on that address
//   X-Openpurr-Client-IP   the client's address (CF-Connecting-IP), for rate limits and the audit log
//
// Kept tiny: it's in the SDK Worker's bundle, under its 100 KiB budget.

export interface ForwardEnv {
  FORWARD_TO?: string;
  FORWARD_SECRET?: string;
}

export function forward(req: Request, env: ForwardEnv): Promise<Response> {
  const url = new URL(req.url);
  // Concatenated, not resolved with new URL(path, base): a path starting with // would name
  // another host and take the shared secret there.
  const out = new Request(env.FORWARD_TO!.replace(/\/+$/, "") + url.pathname + url.search, req);
  out.headers.set("x-openpurr-forwarded", env.FORWARD_SECRET ?? "");
  out.headers.set("x-openpurr-origin", url.origin);
  out.headers.set("x-openpurr-client-ip", req.headers.get("cf-connecting-ip") ?? "");
  // Redirects (OAuth, the dashboard) go back to the client as they are.
  return fetch(out, { redirect: "manual" });
}
