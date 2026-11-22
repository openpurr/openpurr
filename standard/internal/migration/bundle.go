package migration

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Manifest is a bundle's manifest.json (spec/export-bundle.md, spec/export-bundle.schema.json).
type Manifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Kind      string `json:"kind"` // full | delta
	CreatedAt string `json:"created_at"`
	Source    struct {
		URL     string  `json:"url"`
		Edition string  `json:"edition"`
		Schema  *string `json:"schema"`
	} `json:"source"`
	StartedAtMs int64   `json:"started_at_ms"`
	SinceMs     *int64  `json:"since_ms"`
	PreviousID  *string `json:"previous_id"`
	Options     struct {
		OptionalColumns bool `json:"optional_columns"`
	} `json:"options"`
	Tables           []FileEntry `json:"tables"`
	DeletedCustomers *FileEntry  `json:"deleted_customers"`
	CustomerIndex    *FileEntry  `json:"customer_index"`
}

// FileEntry is one NDJSON file of a bundle.
type FileEntry struct {
	Name   string `json:"name,omitempty"`
	File   string `json:"file"`
	Rows   int64  `json:"rows"`
	SHA256 string `json:"sha256"`
}

// Bundle is an export bundle on disk.
type Bundle struct {
	Dir      string
	Manifest Manifest
}

// OpenBundle reads and checks a bundle's manifest.
func OpenBundle(dir string) (*Bundle, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("reading the bundle: %w", err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("manifest.json isn't valid: %w", err)
	}
	if m.Format != Format {
		return nil, fmt.Errorf("%s isn't an openpurr export bundle (format %q)", dir, m.Format)
	}
	if m.Version != Version {
		return nil, fmt.Errorf("the bundle is format version %d; this server reads version %d", m.Version, Version)
	}
	if m.ID == "" {
		return nil, errors.New("manifest.json has no id")
	}
	switch m.Kind {
	case "full":
	case "delta":
		if m.SinceMs == nil {
			return nil, errors.New("a delta bundle needs since_ms")
		}
	default:
		return nil, fmt.Errorf("unknown bundle kind %q", m.Kind)
	}
	seen := map[string]bool{}
	for _, e := range m.Tables {
		if TableNamed(e.Name) == nil {
			return nil, fmt.Errorf("the bundle has a table this server doesn't know: %s (a newer openpurr?)", e.Name)
		}
		if seen[e.Name] {
			return nil, fmt.Errorf("the bundle lists %s twice", e.Name)
		}
		seen[e.Name] = true
		if err := checkFileName(e.File); err != nil {
			return nil, err
		}
	}
	for _, e := range []*FileEntry{m.DeletedCustomers, m.CustomerIndex} {
		if e != nil {
			if err := checkFileName(e.File); err != nil {
				return nil, err
			}
		}
	}
	return &Bundle{Dir: dir, Manifest: m}, nil
}

// A file name inside the bundle: relative, no "..".
func checkFileName(name string) error {
	if name == "" || filepath.IsAbs(name) || strings.Contains(name, "..") || strings.Contains(name, "\\") {
		return fmt.Errorf("manifest.json names a file outside the bundle: %q", name)
	}
	return nil
}

// Entry returns the manifest entry of a table, or nil if the bundle doesn't have it.
func (b *Bundle) Entry(table string) *FileEntry {
	for i := range b.Manifest.Tables {
		if b.Manifest.Tables[i].Name == table {
			return &b.Manifest.Tables[i]
		}
	}
	return nil
}

// Rows reads a file's rows in order, as maps from column to value (numbers as json.Number). Close
// checks the row count and SHA-256 against the manifest, so call it after the last row.
type Rows struct {
	entry *FileEntry
	f     *os.File
	h     hash.Hash
	r     *bufio.Reader
	n     int64
}

// Open starts reading a file of the bundle.
func (b *Bundle) Open(e *FileEntry) (*Rows, error) {
	f, err := os.Open(filepath.Join(b.Dir, e.File))
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	return &Rows{entry: e, f: f, h: h, r: bufio.NewReaderSize(io.TeeReader(f, h), 1<<20)}, nil
}

// Next returns the next row, or nil at the end.
func (r *Rows) Next() (map[string]any, error) {
	for {
		line, err := r.r.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			r.n++
			d := json.NewDecoder(bytes.NewReader(line))
			d.UseNumber()
			var row map[string]any
			if derr := d.Decode(&row); derr != nil {
				return nil, fmt.Errorf("%s line %d: %w", r.entry.File, r.n, derr)
			}
			return row, nil
		}
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// Line is the number of the row Next returned last.
func (r *Rows) Line() int64 { return r.n }

// Close ends reading; after the last row it reports a wrong row count or checksum.
func (r *Rows) Close(complete bool) error {
	defer r.f.Close()
	if !complete {
		return nil
	}
	if r.n != r.entry.Rows {
		return fmt.Errorf("%s has %d rows; the manifest says %d", r.entry.File, r.n, r.entry.Rows)
	}
	if sum := hex.EncodeToString(r.h.Sum(nil)); r.entry.SHA256 != "" && sum != r.entry.SHA256 {
		return fmt.Errorf("%s is damaged: its SHA-256 doesn't match the manifest", r.entry.File)
	}
	return nil
}

// Each calls fn with every row of a file, then checks it (Rows.Close).
func (b *Bundle) Each(e *FileEntry, fn func(row map[string]any) error) error {
	rows, err := b.Open(e)
	if err != nil {
		return err
	}
	for {
		row, err := rows.Next()
		if err != nil {
			rows.Close(false)
			return err
		}
		if row == nil {
			return rows.Close(true)
		}
		if err := fn(row); err != nil {
			rows.Close(false)
			return fmt.Errorf("%s line %d: %w", e.File, rows.Line(), err)
		}
	}
}
