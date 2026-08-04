import Homey from 'homey';
import {QuattChill, QuattRemoteApiClient, QuattTokens} from '../../lib/quatt';

interface ChillsCacheEntry {
    timestamp: number;
    chills: QuattChill[];
    inflight: Promise<QuattChill[]> | null;
}

class QuattChillDriver extends Homey.Driver {
    // Shared chills cache per installation, so multiple Chill devices together
    // trigger one API call per poll interval instead of one call each.
    private chillsCache: Map<string, ChillsCacheEntry> = new Map();

    async onInit() {
        this.log('Quatt Chill driver has been initialized');
    }

    async getChillsShared(client: QuattRemoteApiClient, installationId: string, options: {allowCached?: boolean} = {}): Promise<QuattChill[]> {
        const entry = this.chillsCache.get(installationId) ?? {timestamp: 0, chills: [], inflight: null};
        this.chillsCache.set(installationId, entry);

        if (options.allowCached) {
            if (entry.inflight) return entry.inflight;
            if (Date.now() - entry.timestamp < this.getSharedCacheTtl()) return entry.chills;
        }

        entry.inflight = client.getChills()
            .then((chills) => {
                entry.timestamp = Date.now();
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
    private getSharedCacheTtl(): number {
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
            const remoteTokens = device.getStoreValue('remoteTokens') as QuattTokens | undefined;
            const remoteCicId = device.getStoreValue('remoteCicId') as string | undefined;
            const remoteInstallationId = device.getStoreValue('remoteInstallationId') as string | undefined;

            if (!remoteTokens || !remoteCicId || !remoteInstallationId) {
                continue;
            }
            devicesWithRemoteControl++;

            try {
                const remoteClient = new QuattRemoteApiClient(
                    this.homey.app.manifest.version,
                    remoteTokens,
                    remoteCicId,
                    remoteInstallationId
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
                            cicId: remoteCicId,
                            installationId: remoteInstallationId,
                        },
                        store: {
                            chillUuid: chill.uuid,
                            remoteTokens,
                            remoteCicId,
                            remoteInstallationId,
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
