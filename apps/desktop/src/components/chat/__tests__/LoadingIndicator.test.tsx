import { describe, it, expect, beforeEach, afterEach, jest } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LoadingIndicator } from '../LoadingIndicator';

describe('LoadingIndicator Time Display', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not render when isLoading is false', () => {
    const { container } = render(
      <LoadingIndicator
        isLoading={false}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should render when isLoading is true', () => {
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
      />
    );

    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });

  it('should display total time correctly', () => {
    const startedAt = Date.now() - 5000; // 5 seconds ago
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={startedAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });

  it('should display idle time when > 3 seconds', () => {
    const startedAt = Date.now() - 10000;
    const lastActivityAt = Date.now() - 5000; // 5 seconds idle
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={lastActivityAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/idle: 5s/)).toBeInTheDocument();
  });

  it('should NOT display idle time when <= 3 seconds', () => {
    const startedAt = Date.now() - 2000;
    const lastActivityAt = Date.now() - 2000;
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={lastActivityAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.queryByText(/idle:/)).not.toBeInTheDocument();
  });

  it('should format minutes and seconds correctly', () => {
    const startedAt = Date.now() - 65000; // 1m 5s ago
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={startedAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/1m 5s/)).toBeInTheDocument();
  });

  it('should format idle minutes and seconds correctly', () => {
    const startedAt = Date.now() - 125000; // 2m 5s ago
    const lastActivityAt = Date.now() - 65000; // 1m 5s idle
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={lastActivityAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/idle: 1m 5s/)).toBeInTheDocument();
  });

  it('should update time every second', () => {
    const startedAt = Date.now();
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={startedAt}
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/1s/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/2s/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/3s/)).toBeInTheDocument();
  });

  it('should show warning when idle time > 30 seconds', () => {
    const startedAt = Date.now() - 35000;
    const lastActivityAt = Date.now() - 31000; // 31 seconds idle
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={lastActivityAt}
        health="healthy"
      />
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/Still working/)).toBeInTheDocument();
  });

  it('should show idle warning when health is idle', () => {
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
        health="idle"
      />
    );

    expect(screen.getByText(/No activity/)).toBeInTheDocument();
  });

  it('should show loop warning when health is loop', () => {
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
        health="loop"
        loopPattern="Read → Edit → Read"
      />
    );

    expect(screen.getByText(/Loop detected/)).toBeInTheDocument();
    expect(screen.getByText(/Read → Edit → Read/)).toBeInTheDocument();
  });

  it('should show cancel button when idle or loop', () => {
    const onCancel = jest.fn();
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
        health="idle"
        onCancel={onCancel}
      />
    );

    const cancelButton = screen.getByText('Cancel');
    expect(cancelButton).toBeInTheDocument();

    act(() => {
      cancelButton.click();
    });

    expect(onCancel).toHaveBeenCalled();
  });

  it('should NOT show cancel button when healthy', () => {
    render(
      <LoadingIndicator
        isLoading={true}
        startedAt={Date.now()}
        lastActivityAt={Date.now()}
        health="healthy"
        onCancel={() => {}}
      />
    );

    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('should clear timers when unmounted', () => {
    const startedAt = Date.now();
    const { unmount } = render(
      <LoadingIndicator
        isLoading={true}
        startedAt={startedAt}
        lastActivityAt={startedAt}
      />
    );

    unmount();

    // Should not throw error when advancing timers after unmount
    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });
});
