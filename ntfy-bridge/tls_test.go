package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAppendCertsFromDirPEMAndDER(t *testing.T) {
	dir := t.TempDir()
	der, pemBytes := createTestCertificate(t)

	if err := os.WriteFile(filepath.Join(dir, "pem-cert"), pemBytes, 0o644); err != nil {
		t.Fatalf("write pem cert: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "der-cert"), der, 0o644); err != nil {
		t.Fatalf("write der cert: %v", err)
	}

	pool := x509.NewCertPool()
	appendCertsFromDir(pool, dir)

	if subjects := pool.Subjects(); len(subjects) < 1 {
		t.Fatalf("expected at least 1 cert in pool, got %d", len(subjects))
	}
}

func createTestCertificate(t *testing.T) ([]byte, []byte) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "ntfy-bridge-test",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}

	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return der, pemBytes
}
