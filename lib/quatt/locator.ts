import {Socket} from "net";
import {QuattClient} from "./index";

interface QuattDeviceDetails {
    ip: string;
    hostname: string;
}


export class QuattLocator {
    private readonly logger: (...args: any[]) => void;
    private readonly appVersion: string;

    constructor(logger: (...args: any[]) => void, appVersion: string) {
        this.logger = logger;
        this.appVersion = appVersion;
    }

    /**
     * As the Quatt CiC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
     * However, I've used the MAC address discovery strategy in the past, with all the MAC address prefixes as defined for Sunplus technologies (that's probably the manufacturer of the network card used in the Quatt CiC) (as defined here: https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd), but one day it stopped detecting the Quatt CiC.
     *
     * Therefore, I've setup a simple network scan, which scans the local network for the Quatt CiC, by trying to connect to port 8080 on all IP addresses in the local subnet. If the port is open, we try to fetch data from the candidate device, and if that succeeds, we assume it's the Quatt CiC.
     */
    async quattDeviceNetworkScan(subnet: string): Promise<QuattDeviceDetails> {
        let lan = subnet.split('.').slice(0, 3).join('.');
        this.logger(`[QuattHelper] autodiscovering Quatt device on local network, using LAN subnet:`, lan);

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
            this.logger('No Quatt device found on the local network');
            throw new Error('No Quatt device found on the local network');
        }
    }

    async getQuattHostname(address: string) {
        let client = new QuattClient(this.appVersion, address);
        let stats = await client.getCicStats();

        return stats?.system.hostName
    }
}
