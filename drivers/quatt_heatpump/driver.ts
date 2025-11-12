import Homey from 'homey';
import PairSession from "homey/lib/PairSession";
import {QuattLocator} from "../../lib/quatt/locator";
import {QuattRemoteApiClient, QuattTokens} from "../../lib/quatt";

class QuattHeatpumpDriver extends Homey.Driver {
    private type: string = '';
    private deviceError: any = false;
    private devices: any[] | null = null;
    private remotePairData: {tokens?: QuattTokens, installationId?: string} | null = null;

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

    async onRepair(session: PairSession, device: any) {
        this.homey.app.log(`[Driver] ${this.id} - Starting repair session for device: ${device.getName()}`);

        session.setHandler('get_cic_id', async () => {
            // Get CIC ID from device data
            const hostname = device.getData().hostname || device.getData().id;
            this.homey.app.log(`[Driver] ${this.id} - Repair: CIC ID is ${hostname}`);
            return hostname;
        });

        session.setHandler('get_user_info', async () => {
            // Try to get previously stored name from settings, or return empty
            try {
                const remoteControlStatus = device.getSetting('remoteControlStatus');
                this.homey.app.log(`[Driver] ${this.id} - Repair: Remote control status: ${remoteControlStatus}`);

                // Parse the status string like "✓ Configured (John Doe)" to extract names
                if (remoteControlStatus && remoteControlStatus.includes('(') && remoteControlStatus.includes(')')) {
                    const match = remoteControlStatus.match(/\(([^)]+)\)/);
                    if (match && match[1]) {
                        const fullName = match[1].trim();
                        const parts = fullName.split(' ');
                        if (parts.length >= 2) {
                            const firstName = parts[0];
                            const lastName = parts.slice(1).join(' ');
                            this.homey.app.log(`[Driver] ${this.id} - Repair: Prefilling with previous names: ${firstName} ${lastName}`);
                            return { firstName, lastName };
                        }
                    }
                }

                // No previous pairing found, return empty
                return { firstName: '', lastName: '' };
            } catch (error) {
                this.homey.app.log(`[Driver] ${this.id} - Repair: Could not get user info:`, error);
                return { firstName: '', lastName: '' };
            }
        });

        session.setHandler('remote_pair', async (data) => {
            try {
                const {firstName, lastName} = data;
                this.homey.app.log(`[Driver] ${this.id} - Repair: Remote pairing with first name: ${firstName}, last name: ${lastName}`);

                const cicId = device.getData().hostname || device.getData().id;

                // Create remote API client and authenticate
                const remoteClient = new QuattRemoteApiClient(this.homey.app.manifest.version);

                this.homey.app.log(`[Driver] ${this.id} - Repair: Starting authentication with CIC ID: ${cicId}`);
                const result = await remoteClient.authenticate(firstName, lastName, cicId);

                this.homey.app.log(`[Driver] ${this.id} - Repair: Successfully authenticated and paired with remote API`);

                // Store the remote data in device
                await device.setStoreValue('remoteTokens', result.tokens);
                await device.setStoreValue('remoteInstallationId', result.installationId);
                await device.setStoreValue('remoteCicId', cicId);

                // Update settings to show remote control is configured
                await device.setSettings({
                    remoteControlStatus: `✓ Configured (${firstName} ${lastName})`
                });

                // Initialize the remote client on the device immediately
                device.remoteClient = remoteClient;

                this.homey.app.log(`[Driver] ${this.id} - Repair: Remote data stored and remote client initialized`);

                return true;
            } catch (error: any) {
                this.homey.app.error(`[Driver] ${this.id} - Repair: Error during remote pairing:`, error);
                throw new Error(error.message || 'Remote pairing failed');
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


