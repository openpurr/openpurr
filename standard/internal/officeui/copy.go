//go:build ignore

// Copies the dashboard (lite/office-ui) into files/ for go:embed: go generate ./internal/officeui.
package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
)

func main() {
	src := filepath.Join("..", "..", "..", "lite", "office-ui")
	if _, err := os.Stat(filepath.Join(src, "index.html")); err != nil {
		log.Fatalf("the dashboard isn't at %s: %v", src, err)
	}
	entries, err := os.ReadDir("files")
	if err != nil {
		log.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != ".gitkeep" {
			if err := os.RemoveAll(filepath.Join("files", e.Name())); err != nil {
				log.Fatal(err)
			}
		}
	}
	err = filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		dst := filepath.Join("files", rel)
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	})
	if err != nil {
		log.Fatal(err)
	}
}
