// Package outbound is the one HTTP client for calls to other services: store APIs, Google OAuth
// and OIDC keys, exchange rates and webhooks. In conformance mode its transport sends store and
// rate traffic to the conformance runner's fake servers instead.
package outbound

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

// RewrittenHosts are the hosts conformance mode redirects to the fakes.
var RewrittenHosts = []string{
	"api.storekit.apple.com",
	"api.storekit-sandbox.apple.com",
	"androidpublisher.googleapis.com",
	"oauth2.googleapis.com",
	"www.googleapis.com",
	"www.ecb.europa.eu",
	"api.cloudflare.com",
}

// NewClient returns the outbound client. With a non-empty storeBase (conformance mode), requests
// to https://<host><path>?<query> for a host in RewrittenHosts go to
// <storeBase>/<host><path>?<query>.
func NewClient(storeBase string) *http.Client {
	var transport http.RoundTripper = http.DefaultTransport
	if storeBase != "" {
		transport = &Rewrite{Base: strings.TrimRight(storeBase, "/"), Next: http.DefaultTransport}
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second}
}

// Rewrite is a RoundTripper that redirects the RewrittenHosts to Base.
type Rewrite struct {
	Base string
	Next http.RoundTripper
}

func (rw *Rewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || !rewritten(req.URL.Hostname()) {
		return rw.Next.RoundTrip(req)
	}
	target := rw.Base + "/" + req.URL.Hostname() + req.URL.EscapedPath()
	if req.URL.RawQuery != "" {
		target += "?" + req.URL.RawQuery
	}
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	out := req.Clone(req.Context())
	out.URL = u
	out.Host = u.Host
	return rw.Next.RoundTrip(out)
}

func rewritten(host string) bool {
	host = strings.ToLower(host)
	for _, h := range RewrittenHosts {
		if h == host {
			return true
		}
	}
	return false
}
