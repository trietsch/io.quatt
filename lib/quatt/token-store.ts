import {QuattTokens} from "./remote-api";

/**
 * The subset of Homey's ManagerSettings that we depend on, so the store can be
 * unit tested without a Homey runtime.
 */
export interface QuattSettingsStorage {
    get(key: string): any;

    set(key: string, value: any): void;
}

export interface QuattTokenStoreOptions {
    /**
     * How long a device waits behind another device's refresh before giving up on the lock
     * and refreshing itself. Defaults to 20 seconds.
     */
    refreshLockTimeoutMs?: number;
}

export interface QuattCredentials {
    tokens: QuattTokens;
    cicId: string;
    installationId: string;
}

/**
 * Credentials are shared by every device that talks to the Quatt remote API, so they
 * live in app-level settings rather than in each device's own store.
 */
export const REMOTE_CREDENTIALS_SETTINGS_KEY = 'remoteCredentials';

/**
 * A token source scoped to a single CiC, handed to a QuattRemoteApiClient.
 */
export interface QuattTokenSource {
    getTokens(): QuattTokens | null;

    /**
     * A re-pair can hand out a different installation, so clients re-read it rather than
     * holding on to the value they were constructed with.
     */
    getInstallationId(): string | null;

    setTokens(tokens: QuattTokens): void;

    /**
     * Run fn while holding the refresh lock for this CiC, so that concurrent refreshes
     * across devices are serialised instead of racing each other.
     */
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Single source of truth for Quatt remote API credentials.
 *
 * Previously the CiC device and every Chill device each kept their own copy of the same
 * tokens in device.store and refreshed them independently. That meant a re-pair ("Repair")
 * only updated the CiC, leaving every Chill stranded on credentials for an identity that no
 * longer existed, and concurrent refreshes could overwrite each other's state.
 */
export class QuattTokenStore {
    private readonly settings: QuattSettingsStorage;
    private readonly logger: (...args: any[]) => void;
    private readonly refreshLockTimeoutMs: number;
    /**
     * Keyed by CiC and shared by every store instance: each device builds its own
     * QuattTokenStore in its own onInit, so a per-instance map would hand the CiC and
     * every Chill a lock of their own and serialise nothing between them.
     */
    private static readonly refreshLocks = new Map<string, Promise<unknown>>();

    private static readonly DEFAULT_REFRESH_LOCK_TIMEOUT_MS = 20_000;

    constructor(settings: QuattSettingsStorage, logger: (...args: any[]) => void = () => {
    }, options: QuattTokenStoreOptions = {}) {
        this.settings = settings;
        this.logger = logger;
        this.refreshLockTimeoutMs = options.refreshLockTimeoutMs ?? QuattTokenStore.DEFAULT_REFRESH_LOCK_TIMEOUT_MS;
    }

    private readAll(): Record<string, QuattCredentials> {
        const raw = this.settings.get(REMOTE_CREDENTIALS_SETTINGS_KEY);
        if (!raw || typeof raw !== 'object') {
            return {};
        }
        return raw as Record<string, QuattCredentials>;
    }

    getCredentials(cicId: string): QuattCredentials | null {
        const credentials = this.readAll()[cicId];
        if (!credentials || !credentials.tokens || !credentials.installationId) {
            return null;
        }
        return credentials;
    }

    saveCredentials(credentials: QuattCredentials): void {
        const all = this.readAll();
        all[credentials.cicId] = credentials;
        this.settings.set(REMOTE_CREDENTIALS_SETTINGS_KEY, all);
        this.logger(`[QuattTokenStore] Stored credentials for CiC ${credentials.cicId}`);
    }

    updateTokens(cicId: string, tokens: QuattTokens): void {
        const existing = this.getCredentials(cicId);
        if (!existing) {
            this.logger(`[QuattTokenStore] Cannot update tokens, no credentials for CiC ${cicId}`);
            return;
        }
        this.saveCredentials({...existing, tokens});
    }

    /**
     * Seed the shared store from credentials that still live in a device's own store,
     * so existing installations keep working after updating the app. Does not overwrite
     * credentials that are already shared.
     */
    migrateFromDevice(cicId: string, tokens: QuattTokens, installationId: string): QuattCredentials {
        const existing = this.getCredentials(cicId);
        if (existing) {
            return existing;
        }

        const credentials: QuattCredentials = {cicId, installationId, tokens};
        this.saveCredentials(credentials);
        this.logger(`[QuattTokenStore] Migrated per-device credentials for CiC ${cicId} into shared storage`);
        return credentials;
    }

    /**
     * A token source bound to one CiC. Every source for that CiC reads the same settings
     * and takes the same refresh lock, whichever store instance handed it out, so all
     * devices see the same tokens and refresh one at a time.
     */
    sourceFor(cicId: string): QuattTokenSource {
        return {
            getTokens: () => this.getCredentials(cicId)?.tokens ?? null,
            getInstallationId: () => this.getCredentials(cicId)?.installationId ?? null,
            setTokens: (tokens: QuattTokens) => this.updateTokens(cicId, tokens),
            runExclusive: <T>(fn: () => Promise<T>) => this.runExclusive(cicId, fn),
        };
    }

    private async runExclusive<T>(cicId: string, fn: () => Promise<T>): Promise<T> {
        const locks = QuattTokenStore.refreshLocks;
        const previous = locks.get(cicId) ?? Promise.resolve();
        const current = this.awaitTurn(previous).then(() => fn());
        const guard = current.then(() => undefined, () => undefined);
        locks.set(cicId, guard);

        try {
            return await current;
        } finally {
            if (locks.get(cicId) === guard) {
                locks.delete(cicId);
            }
        }
    }

    /**
     * Wait for whoever holds the lock, but not indefinitely.
     *
     * The Homey app is one process that runs for months, and this lock is now shared by
     * every device rather than held per store instance, so a refresh that stalls no longer
     * delays one device: it delays all of them, in series. Giving up after a wait longer
     * than any healthy refresh takes degrades to the unserialised behaviour we had before
     * the lock was shared, which costs an extra refresh call. Queueing behind a stalled
     * device instead would cost every Chill its updates for as long as the stall lasts.
     *
     * A failed refresh must not poison the queue for whoever comes next either, so the
     * wait ignores how the previous holder finished.
     */
    private async awaitTurn(previous: Promise<unknown>): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ceiling = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.refreshLockTimeoutMs);
            // Never keep the app's event loop alive just to police the lock.
            if (typeof timer.unref === 'function') {
                timer.unref();
            }
        });

        try {
            await Promise.race([previous.then(() => undefined, () => undefined), ceiling]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
}
