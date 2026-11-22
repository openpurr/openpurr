// Package clock is the one source of the current time. Everything reads time through a Clock, so
// conformance mode can move the server's time forward (expiry, grace periods and retries then run
// in seconds) and tests can fix it.
package clock

import (
	"sync"
	"time"
)

// Clock returns the current time in epoch milliseconds, the unit every table uses.
type Clock interface {
	Now() int64
}

// System is the real time.
type System struct{}

func (System) Now() int64 { return time.Now().UnixMilli() }

// Adjustable is a clock running at real speed with an offset. Conformance mode moves it with
// Advance and Set; Reset puts it back to real time.
type Adjustable struct {
	base   Clock
	mu     sync.Mutex
	offset int64
}

func NewAdjustable(base Clock) *Adjustable {
	if base == nil {
		base = System{}
	}
	return &Adjustable{base: base}
}

func (a *Adjustable) Now() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.base.Now() + a.offset
}

// Advance moves the clock forward by ms (backward if negative) and returns the new time.
func (a *Adjustable) Advance(ms int64) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.offset += ms
	return a.base.Now() + a.offset
}

// Set makes the clock read nowMs from this moment on, and returns it.
func (a *Adjustable) Set(nowMs int64) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.offset = nowMs - a.base.Now()
	return nowMs
}

// Reset removes the offset.
func (a *Adjustable) Reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.offset = 0
}

// Fixed always returns the same time (tests). Set it with Store.
type Fixed struct {
	mu sync.Mutex
	ms int64
}

func NewFixed(ms int64) *Fixed { return &Fixed{ms: ms} }

func (f *Fixed) Now() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ms
}

func (f *Fixed) Store(ms int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ms = ms
}

// Add moves a fixed clock by ms.
func (f *Fixed) Add(ms int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ms += ms
}
