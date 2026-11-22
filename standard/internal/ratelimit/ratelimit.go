// Package ratelimit limits SDK requests per client IP and per app user, behind a small interface
// (lite/src/lib/rate-limit.ts), so a shared store (Redis, Postgres) can replace the in-memory one
// when Standard runs several replicas.
//
// The in-memory limiter is a token bucket per key: `limit` requests per minute, refilled
// continuously. With several replicas each counts on its own, so the effective limit is per
// replica: a guard against abuse, not an exact quota (Cloudflare's binding behaves the same way
// per location).
package ratelimit

import (
	"context"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/clock"
)

// Limiter decides whether a request is within the limit for a key. An implementation backed by a
// shared store should fail open: a limiter outage mustn't lock every user out of their purchases.
type Limiter interface {
	Allow(ctx context.Context, key string) bool
}

// Limiters are the SDK API's limiters. A nil limiter means no limit.
type Limiters struct {
	// Per client IP, across all SDK endpoints.
	IP Limiter
	// Per app (or secret key) and app user ID, on the subscriber endpoints.
	User Limiter
}

// Resetter is a limiter whose state can be cleared (conformance resets).
type Resetter interface {
	Reset()
}

// Memory is an in-memory token-bucket limiter.
type Memory struct {
	limit    float64
	periodMs float64
	clock    clock.Clock

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	at     int64
}

const maxBuckets = 100_000

// NewMemory allows `limit` requests per `periodMs` per key.
func NewMemory(limit int, periodMs int64, clk clock.Clock) *Memory {
	return &Memory{limit: float64(limit), periodMs: float64(periodMs), clock: clk, buckets: map[string]*bucket{}}
}

func (m *Memory) Allow(_ context.Context, key string) bool {
	now := m.clock.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	b := m.buckets[key]
	if b == nil {
		if len(m.buckets) >= maxBuckets {
			m.prune(now)
		}
		b = &bucket{tokens: m.limit, at: now}
		m.buckets[key] = b
	} else {
		elapsed := now - b.at
		if elapsed < 0 {
			elapsed = 0
		}
		b.tokens = min(m.limit, b.tokens+float64(elapsed)*m.limit/m.periodMs)
		b.at = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// prune drops buckets that have refilled completely (they're the same as a new bucket).
func (m *Memory) prune(now int64) {
	for k, b := range m.buckets {
		if b.tokens+float64(now-b.at)*m.limit/m.periodMs >= m.limit {
			delete(m.buckets, k)
		}
	}
	if len(m.buckets) >= maxBuckets {
		m.buckets = map[string]*bucket{}
	}
}

func (m *Memory) Reset() {
	m.mu.Lock()
	m.buckets = map[string]*bucket{}
	m.mu.Unlock()
}
