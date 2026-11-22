package testutil

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

// The webhook secrets of lite/test/helpers.ts.
const (
	WebhookAuth       = "Bearer hook-secret-123"
	WebhookSigningKey = "whsec_test_signing_key"
)

// WebhookSecrets are the secrets a webhook made by WebhookConfig names.
func WebhookSecrets() map[string]string {
	return map[string]string{"WEBHOOK_AUTH": WebhookAuth, "WEBHOOK_SECRET": WebhookSigningKey}
}

// MergeSecrets combines secret maps (later ones win).
func MergeSecrets(maps ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range maps {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// WebhookRequest is one delivery a WebhookReceiver got.
type WebhookRequest struct {
	// The endpoint name (the last path segment).
	Name   string
	URL    string
	Method string
	Header http.Header
	Raw    string
	Body   any
}

// WebhookReceiver records webhook deliveries (lite/test/helpers.ts webhookReceiver).
type WebhookReceiver struct {
	mu       sync.Mutex
	received []WebhookRequest
	status   func(WebhookRequest) int
	Server   *httptest.Server
}

// NewWebhookReceiver starts a receiver that answers 200 until told otherwise.
func NewWebhookReceiver(t testing.TB) *WebhookReceiver {
	w := &WebhookReceiver{}
	w.Server = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body, _ := jsobj.Parse(raw)
		req := WebhookRequest{
			Name:   r.URL.Path[strings.LastIndexByte(r.URL.Path, '/')+1:],
			URL:    "http://" + r.Host + r.URL.RequestURI(),
			Method: r.Method,
			Header: r.Header.Clone(),
			Raw:    string(raw),
			Body:   body,
		}
		w.mu.Lock()
		w.received = append(w.received, req)
		status := w.status
		w.mu.Unlock()
		code := http.StatusOK
		if status != nil {
			code = status(req)
		}
		rw.WriteHeader(code)
	}))
	t.Cleanup(w.Server.Close)
	return w
}

// URL is the URL of a named endpoint.
func (w *WebhookReceiver) URL(name string) string { return w.Server.URL + "/hooks/" + name }

// SetStatus changes how the receiver answers.
func (w *WebhookReceiver) SetStatus(fn func(WebhookRequest) int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.status = fn
}

// Received lists the deliveries so far, oldest first.
func (w *WebhookReceiver) Received() []WebhookRequest {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]WebhookRequest(nil), w.received...)
}

// Events are the received bodies' events.
func (w *WebhookReceiver) Events() []any {
	var out []any
	for _, r := range w.Received() {
		e, _ := jsobj.Prop(r.Body, "event")
		out = append(out, e)
	}
	return out
}

// Clear forgets what was received.
func (w *WebhookReceiver) Clear() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.received = nil
}

// WebhookConfig is a config (the test config when nil) with one endpoint, "backend", at the
// receiver, using the secrets WebhookSecrets holds. extra sets more endpoint fields as key, value
// pairs.
func (w *WebhookReceiver) WebhookConfig(raw any, extra ...any) any {
	if raw == nil {
		raw = testdata.TestConfig()
	}
	hook := jsobj.New("id", "backend", "url", w.URL("backend"), "authorization_secret", "WEBHOOK_AUTH", "signing_secret", "WEBHOOK_SECRET")
	for i := 0; i+1 < len(extra); i += 2 {
		hook.Set(extra[i].(string), extra[i+1])
	}
	raw.(*jsobj.Object).Set("webhooks", []any{hook})
	return raw
}
