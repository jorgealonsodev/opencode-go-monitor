import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotaPoller, DEBOUNCE_MS, type QuotaPollerDeps } from '../src/polling/QuotaPoller';
import { AuthError, CredentialsError, NetworkError, ParseError } from '../src/domain/errors';
import type { QuotaFetcher, QuotaSnapshot } from '../src/domain/types';

function snapshot(profileId: string, pct = 10): QuotaSnapshot {
  return {
    timestamp: Date.now(),
    profileId,
    rolling: { status: 'ok', usagePercent: pct, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: pct, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: pct, resetsInSeconds: 2592000 },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const INTERVAL_MS = 60_000;

describe('QuotaPoller', () => {
  let active: string | undefined;
  let fetchImpl: () => Promise<QuotaSnapshot>;
  let fetcher: QuotaFetcher;
  let deps: QuotaPollerDeps & {
    onSnapshot: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    onAuthError: ReturnType<typeof vi.fn>;
    onManualRefreshError: ReturnType<typeof vi.fn>;
  };
  let poller: QuotaPoller;

  /** Lets pending promise chains settle without advancing time. */
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    active = 'p1';
    fetchImpl = async () => snapshot(active!);
    fetcher = {
      fetch: vi.fn(() => fetchImpl()),
      isAvailable: vi.fn(async () => true),
    };
    deps = {
      fetcher,
      activeProfileId: () => active,
      onSnapshot: vi.fn(),
      setState: vi.fn(),
      onAuthError: vi.fn(),
      onManualRefreshError: vi.fn(),
      pollIntervalMs: () => INTERVAL_MS,
    };
    poller = new QuotaPoller(deps);
  });

  afterEach(() => {
    poller.dispose();
    vi.useRealTimers();
  });

  it('fetches on start and then every poll interval', async () => {
    poller.start();
    await flush();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(deps.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'p1' }));

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows setup and does not poll without an active profile', async () => {
    active = undefined;
    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(deps.setState).toHaveBeenLastCalledWith('setup');
  });

  describe('auth failures (AC4)', () => {
    beforeEach(() => {
      fetchImpl = async () => {
        throw new AuthError('p1', 'Personal', 401);
      };
    });

    it('ends in auth state, notifies once, and stops scheduled and focus polling', async () => {
      poller.start();
      await flush();

      expect(deps.setState).toHaveBeenLastCalledWith('auth');
      expect(deps.onAuthError).toHaveBeenCalledTimes(1);
      expect(deps.onAuthError.mock.calls[0][0]).toMatchObject({ profileName: 'Personal', httpStatus: 401 });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);
      poller.windowFocused();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);

      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
      expect(deps.onAuthError).toHaveBeenCalledTimes(1);
    });

    it('resumes polling after a manual refresh succeeds', async () => {
      poller.start();
      await flush();

      fetchImpl = async () => snapshot('p1');
      await poller.refresh();
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
      expect(deps.onSnapshot).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
    });

    it('resumes polling after the profile changes', async () => {
      poller.start();
      await flush();

      active = 'p2';
      fetchImpl = async () => snapshot('p2');
      await poller.activeProfileChanged();
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
    });
  });

  it('routes CredentialsError to setup and stops polling', async () => {
    fetchImpl = async () => {
      throw new CredentialsError();
    };
    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(deps.setState).toHaveBeenLastCalledWith('setup');
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  describe('backoff and Retry-After', () => {
    it('honors Retry-After of 120 s on a 429 (AC6)', async () => {
      fetchImpl = async () => {
        throw new NetworkError('HTTP 429', 429, 120);
      };
      poller.start();
      await flush();
      expect(deps.setState).toHaveBeenLastCalledWith('error');

      await vi.advanceTimersByTimeAsync(119_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    });

    it('never waits less than 60 s for a short Retry-After', async () => {
      deps.pollIntervalMs = () => 1_000; // below the floor on purpose
      fetchImpl = async () => {
        throw new NetworkError('HTTP 503', 503, 5);
      };
      poller.start();
      await flush();

      await vi.advanceTimersByTimeAsync(59_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    });

    it('backs off progressively on repeated failures', async () => {
      fetchImpl = async () => {
        throw new ParseError('bad');
      };
      poller.start();
      await flush(); // failure 1 → 60 s
      await vi.advanceTimersByTimeAsync(60_000); // failure 2 → 300 s
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(299_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
    });

    it('resets backoff when the active profile changes', async () => {
      fetchImpl = async () => {
        throw new ParseError('bad');
      };
      poller.start();
      await flush();
      await vi.advanceTimersByTimeAsync(60_000); // two failures, next wait 300 s
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      active = 'p2';
      fetchImpl = async () => {
        throw new ParseError('bad');
      };
      await poller.activeProfileChanged(); // failure 1 for the new profile → 60 s
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher.fetch).toHaveBeenCalledTimes(4);
    });

    it('releases the in-flight guard after a timeout so the next poll runs (AC5)', async () => {
      fetchImpl = () =>
        new Promise((_, reject) => setTimeout(() => reject(new NetworkError('Request timed out')), 15_000));
      poller.start();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(deps.setState).toHaveBeenLastCalledWith('error');

      fetchImpl = async () => snapshot('p1');
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
      expect(deps.onSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe('profile switching (AC9)', () => {
    it('refreshes while a fetch is in flight and discards the old result', async () => {
      const oldFetch = deferred<QuotaSnapshot>();
      fetchImpl = () => oldFetch.promise;
      poller.start();
      await flush();
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);

      active = 'p2';
      fetchImpl = async () => snapshot('p2', 55);
      await poller.activeProfileChanged();
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      oldFetch.resolve(snapshot('p1', 99));
      await flush();

      expect(deps.onSnapshot).toHaveBeenCalledTimes(1);
      expect(deps.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'p2' }));
    });

    it('discards an old auth failure that arrives after the switch', async () => {
      const oldFetch = deferred<QuotaSnapshot>();
      fetchImpl = () => oldFetch.promise;
      poller.start();
      await flush();

      active = 'p2';
      fetchImpl = async () => snapshot('p2');
      await poller.activeProfileChanged();

      oldFetch.reject(new AuthError('p1', 'Old', 401));
      await flush();

      expect(deps.onAuthError).not.toHaveBeenCalled();
      expect(deps.setState).not.toHaveBeenCalledWith('auth');
    });

    it('discards a result when another window changed the active profile', async () => {
      const pending = deferred<QuotaSnapshot>();
      fetchImpl = () => pending.promise;
      poller.start();
      await flush();

      active = 'p2';
      pending.resolve(snapshot('p1'));
      await flush();

      expect(deps.onSnapshot).not.toHaveBeenCalled();
    });

    it('uses an initial snapshot without a second request', async () => {
      active = undefined;
      poller.start();
      await flush();

      active = 'p1';
      await poller.activeProfileChanged(snapshot('p1'));

      expect(fetcher.fetch).not.toHaveBeenCalled();
      expect(deps.onSnapshot).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    });

    it('shows setup and stops polling when the last profile is removed', async () => {
      poller.start();
      await flush();

      active = undefined;
      await poller.activeProfileChanged();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(deps.setState).toHaveBeenLastCalledWith('setup');
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('shared debounce', () => {
    it('coalesces Refresh, Select and focus within 10 s into one trailing fetch', async () => {
      poller.start();
      await flush();
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);

      await poller.refresh(); // leading edge
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await poller.refresh();
      await poller.activeProfileChanged();
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
    });

    it('applies the debounce to window-focus refetches', async () => {
      poller.start();
      await flush();

      // Simulate a long sleep: timers did not fire, but the clock jumped.
      vi.setSystemTime(Date.now() + INTERVAL_MS * 3);
      poller.windowFocused(); // stale data → leading-edge refetch
      await flush();
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await poller.refresh(); // within 10 s of the focus refetch → coalesced
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
    });

    it('does not refetch on focus when data is fresh', async () => {
      poller.start();
      await flush();
      poller.windowFocused();
      await flush();
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('reports manual refresh errors but not scheduled ones', async () => {
    fetchImpl = async () => {
      throw new NetworkError('offline');
    };
    poller.start();
    await flush();
    expect(deps.onManualRefreshError).not.toHaveBeenCalled();

    await poller.refresh();
    expect(deps.onManualRefreshError).toHaveBeenCalledWith(expect.any(NetworkError));
  });

  it('stops all timers on dispose', async () => {
    poller.start();
    await flush();
    poller.dispose();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });
});
