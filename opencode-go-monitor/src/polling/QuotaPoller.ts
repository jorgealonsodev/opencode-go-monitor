import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { AuthError, CredentialsError, NetworkError } from '../domain/errors';

export const MIN_POLL_INTERVAL_MS = 60_000;
export const DEBOUNCE_MS = 10_000;
export const BACKOFF_DELAYS_MS = [60_000, 300_000, 900_000, 1_800_000];

export type PollerState = 'setup' | 'loading' | 'auth' | 'error';

export interface PollerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: PollerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface QuotaPollerDeps {
  fetcher: QuotaFetcher;
  /** Id of the profile that is active right now (shared across windows). */
  activeProfileId(): string | undefined;
  /** Stores and renders a snapshot for the active profile. */
  onSnapshot(snapshot: QuotaSnapshot): void | Promise<void>;
  setState(state: PollerState): void;
  /** Called once per auth failure episode. */
  onAuthError(err: AuthError): void;
  /** Called for failures of a manual Refresh (AuthError is reported via onAuthError). */
  onManualRefreshError?(err: unknown): void;
  pollIntervalMs(): number;
  log?(message: string): void;
  clock?: PollerClock;
}

/**
 * Owns polling for the active profile: scheduling, backoff, Retry-After,
 * the in-flight guard, profile binding and the shared trigger debounce.
 *
 * - A fetch generation is bumped on every profile change; results and errors
 *   from an older generation (or for a profile that is no longer active) are
 *   discarded, and the in-flight guard only blocks fetches of the same generation.
 * - AuthError stops scheduled and focus polling until the profile changes or a
 *   manual Refresh runs. CredentialsError (no key) stops polling until a key is added.
 * - Manual Refresh, profile changes (Select) and window-focus refetches share one
 *   debounce: the first trigger fetches immediately, later ones inside the window
 *   are coalesced into a single trailing fetch.
 */
export class QuotaPoller {
  private readonly clock: PollerClock;
  private generation = 0;
  private inFlight: { generation: number } | undefined;
  private pollTimer: unknown;
  private trailingTimer: unknown;
  private trailingManual = false;
  private lastTriggerAt = Number.NEGATIVE_INFINITY;
  private lastSuccessAt = 0;
  private failureCount = 0;
  private backoffUntil = 0;
  private authStopped = false;
  private authNotified = false;
  private disposed = false;

  constructor(private readonly deps: QuotaPollerDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Initial fetch (when a profile is active) and start of the poll schedule. */
  start(): void {
    void this.fetchNow(false);
  }

  /** Manual Refresh: clears an auth stop and fetches (debounced). */
  refresh(): Promise<void> {
    this.authStopped = false;
    this.authNotified = false;
    return this.trigger(true);
  }

  /**
   * The active profile was selected, added, replaced or removed. Resets backoff
   * and auth stop and bumps the generation so the follow-up fetch is never
   * skipped by an in-flight fetch for the previous profile. An `initial`
   * snapshot (from key validation) is used instead of a new request.
   */
  async activeProfileChanged(initial?: QuotaSnapshot): Promise<void> {
    this.generation++;
    this.resetBackoff();
    this.authStopped = false;
    this.authNotified = false;

    const activeId = this.deps.activeProfileId();
    if (!activeId) {
      this.stop('setup');
      return;
    }
    if (initial && initial.profileId === activeId) {
      this.lastTriggerAt = this.clock.now();
      await this.accept(initial);
      return;
    }
    this.deps.setState('loading');
    await this.trigger(false);
  }

  /** Window regained focus: refetch if data is stale and polling is not paused. */
  windowFocused(): void {
    if (this.authStopped || !this.deps.activeProfileId() || this.lastSuccessAt === 0) {
      return;
    }
    const now = this.clock.now();
    if (now < this.backoffUntil || now - this.lastSuccessAt <= this.intervalMs() * 2) {
      return;
    }
    void this.trigger(false);
  }

  /** Re-arms the poll timer after a poll-interval setting change. */
  restartSchedule(): void {
    if (this.pollTimer !== undefined) {
      this.schedule(this.intervalMs());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearPollTimer();
    if (this.trailingTimer !== undefined) {
      this.clock.clearTimeout(this.trailingTimer);
      this.trailingTimer = undefined;
    }
  }

  private trigger(manual: boolean): Promise<void> {
    const wait = this.lastTriggerAt + DEBOUNCE_MS - this.clock.now();
    if (wait <= 0) {
      this.lastTriggerAt = this.clock.now();
      return this.fetchNow(manual);
    }
    this.trailingManual ||= manual;
    if (this.trailingTimer === undefined) {
      this.log(`[poll] debounced, trailing fetch in ${wait}ms`);
      this.trailingTimer = this.clock.setTimeout(() => {
        this.trailingTimer = undefined;
        const trailingManual = this.trailingManual;
        this.trailingManual = false;
        this.lastTriggerAt = this.clock.now();
        void this.fetchNow(trailingManual);
      }, wait);
    }
    return Promise.resolve();
  }

  private async fetchNow(manual: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = this.generation;
    if (this.inFlight?.generation === generation) {
      this.log('[poll] already fetching, skipping');
      return;
    }
    const profileId = this.deps.activeProfileId();
    if (!profileId) {
      this.stop('setup');
      return;
    }

    this.clearPollTimer();
    const token = { generation };
    this.inFlight = token;
    this.deps.setState('loading');
    try {
      const snapshot = await this.deps.fetcher.fetch();
      if (this.isStale(generation, profileId) || snapshot.profileId !== profileId) {
        this.log('[poll] discarding result for a profile that is no longer active');
        this.scheduleIfCurrent(generation);
        return;
      }
      await this.accept(snapshot);
    } catch (err) {
      if (this.isStale(generation, profileId)) {
        this.log('[poll] discarding error for a profile that is no longer active');
        this.scheduleIfCurrent(generation);
        return;
      }
      this.handleError(err, manual);
    } finally {
      if (this.inFlight === token) {
        this.inFlight = undefined;
      }
    }
  }

  private async accept(snapshot: QuotaSnapshot): Promise<void> {
    await this.deps.onSnapshot(snapshot);
    this.resetBackoff();
    this.lastSuccessAt = this.clock.now();
    this.schedule(this.intervalMs());
  }

  private handleError(err: unknown, manual: boolean): void {
    const name = err instanceof Error ? err.name : 'Unknown';
    this.log(`[poll] failed: ${name}`);

    if (err instanceof AuthError) {
      this.clearPollTimer();
      this.authStopped = true;
      this.deps.setState('auth');
      if (!this.authNotified) {
        this.authNotified = true;
        this.deps.onAuthError(err);
      }
      return;
    }
    if (err instanceof CredentialsError) {
      this.stop('setup');
      if (manual) {
        this.deps.onManualRefreshError?.(err);
      }
      return;
    }

    this.failureCount++;
    const stage = BACKOFF_DELAYS_MS[Math.min(this.failureCount - 1, BACKOFF_DELAYS_MS.length - 1)];
    const retryAfterMs =
      err instanceof NetworkError && err.retryAfterSeconds !== undefined
        ? Math.max(MIN_POLL_INTERVAL_MS, err.retryAfterSeconds * 1000)
        : 0;
    const delay = Math.max(this.intervalMs(), stage, retryAfterMs);
    this.backoffUntil = this.clock.now() + delay;
    this.log(`[poll] next attempt in ${delay}ms`);
    this.deps.setState('error');
    this.schedule(delay);
    if (manual) {
      this.deps.onManualRefreshError?.(err);
    }
  }

  private isStale(generation: number, profileId: string): boolean {
    return generation !== this.generation || this.deps.activeProfileId() !== profileId;
  }

  /** After a discarded result, keep polling unless a newer generation owns the schedule. */
  private scheduleIfCurrent(generation: number): void {
    if (generation === this.generation && this.pollTimer === undefined) {
      this.schedule(this.intervalMs());
    }
  }

  private stop(state: PollerState): void {
    this.clearPollTimer();
    this.deps.setState(state);
  }

  private resetBackoff(): void {
    this.failureCount = 0;
    this.backoffUntil = 0;
  }

  private schedule(delayMs: number): void {
    this.clearPollTimer();
    if (this.disposed) {
      return;
    }
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = undefined;
      if (!this.authStopped) {
        void this.fetchNow(false);
      }
    }, delayMs);
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== undefined) {
      this.clock.clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private intervalMs(): number {
    return Math.max(MIN_POLL_INTERVAL_MS, this.deps.pollIntervalMs());
  }

  private log(message: string): void {
    this.deps.log?.(message);
  }
}
