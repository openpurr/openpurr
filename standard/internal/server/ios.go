package server

// The iOS app's sign-in, a port of lite/src/office/ios.ts. There's no App Store build yet: each
// operator builds the app under their own Apple team and bundle ID (apps/ios/), so each deployment
// describes its own app:
//
//	/app/ios-client.json                      the app's OAuth client, as a Client ID Metadata
//	                                          Document. Resolved locally by resolveClient (never
//	                                          fetched over the network).
//	/app/oauth-callback                       where sign-in returns. ASWebAuthenticationSession
//	                                          catches it on the phone; a browser that lands here
//	                                          gets a short note instead.
//	/.well-known/apple-app-site-association   ties this domain to the app, so iOS hands the
//	                                          callback to it. Needs the ios_app_id setting
//	                                          ("<team ID>.<bundle ID>"); a 404 until it's set.
//
// The app asks for tokens for resource=<origin>/admin/v1 (oauth.go), so they work at the admin API
// and nowhere else.

import (
	"context"
	"net/http"
	"regexp"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

const (
	iosClientPath   = "/app/ios-client.json"
	iosCallbackPath = "/app/oauth-callback"
	iosClientName   = "openpurr for iOS"
	iosAppIDSetting = "ios_app_id"
)

// iosAppIDPattern is an Apple app ID: a 10-character team ID, a dot, and the bundle ID.
var iosAppIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$`)

// parseIOSAppID checks an ios_app_id setting; the problem is "" when it's fine.
func parseIOSAppID(value string) (string, string) {
	v := jsobj.Trim(value)
	if !iosAppIDPattern.MatchString(v) || len(v) > 200 {
		return "", "ios_app_id is your Apple team ID, a dot and the app's bundle ID, for example ABCDE12345.com.example.purr."
	}
	return v, ""
}

func (s *server) storedIOSAppID(ctx context.Context) (*string, error) {
	v, err := s.setting(ctx, iosAppIDSetting)
	if err != nil || v == nil || *v == "" {
		return nil, err
	}
	return v, nil
}

// setIOSAppID stores the setting, or removes it when appID is nil.
func setIOSAppID(ctx context.Context, tx pgx.Tx, appID *string, now int64) error {
	if appID == nil {
		_, err := tx.Exec(ctx, "DELETE FROM setting WHERE key = $1", iosAppIDSetting)
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO setting (key, value, updated_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, iosAppIDSetting, *appID, now)
	return err
}

func iosClientID(origin string) string { return origin + iosClientPath }

// iosClient is the app's client, as resolveClient returns it.
func iosClient(origin string) *oauthClient {
	return &oauthClient{id: iosClientID(origin), kind: "metadata_document", name: iosClientName, redirectURIs: []string{origin + iosCallbackPath}}
}

// iosRoute serves /app/*: the client document and the callback page. False when the path is neither.
func (s *server) iosRoute(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	switch r.URL.EscapedPath() {
	case iosClientPath:
		c := iosClient(s.requestOrigin(r))
		w.Header().Set("Cache-Control", "public, max-age=3600")
		writeJSON(w, http.StatusOK, jsobj.New(
			"client_id", c.id,
			"client_name", c.name,
			"redirect_uris", stringsToAny(c.redirectURIs),
			"grant_types", []any{"authorization_code", "refresh_token"},
			"response_types", []any{"code"},
			"token_endpoint_auth_method", "none",
		))
		return true
	case iosCallbackPath:
		h := w.Header()
		h.Set("Content-Type", "text/plain; charset=UTF-8")
		h.Set("Cache-Control", "no-store")
		h.Set("Referrer-Policy", "no-referrer")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Signing in finishes in the openpurr app. If you see this page, open the app and try again."))
		return true
	}
	return false
}

// appleAppSiteAssociation serves /.well-known/apple-app-site-association.
func (s *server) appleAppSiteAssociation(w http.ResponseWriter, r *http.Request) {
	appID, err := s.storedIOSAppID(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if appID == nil {
		writeJSON(w, http.StatusNotFound, jsobj.New("code", "not_found", "message", "No iOS app is set up for this deployment (the ios_app_id setting)."))
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, jsobj.New(
		"applinks", jsobj.New("details", []any{jsobj.New("appIDs", []any{*appID}, "components", []any{jsobj.New("/", iosCallbackPath)})}),
		"webcredentials", jsobj.New("apps", []any{*appID}),
	))
}
