package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	topicPattern    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	packagePattern  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`)
	receiverPattern = regexp.MustCompile(`^(\.[A-Za-z][A-Za-z0-9_$.]*|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+)$`)
)

type subscribeRequest struct {
	ID       string `json:"id"`
	NtfyURL  string `json:"ntfy_url"`
	Topic    string `json:"topic"`
	Package  string `json:"package"`
	Receiver string `json:"receiver"`
}

type deleteSubscriptionRequest struct {
	ID string `json:"id"`
}

type errorResponse struct {
	OK    bool            `json:"ok"`
	Error apiErrorPayload `json:"error"`
}

type apiErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type apiResponse struct {
	OK            bool                          `json:"ok"`
	Uptime        string                        `json:"uptime,omitempty"`
	Version       string                        `json:"version,omitempty"`
	Subscription  *subscriptionCreatedResponse  `json:"subscription,omitempty"`
	Removed       bool                          `json:"removed,omitempty"`
	Subscriptions map[string]subscriptionStatus `json:"subscriptions,omitempty"`
}

type subscriptionCreatedResponse struct {
	ID        string `json:"id"`
	Connected bool   `json:"connected"`
	Status    string `json:"status"`
}

type subscriptionStatus struct {
	NtfyURL       string `json:"ntfy_url"`
	Topic         string `json:"topic"`
	Package       string `json:"package"`
	Receiver      string `json:"receiver"`
	Status        string `json:"status"`
	Connected     bool   `json:"connected"`
	LastMessageAt string `json:"last_message_at,omitempty"`
	LastConnectAt string `json:"last_connect_at,omitempty"`
	LastError     string `json:"last_error,omitempty"`
	RetryInMs     int64  `json:"retry_in_ms"`
}

type persistedSubscriptions struct {
	Version       int                              `json:"version"`
	Subscriptions map[string]persistedSubscription `json:"subscriptions"`
}

type persistedSubscription struct {
	ID       string `json:"id"`
	NtfyURL  string `json:"ntfy_url"`
	Topic    string `json:"topic"`
	Package  string `json:"package"`
	Receiver string `json:"receiver"`
}

type subscriptionRuntimeStatus struct {
	State         string
	Connected     bool
	LastMessageAt time.Time
	LastConnectAt time.Time
	LastError     string
	RetryInMs     int64
}

type Subscription struct {
	ID       string
	NtfyURL  string
	Topic    string
	Package  string
	Receiver string

	ctx      context.Context
	cancel   context.CancelFunc
	statusMu sync.RWMutex
	status   subscriptionRuntimeStatus
}

type ntfyMessage struct {
	ID       string      `json:"id"`
	Event    string      `json:"event"`
	Title    string      `json:"title"`
	Message  string      `json:"message"`
	Tags     []string    `json:"tags"`
	Priority interface{} `json:"priority"`
	Time     int64       `json:"time"`
}

type normalizedMessage struct {
	Title     string
	Body      string
	Topic     string
	Tags      string
	Priority  string
	MessageID string
	Timestamp string
	OpenPayload string
}

func validateSubscribeRequest(input subscribeRequest) error {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.Package) == "" || strings.TrimSpace(input.Receiver) == "" || strings.TrimSpace(input.Topic) == "" || strings.TrimSpace(input.NtfyURL) == "" {
		return newValidationError("missing_field", "id, package, receiver, topic, ntfy_url are required")
	}
	if len(input.ID) > 128 {
		return newValidationError("invalid_id", "id must be 128 characters or fewer")
	}
	if input.ID != input.Package {
		return newValidationError("id_package_mismatch", "id must equal package")
	}
	if !packagePattern.MatchString(input.Package) {
		return newValidationError("invalid_package", "package must be a valid Android package name")
	}
	if len(input.Receiver) > 128 || !receiverPattern.MatchString(input.Receiver) {
		return newValidationError("invalid_receiver", "receiver must be relative or fully-qualified class name")
	}
	if len(input.Topic) > 128 || !topicPattern.MatchString(input.Topic) {
		return newValidationError("invalid_topic", "topic contains unsupported characters")
	}
	if len(input.NtfyURL) > 512 {
		return newValidationError("invalid_ntfy_url", "ntfy_url must be 512 characters or fewer")
	}
	if _, err := normalizeBaseURL(input.NtfyURL); err != nil {
		return err
	}
	return nil
}

func normalizeBaseURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", newValidationError("invalid_ntfy_url", "ntfy_url must be a valid URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", newValidationError("invalid_ntfy_url", "ntfy_url must use http or https")
	}
	if parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", newValidationError("invalid_ntfy_url", "ntfy_url must point to the server root")
	}
	parsed.Path = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func newSubscription(input subscribeRequest) (*Subscription, error) {
	baseURL, err := normalizeBaseURL(input.NtfyURL)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	return &Subscription{
		ID:       input.ID,
		NtfyURL:  baseURL,
		Topic:    input.Topic,
		Package:  input.Package,
		Receiver: input.Receiver,
		ctx:      ctx,
		cancel:   cancel,
		status: subscriptionRuntimeStatus{
			State:     "connecting",
			Connected: false,
		},
	}, nil
}

func (s *Subscription) persisted() persistedSubscription {
	return persistedSubscription{
		ID:       s.ID,
		NtfyURL:  s.NtfyURL,
		Topic:    s.Topic,
		Package:  s.Package,
		Receiver: s.Receiver,
	}
}

func (s *Subscription) ensureRuntime() {
	if s.ctx != nil && s.cancel != nil {
		return
	}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.status = subscriptionRuntimeStatus{State: "connecting"}
}

func (s *Subscription) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.setStatus("stopped", false, "", 0)
}

func (s *Subscription) setStatus(state string, connected bool, lastErr string, retryInMs int64) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.status.State = state
	s.status.Connected = connected
	s.status.LastError = lastErr
	s.status.RetryInMs = retryInMs
}

func (s *Subscription) markConnected() {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.status.State = "connected"
	s.status.Connected = true
	s.status.LastConnectAt = time.Now().UTC()
	s.status.LastError = ""
	s.status.RetryInMs = 0
}

func (s *Subscription) markMessageReceived() {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.status.LastMessageAt = time.Now().UTC()
}

func (s *Subscription) snapshot() subscriptionStatus {
	s.statusMu.RLock()
	defer s.statusMu.RUnlock()

	snapshot := subscriptionStatus{
		NtfyURL:   s.NtfyURL,
		Topic:     s.Topic,
		Package:   s.Package,
		Receiver:  s.Receiver,
		Status:    s.status.State,
		Connected: s.status.Connected,
		LastError: s.status.LastError,
		RetryInMs: s.status.RetryInMs,
	}
	if !s.status.LastConnectAt.IsZero() {
		snapshot.LastConnectAt = s.status.LastConnectAt.Format(time.RFC3339)
	}
	if !s.status.LastMessageAt.IsZero() {
		snapshot.LastMessageAt = s.status.LastMessageAt.Format(time.RFC3339)
	}
	return snapshot
}

func normalizeMessage(msg ntfyMessage, topic string, fallbackTitle string) normalizedMessage {
	title := strings.TrimSpace(msg.Title)
	if title == "" {
		title = fallbackTitle
	}
	body := truncateString(strings.TrimSpace(msg.Message), 500)
	tags := strings.Join(msg.Tags, ",")
	timestamp := time.Now().UTC().Format(time.RFC3339)
	if msg.Time > 0 {
		timestamp = time.Unix(msg.Time, 0).UTC().Format(time.RFC3339)
	}
	openPayload := map[string]string{
		"message_id": msg.ID,
		"topic":      topic,
		"tags":       tags,
		"timestamp":  timestamp,
	}
	openPayloadJSON, _ := json.Marshal(openPayload)

	return normalizedMessage{
		Title:       truncateString(title, 120),
		Body:        body,
		Topic:       topic,
		Tags:        tags,
		Priority:    normalizePriority(msg.Priority),
		MessageID:   msg.ID,
		Timestamp:   timestamp,
		OpenPayload: string(openPayloadJSON),
	}
}

func normalizePriority(raw interface{}) string {
	switch value := raw.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "1", "min":
			return "min"
		case "2", "low":
			return "low"
		case "4", "high":
			return "high"
		case "5", "max", "urgent":
			return "max"
		default:
			return "default"
		}
	case float64:
		return normalizePriority(int(value))
	case int:
		switch value {
		case 1:
			return "min"
		case 2:
			return "low"
		case 4:
			return "high"
		case 5:
			return "max"
		default:
			return "default"
		}
	case json.Number:
		if intValue, err := value.Int64(); err == nil {
			return normalizePriority(int(intValue))
		}
	}
	return "default"
}

func truncateString(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}

func fallbackTitleForPackage(pkg string) string {
	if pkg == "com.myClaudia.desktop" {
		return "MyClaudia"
	}
	if idx := strings.LastIndex(pkg, "."); idx >= 0 && idx+1 < len(pkg) {
		return pkg[idx+1:]
	}
	return pkg
}

type validationError struct {
	code    string
	message string
}

func (e validationError) Error() string {
	return fmt.Sprintf("%s: %s", e.code, e.message)
}

func newValidationError(code string, message string) error {
	return validationError{code: code, message: message}
}
