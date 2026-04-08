/**
 * MediaCache — global, refcounted, time-evicted cache for media sources.
 *
 * One entry per source URL holds the fetched `Blob` plus a single object URL
 * shared across every consumer (layers, audio render, compile-time probe).
 * Consumers `acquire()` an entry to take a reference and `release()` when
 * they no longer need it. When the refCount drops to zero the entry is
 * scheduled for eviction after a short grace period (default 5 s) so that
 * back-to-back loads — most importantly the compile → renderer handoff and
 * `loadVideo()` reloads — reuse the bytes instead of re-fetching them.
 *
 * Usage:
 * ```ts
 * import { loadedMedia } from '@videoflow/core';
 *
 * const entry = await loadedMedia.acquire(url);
 * use(entry.objectUrl);
 * loadedMedia.release(url);
 * ```
 */

export type MediaEntry = {
	/** The fetched bytes. */
	blob: Blob;
	/** A single `URL.createObjectURL(blob)` shared across consumers. */
	objectUrl: string;
	/** Intrinsic source duration in seconds; 0 until known. */
	duration: number;
	/** For video sources: intrinsic [width, height]; undefined until known. */
	dimensions?: [number, number];
	/** Number of live consumers holding this entry. */
	refCount: number;
	/** Pending eviction timer (set when refCount === 0), or null. */
	evictionTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Schedule a timer that does not keep the Node event loop alive.
 * In browsers `unref` does not exist; the call is harmless.
 */
function scheduleUnref(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
	const t = setTimeout(fn, ms);
	if (typeof (t as any).unref === 'function') (t as any).unref();
	return t;
}

export class MediaCache {
	/** Promise-valued so concurrent acquires share the same in-flight fetch. */
	private map = new Map<string, Promise<MediaEntry>>();

	/** Grace period before an unref'd entry is evicted. */
	static EVICTION_DELAY_MS = 5_000;

	/** Synchronous existence check (does not change refcounts). */
	has(url: string): boolean {
		return this.map.has(url);
	}

	/**
	 * Take a reference to a source. Fetches the bytes if the entry is not
	 * already in the cache; otherwise returns the existing entry. Cancels any
	 * pending eviction timer and increments `refCount`.
	 */
	async acquire(url: string): Promise<MediaEntry> {
		let pending = this.map.get(url);
		if (!pending) {
			pending = this.fetchAndStore(url);
			this.map.set(url, pending);
		}
		let entry: MediaEntry;
		try {
			entry = await pending;
		} catch (err) {
			// Ensure a failed fetch does not poison the URL forever.
			if (this.map.get(url) === pending) this.map.delete(url);
			throw err;
		}
		if (entry.evictionTimer) {
			clearTimeout(entry.evictionTimer);
			entry.evictionTimer = null;
		}
		entry.refCount++;
		return entry;
	}

	/**
	 * Release a reference. When the last reference goes away the entry is
	 * scheduled for eviction after `EVICTION_DELAY_MS`. Calling `acquire()`
	 * again before the timer fires cancels the eviction.
	 */
	release(url: string): void {
		const pending = this.map.get(url);
		if (!pending) return;
		// `pending` should already be settled by the time anyone releases —
		// they had to await it via acquire() — so .then() runs synchronously
		// in practice.
		pending.then((entry) => {
			if (entry.refCount <= 0) return;
			entry.refCount--;
			if (entry.refCount === 0 && !entry.evictionTimer) {
				entry.evictionTimer = scheduleUnref(() => this.evict(url), MediaCache.EVICTION_DELAY_MS);
			}
		}).catch(() => {});
	}

	/**
	 * Insert bytes the caller already has (e.g. the compile-time probe).
	 *
	 * - If the entry exists, updates `duration` if a non-zero value is passed
	 *   and the entry's duration is still 0. Does NOT touch refCount or any
	 *   pending timer.
	 * - If the entry does not exist, inserts it with `refCount = 0` and
	 *   immediately schedules a 5 s eviction timer. A subsequent `acquire`
	 *   cancels the timer and bumps refCount; otherwise the entry is dropped.
	 */
	async populate(url: string, blob: Blob, duration?: number): Promise<MediaEntry> {
		const existing = this.map.get(url);
		if (existing) {
			const entry = await existing;
			if (duration != null && Number.isFinite(duration) && duration > 0 && !(entry.duration > 0)) {
				entry.duration = duration;
			}
			return entry;
		}
		const entry: MediaEntry = {
			blob,
			objectUrl: URL.createObjectURL(blob),
			duration: duration && Number.isFinite(duration) && duration > 0 ? duration : 0,
			dimensions: undefined,
			refCount: 0,
			evictionTimer: null,
		};
		entry.evictionTimer = scheduleUnref(() => this.evict(url), MediaCache.EVICTION_DELAY_MS);
		this.map.set(url, Promise.resolve(entry));
		return entry;
	}

	/**
	 * Synchronously look up an entry without changing its refcount.
	 * Returns undefined if the entry has not finished fetching yet.
	 */
	peek(url: string): MediaEntry | undefined {
		const pending = this.map.get(url);
		if (!pending) return undefined;
		// We cannot synchronously unwrap a Promise, so callers needing the
		// resolved entry should `await acquire()` instead. peek() is only
		// useful for the in-place mutations done by populate() / fetchAndStore().
		let result: MediaEntry | undefined;
		(pending as any).then((e: MediaEntry) => { result = e; });
		return result;
	}

	// ---- internal --------------------------------------------------------

	private async fetchAndStore(url: string): Promise<MediaEntry> {
		const response = await fetch(url, { cache: 'default' });
		if (!response.ok) {
			throw new Error(`MediaCache: failed to fetch "${url}": ${response.status} ${response.statusText}`);
		}
		const blob = await response.blob();
		const entry: MediaEntry = {
			blob,
			objectUrl: URL.createObjectURL(blob),
			duration: 0,
			dimensions: undefined,
			refCount: 0,
			evictionTimer: null,
		};
		return entry;
	}

	private evict(url: string): void {
		const pending = this.map.get(url);
		if (!pending) return;
		pending.then((entry) => {
			// Re-check: a late acquire() may have bumped refCount before the
			// timer actually fired (rare, but possible if the loop was busy).
			if (entry.refCount > 0) return;
			try { URL.revokeObjectURL(entry.objectUrl); } catch {}
			if (this.map.get(url) === pending) this.map.delete(url);
		}).catch(() => {
			if (this.map.get(url) === pending) this.map.delete(url);
		});
	}
}

/** The shared singleton used by VideoFlow.loadedMedia and the renderers. */
export const loadedMedia = new MediaCache();
