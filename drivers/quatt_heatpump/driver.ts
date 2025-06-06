import Homey from 'homey';
import {Socket} from "net";
import {QuattClient} from "../../lib/quatt";
import PairSession from "homey/lib/PairSession";

class QuattHeatpumpDriver extends Homey.Driver {
    private type: string = '';
    private deviceError: any = false;
    private devices: any[] | null = null;

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
                let hostname = await this.getQuattHostname(ipAddress);

                // @ts-ignore updateSettings is an extension of the Quatt Homey App
                this.homey.app.updateSettings({ipAddress: ipAddress});

                this.devices = [
                    {
                        name: "Quatt CIC (manual)",
                        data: {
                            id: hostname,
                        },
                        store: {
                            address: ipAddress,
                        },
                    }
                ]

                this.deviceError = false;

                this.homey.app.log(`[Driver] ${this.id} - Successful manual connection with device:`, ipAddress);
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
            let {ip, hostname} = await this.quattDeviceNetworkScan();
            // return [
            //     {
            //         name: "Quatt CiC",
            //         data: {
            //             hostname: hostname,
            //             ip: ip
            //         },
            //         store: {
            //             address: ip,
            //         },
            //     }
            // ];
            return [];
        } catch (e) {
            this.homey.log("Error while discovering Quatt CiC, falling back to no devices.", e);

            return [];
        }
    }

    /**
     * As the Quatt CIC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
     * However, I've used the MAC address discovery strategy in the past, with all the MAC address prefixes as defined for Sunplus technologies (that's probably the manufacturer of the network card used in the Quatt CIC) (as defined here: https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd), but one day it stopped detecting the Quatt CIC.
     *
     * Therefore, I've setup a simple network scan, which scans the local network for the Quatt CIC, by trying to connect to port 8080 on all IP addresses in the local subnet. If the port is open, we try to fetch data from the candidate device, and if that succeeds, we assume it's the Quatt CIC.
     */
    private async quattDeviceNetworkScan(): Promise<QuattDetails> {
        let homeyAddress = await this.homey.cloud.getLocalAddress();
        let lan = homeyAddress.split('.').slice(0, 3).join('.');
        this.homey.app.error(`[Driver] ${this.id} - autodiscovering Quatt device on local network, using LAN subnet:`, lan);

        let quattCandidates: string[] = [];
        let quattIP: string | null = null;
        let quattHostname: string | null = null;

        for (let i = 1; i <= 255; i++) {
            let host = `${lan}.${i}`;

            let socket = new Socket();
            let status: string | null = null;

            // Socket connection established, port is open
            socket.on('connect', function () {
                status = 'open';
                socket.end();
            });
            socket.setTimeout(1500);// If no response, assume port is not listening
            socket.on('timeout', function () {
                status = 'closed';
                quattCandidates.splice(quattCandidates.indexOf(host), 1);
                socket.destroy();
            });
            socket.on('error', (exception) => {
                status = 'closed';
                quattCandidates.splice(quattCandidates.indexOf(host), 1);
            });
            socket.on('close', async (exception) => {
                if (status == 'open') {
                    try {
                        let hostname = await this.getQuattHostname(host);
                        if (hostname !== undefined) {
                            quattIP = host;
                            quattHostname = hostname;
                        }
                    } catch (error) {

                    }
                }

                quattCandidates.splice(quattCandidates.indexOf(host), 1);
            });

            quattCandidates.push(host);
            socket.connect(8080, host);
        }

        while (quattCandidates.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        if (quattIP && quattHostname) {
            return {ip: quattIP, hostname: quattHostname};
        } else {
            this.homey.app.log('No Quatt device found on the local network');
            throw new Error('No Quatt device found on the local network');
        }
    }

    private async getQuattHostname(address: string) {
        let client = new QuattClient(this.homey.app.manifest.version, address);
        let stats = await client.getCicStats();

        return stats?.system.hostName
    }
}

interface QuattDetails {
    ip: string;
    hostname: string;
}

module.exports = QuattHeatpumpDriver;


