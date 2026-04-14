package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type Manager struct {
	mu      sync.RWMutex
	subs    map[string]*Subscription
	dataDir string
}

func NewManager(dataDir string) *Manager {
	return &Manager{
		subs:    make(map[string]*Subscription),
		dataDir: dataDir,
	}
}

func (m *Manager) Add(sub *Subscription) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var previous *Subscription
	if existing, ok := m.subs[sub.ID]; ok {
		previous = existing
		previous.Stop()
	}

	sub.ensureRuntime()
	m.subs[sub.ID] = sub
	if err := m.persistLocked(); err != nil {
		delete(m.subs, sub.ID)
		if previous != nil {
			previous.ensureRuntime()
			m.subs[previous.ID] = previous
			go previous.StartSSE()
		}
		return err
	}

	go sub.StartSSE()
	return nil
}

func (m *Manager) Remove(id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	sub, ok := m.subs[id]
	if !ok {
		return false, nil
	}

	sub.Stop()
	delete(m.subs, id)
	if err := m.persistLocked(); err != nil {
		return false, err
	}
	return true, nil
}

func (m *Manager) List() map[string]subscriptionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	snapshots := make(map[string]subscriptionStatus, len(m.subs))
	for id, sub := range m.subs {
		snapshots[id] = sub.snapshot()
	}
	return snapshots
}

func (m *Manager) Get(id string) (*Subscription, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sub, ok := m.subs[id]
	return sub, ok
}

func (m *Manager) Close() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, sub := range m.subs {
		sub.Stop()
	}
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	path := filepath.Join(m.dataDir, "subs.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	var persisted persistedSubscriptions
	if err := json.Unmarshal(data, &persisted); err != nil {
		return err
	}

	for id, item := range persisted.Subscriptions {
		sub, err := newSubscription(subscribeRequest{
			ID:       item.ID,
			NtfyURL:  item.NtfyURL,
			Topic:    item.Topic,
			Package:  item.Package,
			Receiver: item.Receiver,
		})
		if err != nil {
			return err
		}
		m.subs[id] = sub
		go sub.StartSSE()
	}
	return nil
}

func (m *Manager) persistLocked() error {
	payload := persistedSubscriptions{
		Version:       1,
		Subscriptions: make(map[string]persistedSubscription, len(m.subs)),
	}
	for id, sub := range m.subs {
		payload.Subscriptions[id] = sub.persisted()
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := filepath.Join(m.dataDir, "subs.json.tmp")
	finalFile := filepath.Join(m.dataDir, "subs.json")
	if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpFile, finalFile)
}
