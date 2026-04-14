package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConnectAndListenUsesBearerAuth(t *testing.T) {
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sub, err := newSubscription(subscribeRequest{
		ID:        "com.myClaudia.mobile",
		NtfyURL:   server.URL,
		Topic:     "alerts",
		AuthMode:  "bearer",
		AuthToken: "tk_test",
		Package:   "com.myClaudia.mobile",
		Receiver:  ".NtfyReceiver",
	})
	if err != nil {
		t.Fatalf("newSubscription: %v", err)
	}

	if err := sub.connectAndListen(); err != nil {
		t.Fatalf("connectAndListen: %v", err)
	}
	if authHeader != "Bearer tk_test" {
		t.Fatalf("unexpected auth header %q", authHeader)
	}
}

func TestConnectAndListenUsesBasicAuth(t *testing.T) {
	var username, password string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, password, _ = r.BasicAuth()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sub, err := newSubscription(subscribeRequest{
		ID:       "com.myClaudia.mobile",
		NtfyURL:  server.URL,
		Topic:    "alerts",
		AuthMode: "basic",
		Username: "alice",
		Password: "secret",
		Package:  "com.myClaudia.mobile",
		Receiver: ".NtfyReceiver",
	})
	if err != nil {
		t.Fatalf("newSubscription: %v", err)
	}

	if err := sub.connectAndListen(); err != nil {
		t.Fatalf("connectAndListen: %v", err)
	}
	if username != "alice" || password != "secret" {
		t.Fatalf("unexpected basic auth credentials %q %q", username, password)
	}
}
