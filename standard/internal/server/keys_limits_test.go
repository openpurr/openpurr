package server_test

// Secret keys and rate limits. Mirrors lite/test/secret-keys.test.ts and rate-limit.test.ts.

import (
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

type keyOpts struct {
	scopes    string
	expiresAt *int64
	revoked   bool
	project   string
}

func createKey(t *testing.T, env *tu.Env, o keyOpts) (string, string) {
	t.Helper()
	var b [32]byte
	_, _ = rand.Read(b[:])
	key := "sk_" + hex.EncodeToString(b[:])
	id := "key_" + hex.EncodeToString(b[:4])
	if o.scopes == "" {
		o.scopes = `["customers:read"]`
	}
	if o.project == "" {
		o.project = "default"
	}
	var revoked *int64
	if o.revoked {
		revoked = tu.Ms(env.Clock.Now())
	}
	env.Exec(`INSERT INTO api_key (id, project_id, key_hash, key_prefix, name, scopes, created_at, expires_at, revoked_at)
		VALUES ($1, $2, $3, $4, 'test', $5, $6, $7, $8)`, id, o.project, secretkeys.Hash(key), key[:10], o.scopes, env.Clock.Now(), o.expiresAt, revoked)
	return key, id
}

func serverGet(env *tu.Env, user, key string, headers map[string]string) *tu.Response {
	h := map[string]string{"X-Platform": ""}
	for k, v := range headers {
		h[k] = v
	}
	return env.Call("/v1/subscribers/"+url.PathEscape(user), tu.CallOptions{Key: tu.Key(key), Headers: h})
}

func TestSecretKeys(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("read full CustomerInfo including subscriber attributes", func(t *testing.T) {
		env.Purchase("default", "srv-user", tu.Tx{ProductID: "pro_annual", ExpiresAt: tu.Ms(now + 300*tu.Day)})
		env.Call("/v1/subscribers/srv-user/attributes", tu.CallOptions{Body: `{"attributes":{"$email":{"value":"s@example.com","updated_at_ms":5}}}`})
		key, _ := createKey(t, env, keyOpts{})
		res := serverGet(env, "srv-user", key, nil)
		if res.Status != 200 {
			t.Fatal(res.Status, string(res.Body))
		}
		body := res.JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "pro_annual" ||
			jsobj.Stringify(prop(body, "subscriber", "subscriber_attributes")) != `{"$email":{"value":"s@example.com","updated_at_ms":5}}` {
			t.Fatal(string(res.Body))
		}
		// SDK keys never see attributes, as with RevenueCat.
		sdk := env.Call("/v1/subscribers/srv-user", tu.CallOptions{})
		if jsobj.Stringify(prop(sdk.JSON(t), "subscriber", "subscriber_attributes")) != "{}" {
			t.Fatal(string(sdk.Body))
		}
	})

	t.Run("support If-None-Match, with an ETag that also changes when attributes change", func(t *testing.T) {
		env.Purchase("default", "srv-etag", tu.Tx{})
		key, _ := createKey(t, env, keyOpts{})
		etag := serverGet(env, "srv-etag", key, nil).Header.Get("ETag")
		if len(etag) != 26 || !strings.HasPrefix(etag, `"`) {
			t.Fatalf("ETag %q", etag)
		}
		// last_seen changes with the clock but isn't part of the ETag.
		env.Clock.Add(5000)
		nm := serverGet(env, "srv-etag", key, map[string]string{"If-None-Match": `"other", ` + etag})
		if nm.Status != 304 || nm.Header.Get("ETag") != etag || len(nm.Body) != 0 {
			t.Fatal(nm.Status, nm.Header.Get("ETag"))
		}
		env.Call("/v1/subscribers/srv-etag/attributes", tu.CallOptions{Body: `{"attributes":{"plan":{"value":"family","updated_at_ms":9}}}`})
		changed := serverGet(env, "srv-etag", key, map[string]string{"If-None-Match": etag})
		if changed.Status != 200 || changed.Header.Get("ETag") == etag {
			t.Fatal(changed.Status)
		}
		// SDK requests never get a 304, whatever they send.
		if r := env.Call("/v1/subscribers/srv-etag", tu.CallOptions{Headers: map[string]string{"If-None-Match": etag}}); r.Status != 200 {
			t.Fatal(r.Status)
		}
	})

	t.Run("reject unknown, revoked and expired keys with 401", func(t *testing.T) {
		revoked, _ := createKey(t, env, keyOpts{revoked: true})
		expired, _ := createKey(t, env, keyOpts{expiresAt: tu.Ms(now - 1000)})
		for _, key := range []string{"sk_not_a_real_key_00000000000000", revoked, expired, "sk_short"} {
			res := serverGet(env, "srv-x", key, nil)
			if res.Status != 401 || prop(res.JSON(t), "code") != 7225.0 {
				t.Errorf("%s: %d", key, res.Status)
			}
		}
	})

	t.Run("keep working during a rotation overlap until the old key expires", func(t *testing.T) {
		old, _ := createKey(t, env, keyOpts{expiresAt: tu.Ms(now + 3_600_000)})
		if res := serverGet(env, "srv-rotate", old, nil); res.Status != 200 {
			t.Fatal(res.Status)
		}
	})

	t.Run("stop working within a minute of being revoked", func(t *testing.T) {
		key, id := createKey(t, env, keyOpts{})
		if res := serverGet(env, "srv-revoke", key, nil); res.Status != 200 {
			t.Fatal(res.Status)
		}
		env.Exec("UPDATE api_key SET revoked_at = $1 WHERE id = $2", env.Clock.Now(), id)
		if res := serverGet(env, "srv-revoke", key, nil); res.Status != 200 {
			t.Fatal("cached for up to a minute", res.Status)
		}
		env.Clock.Add(61_000)
		if res := serverGet(env, "srv-revoke", key, nil); res.Status != 401 {
			t.Fatal(res.Status)
		}
	})

	t.Run("can only read customers", func(t *testing.T) {
		key, _ := createKey(t, env, keyOpts{})
		for _, c := range []struct {
			path string
			body any
		}{
			{"/v1/subscribers/srv-y/offerings", nil},
			{"/v1/product_entitlement_mapping", nil},
			{"/v1/receipts", `{"app_user_id":"srv-y","fetch_token":"x"}`},
			{"/v1/subscribers/srv-y/attributes", `{"attributes":{}}`},
		} {
			res := env.Call(c.path, tu.CallOptions{Key: tu.Key(key), Body: c.body})
			if res.Status != 403 || prop(res.JSON(t), "code") != 7225.0 {
				t.Errorf("%s: %d", c.path, res.Status)
			}
		}
		noScope, _ := createKey(t, env, keyOpts{scopes: "[]"})
		if res := serverGet(env, "srv-y", noScope, nil); res.Status != 403 {
			t.Fatal(res.Status)
		}
	})

	t.Run("record last use at most hourly", func(t *testing.T) {
		key, id := createKey(t, env, keyOpts{})
		serverGet(env, "srv-touch", key, nil)
		first := env.Clock.Now()
		env.Clock.Add(1000)
		serverGet(env, "srv-touch", key, nil)
		var lastUsed int64
		if err := env.Pool.QueryRow(t.Context(), "SELECT last_used_at FROM api_key WHERE id = $1", id).Scan(&lastUsed); err != nil {
			t.Fatal(err)
		}
		if lastUsed != first {
			t.Fatalf("last_used_at %d, want %d", lastUsed, first)
		}
	})

	t.Run("read only their own project's customers", func(t *testing.T) {
		key, _ := createKey(t, env, keyOpts{project: "gone"})
		if res := serverGet(env, "srv-z", key, nil); res.Status != 401 || !strings.Contains(string(res.Body), "no longer exists") {
			t.Fatal(res.Status, string(res.Body))
		}
	})
}

func TestSecretKeysSkipTheIPLimitWhenValid(t *testing.T) {
	one := 1
	env := tu.Start(t, tu.Options{IPLimit: &one})
	key, _ := createKey(t, env, keyOpts{})
	ip := map[string]string{"CF-Connecting-IP": "9.9.9.9"}
	for i := 0; i < 3; i++ {
		if res := env.Call("/v1/subscribers/srv-ip", tu.CallOptions{Key: tu.Key(key), Headers: ip}); res.Status != 200 {
			t.Fatal(res.Status)
		}
	}
	// Failed attempts still count against the IP.
	if res := env.Call("/v1/subscribers/srv-ip", tu.CallOptions{Key: tu.Key("sk_wrong_wrong_wrong_wrong_0000"), Headers: ip}); res.Status != 401 {
		t.Fatal(res.Status)
	}
	if res := env.Call("/v1/subscribers/srv-ip", tu.CallOptions{Key: tu.Key("sk_wrong_wrong_wrong_wrong_0001"), Headers: ip}); res.Status != 429 {
		t.Fatal(res.Status)
	}
}

func TestRateLimits(t *testing.T) {
	fromIP := func(ip string) map[string]string { return map[string]string{"CF-Connecting-IP": ip} }

	t.Run("answers 429 with a JSON body and Retry-After once an IP is over its limit", func(t *testing.T) {
		two := 2
		env := tu.Start(t, tu.Options{IPLimit: &two})
		for i := 0; i < 2; i++ {
			if res := env.Call("/v1/subscribers/u1", tu.CallOptions{Headers: fromIP("1.1.1.1")}); res.Status != 200 {
				t.Fatal(res.Status)
			}
		}
		res := env.Call("/v1/subscribers/u1", tu.CallOptions{Headers: fromIP("1.1.1.1")})
		if res.Status != 429 || res.Header.Get("Retry-After") != "60" || string(res.Body) != `{"code":0,"message":"Too many requests."}` {
			t.Fatal(res.Status, string(res.Body))
		}
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{Headers: fromIP("2.2.2.2")}); res.Status != 200 {
			t.Fatal("other IPs are unaffected")
		}
	})

	t.Run("limits by IP before checking the API key", func(t *testing.T) {
		one := 1
		env := tu.Start(t, tu.Options{IPLimit: &one})
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{Key: tu.Key("appl_guess_0000000000"), Headers: fromIP("3.3.3.3")}); res.Status != 401 {
			t.Fatal(res.Status)
		}
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{Key: tu.Key("appl_guess_0000000001"), Headers: fromIP("3.3.3.3")}); res.Status != 429 {
			t.Fatal(res.Status)
		}
	})

	t.Run("answers 503, never 429, on /receipts, so Android keeps the purchase queued", func(t *testing.T) {
		zero := 0
		env := tu.Start(t, tu.Options{UserLimit: &zero})
		res := env.Call("/v1/receipts", tu.CallOptions{Body: `{"app_user_id":"rl-receipt","fetch_token":"x.y.z"}`})
		if res.Status != 503 || res.Header.Get("Retry-After") != "60" || prop(res.JSON(t), "code") != 7110.0 ||
			prop(res.JSON(t), "message") != "Too many requests; the purchase will be retried." {
			t.Fatal(res.Status, string(res.Body))
		}
	})

	t.Run("limits per app user, counting iOS's raw and Android's encoded IDs as one user", func(t *testing.T) {
		two := 2
		env := tu.Start(t, tu.Options{UserLimit: &two})
		if res := env.Call("/v1/subscribers/"+tu.Anon, tu.CallOptions{}); res.Status != 200 {
			t.Fatal(res.Status)
		}
		if res := env.Call("/v1/subscribers/"+url.PathEscape(tu.Anon)+"/offerings", tu.CallOptions{}); res.Status != 200 {
			t.Fatal(res.Status)
		}
		if res := env.Call("/v1/subscribers/"+tu.Anon, tu.CallOptions{}); res.Status != 429 {
			t.Fatal(res.Status)
		}
		if env.Counts["user:ios:"+tu.Anon] != 3 {
			t.Fatal(env.Counts)
		}
		if res := env.Call("/v1/subscribers/someone-else", tu.CallOptions{}); res.Status != 200 {
			t.Fatal(res.Status)
		}
		// logIn is keyed by the body's app_user_id.
		login := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: `{"app_user_id":"fresh-anon","new_app_user_id":"fresh@example"}`})
		if login.Status != 201 || env.Counts["user:ios:fresh-anon"] != 1 {
			t.Fatal(login.Status, env.Counts)
		}
	})

	t.Run("the health check isn't limited", func(t *testing.T) {
		zero := 0
		env := tu.Start(t, tu.Options{IPLimit: &zero})
		if res := env.Call("/v1/subscribers/x/health_report_availability", tu.CallOptions{Headers: fromIP("4.4.4.4")}); res.Status != 200 {
			t.Fatal(res.Status)
		}
	})
}
