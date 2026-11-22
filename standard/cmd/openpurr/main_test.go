package main

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestCloudLoggingFormat(t *testing.T) {
	for _, c := range []struct {
		format  string
		cloud   bool
		wantKey string
	}{
		{"", false, "level"},
		{"", true, "severity"},
		{"gcp", false, "severity"},
		{"json", true, "level"},
	} {
		var buf bytes.Buffer
		log, err := newLogger(&buf, c.format, "debug", c.cloud)
		if err != nil {
			t.Fatal(err)
		}
		log.Debug("d")
		log.Info("i", "n", 1)
		log.Warn("w")
		log.Error("e")
		var levels []string
		for _, line := range bytes.Split(bytes.TrimSpace(buf.Bytes()), []byte("\n")) {
			var m map[string]any
			if err := json.Unmarshal(line, &m); err != nil {
				t.Fatal(err)
			}
			levels = append(levels, m[c.wantKey].(string))
			if c.wantKey == "severity" && (m["message"] == nil || m["msg"] != nil || m["level"] != nil) {
				t.Fatalf("%s", line)
			}
		}
		want := "DEBUG INFO WARN ERROR"
		if c.wantKey == "severity" {
			want = "DEBUG INFO WARNING ERROR"
		}
		if got := join(levels); got != want {
			t.Fatalf("%q/%v: %s", c.format, c.cloud, got)
		}
	}
	if _, err := newLogger(&bytes.Buffer{}, "text", "", false); err == nil {
		t.Fatal("LOG_FORMAT=text accepted")
	}
}

func join(s []string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += " "
		}
		out += v
	}
	return out
}

func TestShutdownTimeout(t *testing.T) {
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "")
	if d, _ := shutdownTimeout(false); d != 25*time.Second {
		t.Fatal(d)
	}
	if d, _ := shutdownTimeout(true); d != 8*time.Second {
		t.Fatal(d)
	}
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "5")
	if d, _ := shutdownTimeout(true); d != 5*time.Second {
		t.Fatal(d)
	}
}
