import axios from "axios";
import {CicStats} from "./cic-stats";
import {Socket} from "net";


export class QuattClient {
    private deviceAddress: string;
    private readonly homeyAddress: string;
    private connectionFailures: number = 0;
    private reconnectionAttempts: number = 0;

    constructor(deviceAddress: string, homeyAddress: string) {
        this.deviceAddress = deviceAddress;
        this.homeyAddress = homeyAddress;
    }

    async getCicStats(shouldLog: boolean = true, shouldReconnect: boolean = true): Promise<CicStats | null> {
        try {
            const response = await axios.get(`http://${this.deviceAddress}:8080/beta/feed/data.json`);

            return response.data as CicStats;
        } catch (error) {
            this.connectionFailures++;

            if (shouldLog) {
                console.log(`Error fetching data from ${this.deviceAddress}`);
                console.log(error);
            }

            if (this.connectionFailures <= 5 && this.reconnectionAttempts <= 5 && shouldReconnect) {
                console.log(`Failed to connect to ${this.deviceAddress} 5 times in a row, resetting device address`);
                this.reconnectionAttempts++;
                this.deviceAddress = await QuattClient.discover(this.homeyAddress);
                return this.getCicStats(shouldLog);
            }

            return null;
        }
    }

    /**
     * As the Quatt CIC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
     * However, I've used the MAC address discovery strategy in the past, with all the MAC address prefixes as defined for Sunplus technologies (that's probably the manufacturer of the network card used in the Quatt CIC) (as defined here: https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd), but one day it stopped detecting the Quatt CIC.
     *
     * Therefore, I've setup a simple network scan, which scans the local network for the Quatt CIC, by trying to connect to port 8080 on all IP addresses in the local subnet. If the port is open, we try to fetch data from the candidate device, and if that succeeds, we assume it's the Quatt CIC.
     */
    static async discover(homeyAddress: string): Promise<string> {
        let lan = homeyAddress.split('.').slice(0, 3).join('.');

        let quattCandidates: string[] = [];
        let quattIP: string | null = null;

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
                    if (await this.verifyIsQuatt(host, homeyAddress)) {
                        quattIP = host;
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

        if (quattIP) {
            return quattIP;
        } else {
            throw new Error('No Quatt device found on the local network');
        }
    }

    private static async verifyIsQuatt(address: string, homeyAddress: string) {
        try {
            let client = new QuattClient(address, homeyAddress);
            return await client.getCicStats(false, false) != null;
        } catch (error) {
            return false
        }
    }
}
