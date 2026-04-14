package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

type API struct {
	manager   *Manager
	logger    *log.Logger
	startedAt time.Time
}

func NewAPI(manager *Manager, logger *log.Logger) *API {
	return &API{
		manager:   manager,
		logger:    logger,
		startedAt: time.Now().UTC(),
	}
}

func (a *API) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/subscribe", a.handleSubscribe)
	mux.HandleFunc("/status", a.handleStatus)
	return withCORS(mux)
}

func (a *API) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		a.handleSubscribeCreate(w, r)
	case http.MethodDelete:
		a.handleSubscribeDelete(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *API) handleSubscribeCreate(w http.ResponseWriter, r *http.Request) {
	var input subscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	input.NtfyURL = strings.TrimSpace(input.NtfyURL)
	input.Topic = strings.TrimSpace(input.Topic)
	input.Package = strings.TrimSpace(input.Package)
	input.Receiver = strings.TrimSpace(input.Receiver)

	if err := validateSubscribeRequest(input); err != nil {
		if validation, ok := err.(validationError); ok {
			writeError(w, http.StatusBadRequest, validation.code, validation.message)
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	sub, err := newSubscription(input)
	if err != nil {
		if validation, ok := err.(validationError); ok {
			writeError(w, http.StatusBadRequest, validation.code, validation.message)
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	if err := a.manager.Add(sub); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	a.logger.Printf("[%s] subscription upserted topic=%s receiver=%s", sub.ID, sub.Topic, sub.Receiver)
	writeJSON(w, http.StatusOK, apiResponse{
		OK: true,
		Subscription: &subscriptionCreatedResponse{
			ID:        sub.ID,
			Connected: false,
			Status:    "connecting",
		},
	})
}

func (a *API) handleSubscribeDelete(w http.ResponseWriter, r *http.Request) {
	var input deleteSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeError(w, http.StatusBadRequest, "missing_field", "id is required")
		return
	}

	removed, err := a.manager.Remove(input.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if removed {
		a.logger.Printf("[%s] subscription removed", input.ID)
	}
	writeJSON(w, http.StatusOK, apiResponse{OK: true, Removed: removed})
}

func (a *API) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, apiResponse{
		OK:            true,
		Uptime:        time.Since(a.startedAt).Truncate(time.Second).String(),
		Version:       version,
		Subscriptions: a.manager.List(),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, errorResponse{
		OK: false,
		Error: apiErrorPayload{
			Code:    code,
			Message: message,
		},
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
