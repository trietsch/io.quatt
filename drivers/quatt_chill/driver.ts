import Homey from 'homey';
import {QuattChill, QuattRemoteApiClient, QuattTokenStore, QuattTokens} from '../../lib/quatt';

interface ChillsCacheEntry {
    fetchedAt: number;
    chills: QuattChill[];
    inflight: Promise<QuattChill[]> | null;
}

class QuattChillDriver extends Homey.Driver {
    // One remote API client per installation, owned by the driver and shared by
    // all Chill devices of that installation.
    private remoteApiClients: Map<string, QuattRemoteApiClient> = new Map();

    // Cached chills responses per installation, so interval polls of multiple
    // Chill devices trigger one API call per interval instead of one each.
    private chillsCache: Map<string, ChillsCacheEntry> = new Map();

    private tokenStoreInstance: QuattTokenStore | null = null;

    async onInit() {
        this.log('Quatt Chill driver has been initialized');
    }

    // Built lazily because this.homey is not available while fields initialize.
    get tokenStore(): QuattTokenStore {
        if (!this.tokenStoreInstance) {
            this.tokenStoreInstance = new QuattTokenStore(this.homey.settings, this.log.bind(this));
        }
        return this.tokenStoreInstance;
    }

    // The driver owns the client, and the client reads its credentials from the shared
    // store rather than from the snapshot the device passed in: a Repair on the CiC
    // writes there, so a client built before the Repair keeps working afterwards.
    getRemoteApiClient(installationId: string, config: {tokens: QuattTokens; cicId: string}): QuattRemoteApiClient {
        let client = this.remoteApiClients.get(installationId);
        if (!client) {
            client = new QuattRemoteApiClient(
                this.homey.app.manifest.version,
                config.tokens,
                config.cicId,
                installationId,
                this.tokenStore.sourceFor(config.cicId)
            );
            this.remoteApiClients.set(installationId, client);
        }
        return client;
    }

    async getChills(installationId: string, options: {allowCached?: boolean} = {}): Promise<QuattChill[]> {
        const client = this.remoteApiClients.get(installationId);
        if (!client) {
            throw new Error(`No Quatt remote API client available for installation ${installationId}`);
        }

        const entry = this.chillsCache.get(installationId) ?? {fetchedAt: 0, chills: [], inflight: null};
        this.chillsCache.set(installationId, entry);

        if (options.allowCached) {
            if (entry.inflight) return entry.inflight;
            if (Date.now() - entry.fetchedAt < this.getCacheTtl()) return entry.chills;
        }

        entry.inflight = client.getChills()
            .then((chills) => {
                entry.fetchedAt = Date.now();
                entry.chills = chills;
                return chills;
            })
            .finally(() => {
                entry.inflight = null;
            });

        return entry.inflight;
    }

    // Cache slightly shorter than the fastest configured poll interval, so every
    // device still sees data that is fresh within its own update expectations.
    private getCacheTtl(): number {
        const intervals = this.getDevices().map((device) => {
            const value = (device.getSettings() as {updateInterval?: unknown})?.updateInterval;
            return typeof value === 'number' && value >= 5 ? value : 30;
        });
        const minInterval = intervals.length ? Math.min(...intervals) : 30;
        return minInterval * 0.8 * 1000;
    }

    async onPair(session: Homey.Driver.PairSession) {
        session.setHandler('list_devices', async () => {
            return this.fetchQuattChillDevices();
        });
    }

    private async fetchQuattChillDevices() {
        const heatpumpDriver = this.homey.drivers.getDriver('quatt_heatpump') as Homey.Driver | undefined;
        const heatpumpDevices = heatpumpDriver ? heatpumpDriver.getDevices() : [];
        const results: any[] = [];

        if (heatpumpDevices.length === 0) {
            throw new Error(this.homey.__('pair.chill.noHeatpump'));
        }

        let devicesWithRemoteControl = 0;
        let installationHasChills = false;
        let apiErrorOccurred = false;

        for (const heatpumpDevice of heatpumpDevices) {
            const device = heatpumpDevice as Homey.Device;
            const remoteCicId = device.getStoreValue('remoteCicId') as string | undefined;

            if (!remoteCicId) {
                continue;
            }
            devicesWithRemoteControl++;

            let credentials = this.tokenStore.getCredentials(remoteCicId);

            if (!credentials) {
                const remoteTokens = device.getStoreValue('remoteTokens') as QuattTokens | undefined;
                const remoteInstallationId = device.getStoreValue('remoteInstallationId') as string | undefined;
                if (!remoteTokens || !remoteInstallationId) {
                    continue;
                }
                credentials = this.tokenStore.migrateFromDevice(remoteCicId, remoteTokens, remoteInstallationId);
            }

            try {
                const remoteClient = new QuattRemoteApiClient(
                    this.homey.app.manifest.version,
                    credentials.tokens,
                    credentials.cicId,
                    credentials.installationId,
                    this.tokenStore.sourceFor(credentials.cicId)
                );

                if (await remoteClient.hasChills().catch(() => false)) {
                    installationHasChills = true;
                }

                const chills = await remoteClient.getChills();

                for (const chill of chills) {
                    results.push({
                        name: chill.name || 'Quatt Chill',
                        data: {
                            id: chill.uuid,
                            uuid: chill.uuid,
                            cicId: credentials.cicId,
                            installationId: credentials.installationId,
                        },
                        // Only the CiC reference is stored; the credentials themselves stay in
                        // the shared store so a Repair on the CiC keeps this device working.
                        store: {
                            chillUuid: chill.uuid,
                            remoteCicId: credentials.cicId,
                            remoteInstallationId: credentials.installationId,
                        },
                    });
                }
            } catch (error) {
                apiErrorOccurred = true;
                this.error('Unable to fetch Quatt Chill devices:', error);
            }
        }

        if (results.length === 0) {
            if (devicesWithRemoteControl === 0) {
                throw new Error(this.homey.__('pair.chill.noRemoteControl'));
            }
            if (apiErrorOccurred || installationHasChills) {
                throw new Error(this.homey.__('pair.chill.apiError'));
            }
            throw new Error(this.homey.__('pair.chill.noChills'));
        }

        return results;
    }
}

module.exports = QuattChillDriver;
