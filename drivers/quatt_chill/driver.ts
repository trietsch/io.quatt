import Homey from 'homey';
import {QuattRemoteApiClient, QuattTokens} from '../../lib/quatt';

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

        for (const heatpumpDevice of heatpumpDevices) {
            const device = heatpumpDevice as Homey.Device;
            const remoteTokens = device.getStoreValue('remoteTokens') as QuattTokens | undefined;
            const remoteCicId = device.getStoreValue('remoteCicId') as string | undefined;
            const remoteInstallationId = device.getStoreValue('remoteInstallationId') as string | undefined;

            if (!remoteTokens || !remoteCicId || !remoteInstallationId) {
                continue;
            }

            try {
                const remoteClient = new QuattRemoteApiClient(
                    this.homey.app.manifest.version,
                    remoteTokens,
                    remoteCicId,
                    remoteInstallationId
                );
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
                this.error('Unable to fetch Quatt Chill devices:', error);
            }
        }

        return results;
    }
}

module.exports = QuattChillDriver;
