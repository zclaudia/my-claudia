package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHandleSubscribeValidationError(t *testing.T) {
	manager := NewManager(t.TempDir())
	api := NewAPI(manager, log.New(bytes.NewBuffer(nil), "", 0))

	req := httptest.NewRequest(http.MethodPost, "/subscribe", bytes.NewBufferString(`{"id":"x"}`))
	rec := httptest.NewRecorder()

	api.handleSubscribe(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}

	var body errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.Error.Code != "missing_field" {
		t.Fatalf("unexpected error code %q", body.Error.Code)
	}
}

func TestHandleSubscribeAndStatus(t *testing.T) {
	manager := NewManager(t.TempDir())
	api := NewAPI(manager, log.New(bytes.NewBuffer(nil), "", 0))

	payload := subscribeRequest{
		ID:        "com.myClaudia.mobile",
		NtfyURL:   "https://ntfy.sh",
		Topic:     "my-topic",
		AuthMode:  "bearer",
		AuthToken: "tk_subscribe",
		Package:   "com.myClaudia.mobile",
		Receiver:  ".NtfyReceiver",
	}
	data, _ := json.Marshal(payload)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/subscribe", bytes.NewReader(data))
	api.handleSubscribe(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	persisted := filepath.Join(manager.dataDir, "subs.json")
	if _, err := os.Stat(persisted); err != nil {
		t.Fatalf("expected persisted file, got %v", err)
	}

	statusRec := httptest.NewRecorder()
	statusReq := httptest.NewRequest(http.MethodGet, "/status", nil)
	api.handleStatus(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", statusRec.Code)
	}

	var status apiResponse
	if err := json.Unmarshal(statusRec.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to decode status: %v", err)
	}
	if _, ok := status.Subscriptions["com.myClaudia.mobile"]; !ok {
		t.Fatalf("expected subscription in status")
	}
	if status.Subscriptions["com.myClaudia.mobile"].AuthMode != "bearer" {
		t.Fatalf("expected auth mode to be preserved")
	}
	if !status.Subscriptions["com.myClaudia.mobile"].AuthConfigured {
		t.Fatalf("expected auth to be configured")
	}

	manager.Close()
}
