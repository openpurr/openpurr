package server

// The dashboard: Lite's lite/office-ui, embedded unchanged (internal/officeui). Lite serves it as
// Cloudflare static assets with single-page-application fallback; here, a GET for one of its files
// gets that file, and any other page under /admin (except the API) gets index.html, which routes in
// the browser. Every file gets the headers of the dashboard's own _headers file (the
// Content-Security-Policy and friends), so the policy has one source.

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

type dashboardFile struct {
	data        []byte
	etag        string
	contentType string
}

type dashboard struct {
	files   map[string]*dashboardFile
	headers [][2]string
}

// loadDashboard reads every file once: it's small (about 1.5 MB) and served often.
func loadDashboard(fsys fs.FS) *dashboard {
	d := &dashboard{files: map[string]*dashboardFile{}}
	if fsys == nil {
		return d
	}
	_ = fs.WalkDir(fsys, ".", func(p string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || strings.HasPrefix(path.Base(p), ".") {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return nil
		}
		if p == "_headers" {
			d.headers = parseHeaders(data)
			return nil
		}
		sum := sha256.Sum256(data)
		ct := mime.TypeByExtension(path.Ext(p))
		if ct == "" {
			ct = http.DetectContentType(data)
		}
		d.files["/"+p] = &dashboardFile{data: data, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, contentType: ct}
		return nil
	})
	return d
}

// parseHeaders reads the "/*" rule of a Cloudflare _headers file.
func parseHeaders(data []byte) [][2]string {
	var out [][2]string
	rule := ""
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		line := sc.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if line[0] != ' ' && line[0] != '\t' {
			rule = trimmed
			continue
		}
		if rule != "/*" {
			continue
		}
		if i := strings.IndexByte(trimmed, ':'); i > 0 {
			out = append(out, [2]string{strings.TrimSpace(trimmed[:i]), strings.TrimSpace(trimmed[i+1:])})
		}
	}
	return out
}

// isDashboardPage is a path the dashboard routes in the browser.
func isDashboardPage(p string) bool {
	return p == "/" || p == "/admin" || (strings.HasPrefix(p, "/admin/") && !strings.HasPrefix(p, "/admin/v1/") && p != "/admin/v1")
}

// serveDashboard answers a GET or HEAD for a dashboard file or page; false if it isn't one.
func (s *server) serveDashboard(w http.ResponseWriter, r *http.Request) bool {
	d := s.dash
	p := r.URL.Path
	f := d.files[p]
	if f == nil && p != "/index.html" && isDashboardPage(p) {
		f = d.files["/index.html"]
		if f == nil {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("This openpurr build has no dashboard. Build it after `go generate ./internal/officeui` (the Dockerfile does that), or use the admin API at /admin/v1.\n"))
			return true
		}
	}
	if f == nil {
		return false
	}
	for _, h := range d.headers {
		w.Header().Set(h[0], h[1])
	}
	w.Header().Set("Content-Type", f.contentType)
	w.Header().Set("ETag", f.etag)
	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(f.data))
	return true
}
