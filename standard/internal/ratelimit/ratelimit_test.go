package ratelimit

import (
	"context"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/clock"
)

func TestMemoryRefillsOverThePeriod(t *testing.T) {
	clk := clock.NewFixed(1_000_000)
	m := NewMemory(3, 60_000, clk)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if !m.Allow(ctx, "a") {
			t.Fatal("within the limit")
		}
	}
	if m.Allow(ctx, "a") {
		t.Fatal("over the limit")
	}
	if !m.Allow(ctx, "b") {
		t.Fatal("other keys are separate")
	}
	clk.Add(20_000) // one request's worth
	if !m.Allow(ctx, "a") || m.Allow(ctx, "a") {
		t.Fatal("refill")
	}
	m.Reset()
	if !m.Allow(ctx, "a") {
		t.Fatal("reset")
	}
	if NewMemory(0, 60_000, clk).Allow(ctx, "x") {
		t.Fatal("a zero limit allows nothing")
	}
}
