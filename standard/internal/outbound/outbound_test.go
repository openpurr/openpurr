package outbound

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRewritesStoreHostsInConformanceMode(t *testing.T) {
	var got []string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization")+" "+string(body))
	}))
	defer fake.Close()
	client := NewClient(fake.URL + "/")

	req, _ := http.NewRequest(http.MethodPost, "https://api.storekit-sandbox.apple.com/inApps/v1/history/123?revision=a%20b", strings.NewReader("x=1"))
	req.Header.Set("Authorization", "Bearer jwt")
	if _, err := client.Do(req); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Get("https://oauth2.googleapis.com/token"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"POST /api.storekit-sandbox.apple.com/inApps/v1/history/123?revision=a%20b Bearer jwt x=1",
		"GET /oauth2.googleapis.com/token  ",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s", strings.Join(got, "\n"))
	}

	// Other hosts go where they're sent (here: the fake itself, by its own URL).
	got = nil
	if _, err := client.Get(fake.URL + "/hooks/a"); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !strings.HasPrefix(got[0], "GET /hooks/a") {
		t.Fatal(got)
	}
}
