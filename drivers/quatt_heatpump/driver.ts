import Homey from 'homey';
import PairSession from "homey/lib/PairSession";
import {QuattLocator} from "../../lib/quatt/locator";

class QuattHeatpumpDriver extends Homey.Driver {
    private type: string = '';
    private deviceError: any = false;
    private devices: any[] | null = null;

    private quattLocator: QuattLocator = new QuattLocator(this.homey.log, this.homey.app.manifest.version);

    async onInit() {
    }

    async onPair(session: PairSession) {
        session.setHandler('showView', async (view) => {
            if (view === 'error' && this.deviceError) {
                await session.emit('deviceError', this.deviceError);
            }
        });

        session.setHandler('list_devices', async () => {
            try {
                if (this.deviceError) {
                    await session.showView('error');
                    return;
                }
                if (this.devices === null) {
                    this.homey.app.log(`[Driver] ${this.id} - No devices searched yet, using autodiscovery.`);
                    this.devices = await this.fetchQuattDevicesViaAutodiscovery();
                }

                if (this.devices !== null && this.devices.length === 0) {
                    this.homey.app.log(`[Driver] ${this.id} - No devices found, showing manual pairing view.`);
                    await session.showView('manual_pair');
                } else {
                    this.homey.app.log(`[Driver] ${this.id} - Found devices:`, this.devices);
                    return this.devices;
                }
            } catch (error: any) {
                this.homey.app.error(`[Driver] ${this.id} - Error:`, error);
                this.deviceError = error;

                await session.showView('error');
            }
        });

        session.setHandler('manual_pair', async (data) => {
            try {
                const ipAddress = data.ipAddress;
                this.homey.app.log(`[Driver] ${this.id} - Manually pairing with IP address: ${ipAddress}`);
                let hostname = await this.quattLocator.getQuattHostname(ipAddress);

                this.devices = [
                    {
                        name: "Quatt CiC (manual)",
                        data: {
                            id: hostname,
                        },
                        store: {
                            address: ipAddress,
                        },
                    }
                ]

                this.deviceError = false;

                this.homey.app.log(`[Driver] ${this.id} - Successfully paired with device at ${ipAddress}`);
                await session.showView('list_devices');
            } catch (error) {
                this.homey.app.error(`[Driver] ${this.id} - Error while manually pairing:`, JSON.stringify(error));
                this.deviceError = this.homey.__('pair.error_notAQuattDevice');

                await session.showView('error');
                this.homey.app.log(`[Driver] ${this.id} - Error while manually pairing, showing error view.`);
                return false;
            }
        });
    }

    async fetchQuattDevicesViaAutodiscovery() {
        try {
            let homeyAddress = await this.homey.cloud.getLocalAddress();
            let {ip, hostname} = await this.quattLocator.quattDeviceNetworkScan(homeyAddress);
            return [
                {
                    name: "Quatt CiC",
                    data: {
                        hostname: hostname,
                        ip: ip
                    },
                    store: {
                        address: ip,
                    },
                }
            ];
        } catch (e) {
            this.homey.log("Error while discovering Quatt CiC, falling back to no devices.", e);

            return [];
        }
    }
}

module.exports = QuattHeatpumpDriver;


