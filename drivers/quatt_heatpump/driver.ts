import Homey from 'homey';
import {Socket} from "net";
import {QuattClient} from "../../lib/quatt";

class QuattHeatpumpDriver extends Homey.Driver {

    async onInit() {
    }

    async onPairListDevices() {
        try {
            let {ip, hostname} = await this.findQuattDevice();
            return [
                {
                    name: "Quatt CIC",
                    data: {
                        id: hostname,
                    },
                    store: {
                        address: ip,
                    },
                }
            ];
        } catch (e) {
            // FIXME ensure that the fallback first tries to use a provided static ip for the Quatt CiC
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
    private async findQuattDevice(): Promise<QuattDetails> {
        let homeyAddress = await this.homey.cloud.getLocalAddress();
        let lan = homeyAddress.split('.').slice(0, 3).join('.');
        this.log('lan', lan)

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
                    let hostname = await this.getQuattHostname(host);
                    if (hostname !== undefined) {
                        quattIP = host;
                        quattHostname = hostname;
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
        try {
            let client = new QuattClient(this.homey.app.manifest.version, address);
            let stats = await client.getCicStats(false);

            return stats?.system.hostName
        } catch (error) {
            return undefined;
        }
    }
}

interface QuattDetails {
    ip: string;
    hostname: string;
}

module.exports = QuattHeatpumpDriver;
