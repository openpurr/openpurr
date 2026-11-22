package server_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/server"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const conformanceToken = "conformance-token"

func control(t *testing.T, env *tu.Env, path, token, body string) (int, any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, env.Server.URL+"/__conformance/"+path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	v, err := jsobj.Parse(data)
	if err != nil {
		t.Fatalf("%s: not JSON: %s", path, data)
	}
	return res.StatusCode, v
}

func TestConformanceRoutes(t *testing.T) {
	env := tu.Start(t, tu.Options{ConformanceToken: conformanceToken})

	t.Run("answer 404 without the token, or outside conformance mode", func(t *testing.T) {
		for _, token := range []string{"", "wrong"} {
			if status, _ := control(t, env, "reset", token, "{}"); status != 404 {
				t.Errorf("token %q: %d", token, status)
			}
		}
		plain := tu.Start(t, tu.Options{})
		if status, _ := control(t, plain, "reset", conformanceToken, "{}"); status != 404 {
			t.Error("conformance routes outside conformance mode")
		}
	})

	t.Run("reset wipes the data, loads the config and creates an owner token", func(t *testing.T) {
		env.Purchase("default", "someone", tu.Tx{})
		status, body := control(t, env, "reset", conformanceToken, `{}`)
		token, _ := prop(body, "owner_token").(string)
		if status != 200 || !strings.HasPrefix(token, server.AccessTokenPrefix) {
			t.Fatal(status, jsobj.Stringify(body))
		}
		if env.Count("customer") != 0 || env.Count("store_transaction") != 0 {
			t.Fatal("data left after reset")
		}
		var email, role, scopes, prefix string
		err := env.Pool.QueryRow(t.Context(),
			`SELECT o.email, o.role, t.scopes, t.token_prefix FROM access_token t JOIN operator o ON o.id = t.operator_id WHERE t.token_hash = encode(sha256($1::bytea), 'hex')`,
			token).Scan(&email, &role, &scopes, &prefix)
		if err != nil {
			t.Fatal(err)
		}
		if email != "owner@conformance.test" || role != "owner" || scopes != `["read","write:grants","write:webhooks","write:config","admin"]` || prefix != token[:10] {
			t.Fatal(email, role, scopes, prefix)
		}
		v, err := config.CurrentVersion(t.Context(), env.Pool)
		if err != nil || v == nil || *v.CreatedBy != "conformance" || *v.Note != "Conformance reset" {
			t.Fatal(v, err)
		}
		// The default config serves the test apps.
		if res := env.Call("/v1/subscribers/u1/offerings", tu.CallOptions{}); res.Status != 200 {
			t.Fatal(res.Status)
		}
	})

	t.Run("reset with a config uses it at once", func(t *testing.T) {
		status, _ := control(t, env, "reset", conformanceToken, `{"config":`+jsobj.Stringify(twoProjects())+`}`)
		if status != 200 {
			t.Fatal(status)
		}
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{}); res.Status != 401 {
			t.Fatal("the old config's keys still work", res.Status)
		}
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{Key: tu.Key(roseKey)}); res.Status != 200 {
			t.Fatal(res.Status)
		}
	})

	t.Run("reset refuses an invalid config with invalid_config", func(t *testing.T) {
		status, body := control(t, env, "reset", conformanceToken, `{"config":{"version":2,"projects":{"x":{"apps":1}}}}`)
		if status != 400 || prop(body, "code") != "invalid_config" || !strings.Contains(prop(body, "message").(string), "projects.x.apps") {
			t.Fatal(status, jsobj.Stringify(body))
		}
	})

	t.Run("clock moves the server's time, and reset puts it back", func(t *testing.T) {
		status, body := control(t, env, "clock", conformanceToken, `{"advance_ms":86400000}`)
		if status != 200 || prop(body, "now_ms") != float64(tu.T0+tu.Day) {
			t.Fatal(status, jsobj.Stringify(body))
		}
		res := env.Call("/v1/subscribers/u1", tu.CallOptions{Key: tu.Key(roseKey)})
		if prop(res.JSON(t), "request_date_ms") != float64(tu.T0+tu.Day) {
			t.Fatal(string(res.Body))
		}
		_, body = control(t, env, "clock", conformanceToken, `{"now_ms":1900000000000}`)
		if prop(body, "now_ms") != 1.9e12 {
			t.Fatal(jsobj.Stringify(body))
		}
		if status, body := control(t, env, "clock", conformanceToken, `{"advance_ms":"soon"}`); status != 400 || prop(body, "code") != "bad_request" {
			t.Fatal(status)
		}
		control(t, env, "reset", conformanceToken, `{}`)
		if res := env.Call("/v1/subscribers/u1", tu.CallOptions{}); prop(res.JSON(t), "request_date_ms") != float64(tu.T0) {
			t.Fatal(string(res.Body))
		}
	})

	t.Run("jobs runs the registered jobs", func(t *testing.T) {
		ran := 0
		env.Deps.Jobs.Register(jobForTest(&ran))
		status, body := control(t, env, "jobs", conformanceToken, `{}`)
		if status != 200 || jsobj.Stringify(body) != "{}" || ran != 1 {
			t.Fatal(status, ran)
		}
	})
}
