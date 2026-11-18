// hono/tiny (PatternRouter): skips compiling the route table on a fresh isolate's first
// request, about 1 ms of CPU, and is about 15 KB smaller. Matching speed is the same for our routes.
import { Hono } from "hono/tiny";
import type { AppEnv, Deps } from "./env";

/**
 * The skeleton both Workers share: dependencies on every request, and JSON errors. `mount` adds
 * the routes. Each Worker's entry point imports only its own route modules, because route modules
 * register their routes when loaded and so can't be tree-shaken out of a bundle.
 */
export function createApp(deps: Deps, mount: (app: Hono<AppEnv>) => void) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  mount(app);

  app.notFound((c) => c.json({ code: 0, message: "Not found" }, 404));

  // Android treats an error without a JSON body as a connection failure, and iOS only parses
  // error bodies served as application/json. 7110 = internal server error in both SDKs.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ code: 7110, message: "Internal server error" }, 500);
  });

  return app;
}
