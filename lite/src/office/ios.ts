// The iOS app's sign-in. There's no App Store build yet: each operator builds the app under their own
// Apple team and bundle ID (apps/ios/), so each deployment describes its own app:
//
//   /app/ios-client.json                      the app's OAuth client, as a Client ID Metadata
//                                             Document. Resolved locally by oauth.ts (never
//                                             fetched over the network).
//   /app/oauth-callback                       where sign-in returns. ASWebAuthenticationSession
//                                             catches it on the phone; a browser that lands here
//                                             gets a short note instead.
//   /.well-known/apple-app-site-association   ties this domain to the app, so iOS hands the
//                                             callback to it. Needs the ios_app_id setting
//                                             ("<team ID>.<bundle ID>"); a 404 until it's set.
//
// The app asks for tokens for resource=<origin>/admin/v1 (see oauth.ts), so they work at the admin
// API and nowhere else.

import type { Context, Hono } from "hono";
import type { AppEnv } from "../env";

type Ctx = Context<AppEnv>;

export const IOS_CLIENT_PATH = "/app/ios-client.json";
export const IOS_CALLBACK_PATH = "/app/oauth-callback";
export const IOS_CLIENT_NAME = "openpurr for iOS";
const SETTING = "ios_app_id";

/** An Apple app ID: a 10-character team ID, a dot, and the bundle ID. */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function parseIosAppId(value: string): { appId: string } | { error: string } {
  const v = value.trim();
  if (!APP_ID.test(v) || v.length > 200) {
    return { error: "ios_app_id is your Apple team ID, a dot and the app's bundle ID, for example ABCDE12345.com.example.purr." };
  }
  return { appId: v };
}

export async function storedIosAppId(db: D1Database) {
  return (await db.prepare("SELECT value FROM setting WHERE key = ?").bind(SETTING).first<{ value: string }>())?.value ?? null;
}

export const iosAppIdSetting = (db: D1Database, appId: string | null) =>
  appId
    ? db
        .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(SETTING, appId, Date.now())
    : db.prepare("DELETE FROM setting WHERE key = ?").bind(SETTING);

const origin = (c: Ctx) => new URL(c.req.url).origin;
export const iosClientId = (c: Ctx) => `${origin(c)}${IOS_CLIENT_PATH}`;

/** The app's client, as oauth.ts uses it. */
export const iosClient = (c: Ctx) => ({
  id: iosClientId(c),
  kind: "metadata_document" as const,
  name: IOS_CLIENT_NAME,
  client_uri: null,
  redirect_uris: [`${origin(c)}${IOS_CALLBACK_PATH}`],
});

export function mountIos(app: Hono<AppEnv>) {
  app.get(IOS_CLIENT_PATH, (c) => {
    const client = iosClient(c);
    return c.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  });

  app.get(IOS_CALLBACK_PATH, (c) =>
    c.text("Signing in finishes in the openpurr app. If you see this page, open the app and try again.", 200, {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
  );

  app.get("/.well-known/apple-app-site-association", async (c) => {
    const appId = await storedIosAppId(c.env.DB);
    if (!appId) return c.json({ code: "not_found", message: "No iOS app is set up for this deployment (the ios_app_id setting)." }, 404);
    return c.json(
      {
        applinks: { details: [{ appIDs: [appId], components: [{ "/": IOS_CALLBACK_PATH }] }] },
        webcredentials: { apps: [appId] },
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  });
}
