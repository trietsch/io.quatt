import Homey from 'homey';
import {QuattRemoteApiClient, QuattTokenStore, QuattTokens} from '../../lib/quatt';

class QuattChillDriver extends Homey.Driver {
    async onInit() {
        this.log('Quatt Chill driver has been initialized');
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

        const tokenStore = new QuattTokenStore(this.homey.settings, this.log.bind(this));

        for (const heatpumpDevice of heatpumpDevices) {
            const device = heatpumpDevice as Homey.Device;
            const remoteCicId = device.getStoreValue('remoteCicId') as string | undefined;

            if (!remoteCicId) {
                continue;
            }

            let credentials = tokenStore.getCredentials(remoteCicId);

            if (!credentials) {
                const remoteTokens = device.getStoreValue('remoteTokens') as QuattTokens | undefined;
                const remoteInstallationId = device.getStoreValue('remoteInstallationId') as string | undefined;
                if (!remoteTokens || !remoteInstallationId) {
                    continue;
                }
                credentials = tokenStore.migrateFromDevice(remoteCicId, remoteTokens, remoteInstallationId);
            }

            try {
                const remoteClient = new QuattRemoteApiClient(
                    this.homey.app.manifest.version,
                    credentials.tokens,
                    credentials.cicId,
                    credentials.installationId,
                    tokenStore.sourceFor(credentials.cicId)
                );
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
                this.error('Unable to fetch Quatt Chill devices:', error);
            }
        }

        return results;
    }
}

module.exports = QuattChillDriver;
