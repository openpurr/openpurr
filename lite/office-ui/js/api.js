// The admin API client. The dashboard uses exactly the API the CLI and MCP server use
// (/admin/v1), signed in with the session cookie. The browser adds the Origin header to every
// change, which the server checks (CSRF protection).

export class ApiError extends Error {
  constructor(status, code, message, problems = null) {
    super(problems?.length ? `${message}\n${problems.map((p) => `• ${p}`).join("\n")}` : message);
    this.status = status;
    this.code = code;
    /** Config saves: every problem found, each "path: what's wrong". */
    this.problems = problems;
  }
}

// The project the dashboard is showing. Customers, grants, secret keys and charts belong to a
// project, so their requests carry it (the server needs it only when there are several).
let project = null;
const PROJECT_SCOPED = /^\/(customers|secret-keys|metrics)(\/|\?|$)/;

export function setProject(id) {
  project = id;
}

export const currentProject = () => project;

/** Adds ?project= to project-scoped paths. */
export function withProject(path) {
  if (!project || !PROJECT_SCOPED.test(path) || /[?&]project=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
}

const handlers = { signedOut: null, enrollmentRequired: null };

/** Called when a request finds the session gone, or two-step sign-in must be set up first. */
export function onAuthChange(signedOut, enrollmentRequired) {
  handlers.signedOut = signedOut;
  handlers.enrollmentRequired = enrollmentRequired;
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/admin/v1${withProject(path)}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach openpurr. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const err = new ApiError(res.status, data.code || "error", data.message || `Request failed (HTTP ${res.status}).`, Array.isArray(data.problems) ? data.problems : null);
  const authCall = path.startsWith("/auth/");
  if (!authCall && err.code === "signed_out") handlers.signedOut?.();
  if (!authCall && err.code === "totp_enrollment_required") handlers.enrollmentRequired?.();
  throw err;
}

export const get = (path) => api("GET", path);
export const post = (path, body = {}) => api("POST", path, body);
export const patch = (path, body) => api("PATCH", path, body);
export const put = (path, body) => api("PUT", path, body);
export const del = (path) => api("DELETE", path);
