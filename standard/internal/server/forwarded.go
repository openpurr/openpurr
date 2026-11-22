package server

// Requests forwarded by a Lite deployment in forward mode (lite/src/lib/forward.ts), while it
// moves to this server: the Lite Worker sends every request on with three headers. With
// FORWARD_SECRET set and X-Openpurr-Forwarded matching it, this server answers as if it were at
// the address the client called: its host (the Pub/Sub audience, the dashboard's same-origin
// check, setup links, the OAuth issuer) and the client's IP (rate limits, the audit log). Without a
// match the headers are ignored, and they're removed either way.

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"
)

const (
	headerForwarded = "X-Openpurr-Forwarded"
	headerOrigin    = "X-Openpurr-Origin"
	headerClientIP  = "X-Openpurr-Client-IP"
)

type forwardedKey struct{}

type forwardedInfo struct {
	origin   string // scheme://host the client called
	clientIP string
}

// forwardedOf is the forwarding a request came through, or nil.
func forwardedOf(r *http.Request) *forwardedInfo {
	f, _ := r.Context().Value(forwardedKey{}).(*forwardedInfo)
	return f
}

func (s *server) acceptForwarding(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secret, origin, ip := r.Header.Get(headerForwarded), r.Header.Get(headerOrigin), r.Header.Get(headerClientIP)
		r.Header.Del(headerForwarded)
		r.Header.Del(headerOrigin)
		r.Header.Del(headerClientIP)
		if s.ForwardSecret != "" && secret != "" && subtle.ConstantTimeCompare([]byte(secret), []byte(s.ForwardSecret)) == 1 {
			if u, err := url.Parse(origin); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil {
				r.Host = u.Host
				r = r.WithContext(context.WithValue(r.Context(), forwardedKey{}, &forwardedInfo{origin: u.Scheme + "://" + u.Host, clientIP: ip}))
			}
		}
		next.ServeHTTP(w, r)
	})
}
