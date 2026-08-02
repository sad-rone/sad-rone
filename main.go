// Command viewcounter is a tiny HTTP service that does exactly one thing:
// count page views for the profile site and hand the number back as JSON.
//
//	GET  /api/views  -> returns the current count (does not increment)
//	POST /api/views  -> increments the count by 1, returns the new count
//
// The count is kept in memory and persisted to a plain text file
// (views.count) after every increment, so a restart doesn't lose it.
// No database, no external dependencies — just net/http.
//
// Run:
//
//	go run main.go
//	PORT=8080 COUNT_FILE=views.count go run main.go   // both optional
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// counter holds the view count in memory and mirrors it to disk.
type counter struct {
	mu   sync.Mutex
	n    uint64
	path string
}

func newCounter(path string) *counter {
	c := &counter{path: path}
	if data, err := os.ReadFile(path); err == nil {
		if n, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64); err == nil {
			c.n = n
		}
	}
	return c
}

func (c *counter) get() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

func (c *counter) increment() (uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
	err := os.WriteFile(c.path, []byte(strconv.FormatUint(c.n, 10)), 0o644)
	return c.n, err
}

func viewsHandler(c *counter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Same-origin in production, but CORS-friendly for local dev
		// (opening index.html straight from disk, a different dev port, etc).
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodOptions:
			w.WriteHeader(http.StatusNoContent)

		case http.MethodGet:
			json.NewEncoder(w).Encode(map[string]uint64{"views": c.get()})

		case http.MethodPost:
			n, err := c.increment()
			if err != nil {
				// Count still went up in memory; just log the disk hiccup
				// rather than fail the request over it.
				log.Printf("viewcounter: failed to persist count: %v", err)
			}
			json.NewEncoder(w).Encode(map[string]uint64{"views": n})

		default:
			w.Header().Set("Allow", "GET, POST, OPTIONS")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func main() {
	countFile := os.Getenv("COUNT_FILE")
	if countFile == "" {
		countFile = "views.count"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	c := newCounter(countFile)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/views", viewsHandler(c))

	addr := ":" + port
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("viewcounter listening on %s (persisting to %s, starting count %d)", addr, countFile, c.get())
	log.Fatal(srv.ListenAndServe())
}
