package main

import "testing"

func TestValidateSubscribeRequest(t *testing.T) {
	valid := subscribeRequest{
		ID:       "com.myClaudia.mobile",
		NtfyURL:  "https://ntfy.sh",
		Topic:    "my-claudia-alerts",
		Package:  "com.myClaudia.mobile",
		Receiver: ".NtfyReceiver",
	}

	if err := validateSubscribeRequest(valid); err != nil {
		t.Fatalf("expected valid request, got %v", err)
	}

	tests := []struct {
		name string
		req  subscribeRequest
		code string
	}{
		{
			name: "id package mismatch",
			req: subscribeRequest{
				ID:       "a",
				NtfyURL:  "https://ntfy.sh",
				Topic:    "my-topic",
				Package:  "com.myClaudia.mobile",
				Receiver: ".NtfyReceiver",
			},
			code: "id_package_mismatch",
		},
		{
			name: "invalid topic",
			req: subscribeRequest{
				ID:       "com.myClaudia.mobile",
				NtfyURL:  "https://ntfy.sh",
				Topic:    "bad topic",
				Package:  "com.myClaudia.mobile",
				Receiver: ".NtfyReceiver",
			},
			code: "invalid_topic",
		},
		{
			name: "invalid url with path",
			req: subscribeRequest{
				ID:       "com.myClaudia.mobile",
				NtfyURL:  "https://ntfy.sh/root",
				Topic:    "my-topic",
				Package:  "com.myClaudia.mobile",
				Receiver: ".NtfyReceiver",
			},
			code: "invalid_ntfy_url",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateSubscribeRequest(tc.req)
			if err == nil {
				t.Fatalf("expected error")
			}
			validation, ok := err.(validationError)
			if !ok {
				t.Fatalf("expected validationError, got %T", err)
			}
			if validation.code != tc.code {
				t.Fatalf("expected code %s, got %s", tc.code, validation.code)
			}
		})
	}
}

func TestNormalizeMessage(t *testing.T) {
	msg := ntfyMessage{
		ID:       "msg-1",
		Title:    "",
		Message:  "hello",
		Tags:     []string{"permission_request", "warning"},
		Priority: float64(4),
		Time:     1713100000,
	}

	normalized := normalizeMessage(msg, "topic-1", "MyClaudia")
	if normalized.Title != "MyClaudia" {
		t.Fatalf("expected fallback title, got %q", normalized.Title)
	}
	if normalized.Tags != "permission_request,warning" {
		t.Fatalf("unexpected tags %q", normalized.Tags)
	}
	if normalized.Priority != "high" {
		t.Fatalf("unexpected priority %q", normalized.Priority)
	}
	if normalized.MessageID != "msg-1" {
		t.Fatalf("unexpected message id %q", normalized.MessageID)
	}
	if normalized.OpenPayload == "" {
		t.Fatalf("expected open payload")
	}
}

func TestFullyQualifiedReceiver(t *testing.T) {
	if got := fullyQualifiedReceiver("com.myClaudia.mobile", ".NtfyReceiver"); got != "com.myClaudia.mobile/com.myClaudia.mobile.NtfyReceiver" {
		t.Fatalf("unexpected relative receiver %q", got)
	}
	if got := fullyQualifiedReceiver("com.myClaudia.mobile", "com.myClaudia.mobile.NtfyReceiver"); got != "com.myClaudia.mobile/com.myClaudia.mobile.NtfyReceiver" {
		t.Fatalf("unexpected absolute receiver %q", got)
	}
}
