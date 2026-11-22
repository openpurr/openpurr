// Package officeui embeds the dashboard: Lite's lite/office-ui, unchanged, so both editions serve
// one dashboard. The files aren't kept in this directory in git; they're copied into files/ before
// the build:
//
//	go generate ./internal/officeui   (or the Dockerfile, which copies them itself)
//
// A binary built without them still serves the API; the dashboard paths then say how to add it.
package officeui

//go:generate go run copy.go

import (
	"embed"
	"io/fs"
)

//go:embed all:files
var files embed.FS

// FS is the dashboard's files (index.html at the root).
func FS() fs.FS {
	sub, err := fs.Sub(files, "files")
	if err != nil {
		panic(err)
	}
	return sub
}
