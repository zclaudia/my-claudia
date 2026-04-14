package main

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

func (s *Subscription) StartSSE() {
	backoff := 5 * time.Second
	maxBackoff := 60 * time.Second

	for {
		select {
		case <-s.ctx.Done():
			s.setStatus("stopped", false, "", 0)
			return
		default:
		}

		s.setStatus("connecting", false, "", 0)
		err := s.connectAndListen()
		if err != nil {
			s.setStatus("backoff", false, err.Error(), backoff.Milliseconds())
			log.Printf("[%s] sse disconnected err=%v retry_in=%dms", s.ID, err, backoff.Milliseconds())
		}
		waitFor := backoff

		select {
		case <-s.ctx.Done():
			s.setStatus("stopped", false, "", 0)
			return
		case <-time.After(waitFor):
		}

		if err == nil {
			backoff = 5 * time.Second
			continue
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (s *Subscription) connectAndListen() error {
	url := fmt.Sprintf("%s/%s/json", s.NtfyURL, s.Topic)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if s.AuthMode == "bearer" && s.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.AuthToken)
	} else if s.AuthMode == "basic" && s.Username != "" && s.Password != "" {
		req.SetBasicAuth(s.Username, s.Password)
	}

	client := &http.Client{
		Timeout: 0,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs: loadAndroidCertPool(),
			},
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	s.markConnected()
	log.Printf("[%s] sse connected url=%s", s.ID, url)

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var msg ntfyMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			log.Printf("[%s] failed to decode message: %v", s.ID, err)
			continue
		}
		if msg.Event != "message" {
			log.Printf("[%s] ignoring event=%s", s.ID, msg.Event)
			continue
		}

		s.markMessageReceived()
		if err := s.deliver(msg); err != nil {
			log.Printf("[%s] delivery failed: %v", s.ID, err)
			continue
		}
		log.Printf("[%s] service delivered message_id=%s", s.ID, msg.ID)
	}
}

func (s *Subscription) deliver(msg ntfyMessage) error {
	normalized := normalizeMessage(msg, s.Topic, fallbackTitleForPackage(s.Package))
	target := fullyQualifiedReceiver(s.Package, s.Receiver)

	args := []string{
		"start-foreground-service",
		"-n", target,
		"--es", "bridge_version", "1",
		"--es", "title", normalized.Title,
		"--es", "body", normalized.Body,
		"--es", "topic", normalized.Topic,
		"--es", "tags", normalized.Tags,
		"--es", "priority", normalized.Priority,
		"--es", "message_id", normalized.MessageID,
		"--es", "timestamp", normalized.Timestamp,
		"--es", "open_payload", normalized.OpenPayload,
	}

	output, err := runAMAsShell(args)
	if err == nil {
		return nil
	}

	fallbackOutput, fallbackErr := exec.Command("am", args...).CombinedOutput()
	if fallbackErr != nil {
		return fmt.Errorf("%w: shell_uid=%s fallback=%s", fallbackErr, strings.TrimSpace(string(output)), strings.TrimSpace(string(fallbackOutput)))
	}
	log.Printf("[%s] delivery fallback succeeded after shell uid path failed: %s", s.ID, strings.TrimSpace(string(output)))
	return nil
}

func fullyQualifiedReceiver(pkg string, receiver string) string {
	if strings.HasPrefix(receiver, ".") {
		return pkg + "/" + pkg + receiver
	}
	return pkg + "/" + receiver
}

func runAMAsShell(args []string) ([]byte, error) {
	scriptPath, err := writeAMScript(args)
	if err != nil {
		return nil, err
	}
	defer os.Remove(scriptPath)

	return exec.Command("su", "2000", "-c", "/system/bin/sh "+shellQuote(scriptPath)).CombinedOutput()
}

func writeAMScript(args []string) (string, error) {
	dir := "/data/local/tmp"
	file, err := os.CreateTemp(dir, "ntfy-bridge-am-*.sh")
	if err != nil {
		file, err = os.CreateTemp("", "ntfy-bridge-am-*.sh")
		if err != nil {
			return "", err
		}
	}

	script := "#!/system/bin/sh\n" + shellJoin(append([]string{"am"}, args...)) + "\n"
	if _, err := file.WriteString(script); err != nil {
		file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(file.Name(), 0o644); err != nil {
		return "", err
	}
	return file.Name(), nil
}

func shellJoin(args []string) string {
	quoted := make([]string, 0, len(args))
	for _, arg := range args {
		quoted = append(quoted, shellQuote(arg))
	}
	return strings.Join(quoted, " ")
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	if isSafeShellWord(value) {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func isSafeShellWord(value string) bool {
	for _, ch := range value {
		switch {
		case ch >= 'a' && ch <= 'z':
		case ch >= 'A' && ch <= 'Z':
		case ch >= '0' && ch <= '9':
		case strings.ContainsRune("@%_+=:,./-", ch):
		default:
			return false
		}
	}
	return true
}
