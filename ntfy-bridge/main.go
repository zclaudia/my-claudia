package main

import (
	"context"
	"crypto/x509"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const version = "0.1.0"

func init() {
	net.DefaultResolver = androidResolver()
}

func androidResolver() *net.Resolver {
	dnsServers := append(readAndroidDNSServers(), "1.1.1.1:53", "8.8.8.8:53")
	index := 0

	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			server := dnsServers[index%len(dnsServers)]
			index++

			dialer := &net.Dialer{Timeout: 5 * time.Second}
			return dialer.DialContext(ctx, "udp", server)
		},
	}
}

func readAndroidDNSServers() []string {
	props := []string{"net.dns1", "net.dns2", "net.dns3", "net.dns4"}
	seen := make(map[string]struct{})
	servers := make([]string, 0, len(props))

	for _, prop := range props {
		output, err := exec.Command("getprop", prop).Output()
		if err != nil {
			continue
		}

		value := strings.TrimSpace(string(output))
		if value == "" || strings.HasPrefix(value, "127.") || value == "::1" {
			continue
		}

		server := value
		if !strings.Contains(server, ":") {
			server += ":53"
		}
		if _, ok := seen[server]; ok {
			continue
		}
		seen[server] = struct{}{}
		servers = append(servers, server)
	}

	return servers
}

func loadAndroidCertPool() *x509.CertPool {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}

	for _, file := range []string{
		os.Getenv("SSL_CERT_FILE"),
		"/data/local/ntfy-bridge/cacert.pem",
	} {
		appendCertsFromFile(pool, file)
	}

	for _, dir := range []string{
		"/system/etc/security/cacerts",
		"/apex/com.android.conscrypt/cacerts",
		"/data/misc/keychain/cacerts-added",
	} {
		appendCertsFromDir(pool, dir)
	}

	return pool
}

func appendCertsFromFile(pool *x509.CertPool, path string) {
	if strings.TrimSpace(path) == "" {
		return
	}

	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return
	}

	pool.AppendCertsFromPEM(data)
}

func appendCertsFromDir(pool *x509.CertPool, dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil || len(data) == 0 {
			continue
		}

		if strings.Contains(string(data), "BEGIN CERTIFICATE") {
			pool.AppendCertsFromPEM(data)
			continue
		}

		cert, err := x509.ParseCertificate(data)
		if err != nil {
			continue
		}
		pool.AddCert(cert)
	}
}

func main() {
	listenAddr := flag.String("listen", "127.0.0.1:9595", "HTTP listen address")
	dataDir := flag.String("data", "/data/local/ntfy-bridge", "daemon data directory")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		log.Fatalf("[system] failed to create data dir: %v", err)
	}

	manager := NewManager(*dataDir)
	if err := manager.Load(); err != nil {
		log.Fatalf("[system] failed to load subscriptions: %v", err)
	}

	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)
	api := NewAPI(manager, logger)

	server := &http.Server{
		Addr:              *listenAddr,
		Handler:           api.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	logger.Printf("[system] daemon started version=%s listen=%s data=%s", version, *listenAddr, filepath.Clean(*dataDir))

	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownCtx.Done()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		manager.Close()
		if err := server.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("[system] shutdown error: %v", err)
		}
	}()

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatalf("[system] server failed: %v", err)
	}
}
