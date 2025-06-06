import Homey from 'homey';
import {Socket} from "net";
import {QuattClient} from "../../lib/quatt";
import PairSession from "homey/lib/PairSession";

class QuattHeatpumpDriver extends Homey.Driver {

    async onInit() {
        this.log('QuattHeatpumpDriver initialized.');
    }

    async onPair(session: PairSession) {
        this.setPairingSession(session);
    }

    async onRepair(session: PairSession) {
        this.setPairingSession(session);
    }

    async setPairingSession(session: PairSession) {
        // Show list automatic devices first
        await session.showView("list_devices");



        session.setHandler('list_devices', async () => {
            try {
                return this._devices;
            } catch (error) {
                this.homey.app.error(`[Driver] ${this.id} - Error:`, error);
                this.deviceError = error;

                session.showView('error');
            }
        });

        session.setHandler('showView', async (view) => {
            try {
                if (view === 'list_devices') {

                }

                if (view === 'manual_pair') {
                    session.showView('error');
                    return true;
                }
            } catch (error) {
                this.homey.app.error(`[Driver] ${this.id} - Error:`, error);
            }
        });

    }

    async listDevices(session: PairSession) {
        this.log('onPairListDevices called. Starting pairing process...');
        // 1. Try IP from App Settings first
        const settingsIp = this.homey.settings.get('cicIPAddress');
        if (settingsIp) {
            this.log(`Attempting to pair using IP from app settings: ${settingsIp}.`);
            try {
                const hostname = await this.getQuattHostname(settingsIp);
                if (hostname) {
                    this.log(`Successfully verified Quatt CIC at settings IP ${settingsIp}, hostname: ${hostname}.`);
                    return [
                        {
                            name: "Quatt CIC (static IP address)", // Indicate it's from settings
                            data: {
                                id: hostname,
                            },
                            store: {
                                address: settingsIp,
                            },
                        }
                    ];
                } else {
                    this.log(`Failed to verify Quatt CIC at settings IP ${settingsIp}. Proceeding to automatic discovery.`);
                }
            } catch (error: any) {
                this.error(`Error during pairing attempt with settings IP ${settingsIp}: ${error.message}. Proceeding to automatic discovery.`);
            }
        } else {
            this.log("No IP address found in app settings. Proceeding to automatic discovery.");
        }

        // 2. If settings IP is not available or failed, try automatic discovery
        try {
            this.log("Attempting automatic Quatt CIC discovery...");
            let {ip, hostname} = await this.autodiscoverQuattDevice();
            this.log(`Automatic discovery successful: Found ${hostname} at ${ip}.`);
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
        } catch (e: any) {
            this.error("Automatic Quatt CIC discovery failed:", e.message); // Changed to this.error for consistency
            this.log("Fallback: Attempting manual IP entry.");

            // Show custom view for manual IP entry
            // const view = this.homey.flow.getView('manual_pair'); // Already gets view below, avoid duplication

            return new Promise(async (resolve, reject) => {
                const view = this.homey.flow.getView('manual_pair'); // Get view instance

                const manualIpListener = async (ipAddress: string) => {
                    this.log(`Manual IP pairing: User submitted IP address: ${ipAddress}`);
                    try {
                        // Unregister listener to prevent multiple calls - view.off is appropriate
                        view.off('manual_ip_address', manualIpListener);

                        const hostname = await this.getQuattHostname(ipAddress); // This call is already within a try/catch in the caller
                        if (hostname) {
                            this.log(`Manual IP pairing: Successfully verified Quatt CIC at ${ipAddress}, hostname: ${hostname}.`);
                            view.emit('manual_pair_success'); // Emit success to the view
                            resolve([
                                {
                                    name: "Quatt CIC",
                                    data: {
                                        id: hostname,
                                    },
                                    store: {
                                        address: ipAddress,
                                    },
                                }
                            ]);
                        } else {
                            this.log(`Manual IP pairing: Could not verify Quatt CIC at ${ipAddress}. Hostname not found.`);
                            view.emit('manual_pair_error', `Could not connect to or verify Quatt CIC at ${ipAddress}. Please check the address and try again, or ensure the device is online.`);
                            // Keeping the view open by not resolving immediately with devices.
                            // The user can try again. If they cancel the view, viewClosedListener handles it.
                            // To prevent pairing hanging, we might still want to resolve([]) here if strict "one-shot" manual entry is desired.
                            // However, allowing multiple tries from the view is more user-friendly.
                            // For now, let's assume the view allows retrying and doesn't auto-close on error emission.
                        }
                    } catch (err: any) {
                        view.off('manual_ip_address', manualIpListener); // Ensure listener is removed on error
                        this.error(`Manual IP pairing: Error after submitting IP ${ipAddress}: ${err.message}`);
                        view.emit('manual_pair_error', `An unexpected error occurred: ${err.message}. Please try again.`);
                        // Resolve with empty list to allow cancellation from Homey's side if needed,
                        // though ideally the view handles retries or cancellation.
                        resolve([]);
                    }
                };

                // Register the listener for the event emitted by the HTML view
                view.on('manual_ip_address', manualIpListener);

                // Handle view close/cancel
                const viewClosedListener = () => {
                    this.log("Manual pair view was closed by user.");
                    view.off('manual_ip_address', manualIpListener); // Clean up IP listener
                    // view.off('close', viewClosedListener); // Clean up self, though once should handle it.
                    resolve([]); // No device selected
                };
                view.once('close', viewClosedListener); // 'close' event is emitted when Homey.done() is called or user cancels

                try {
                    this.log("Showing manual IP entry view: 'manual_pair'");
                    await this.homey.flow.showView('manual_pair');
                } catch (viewError: any) { // Added type for viewError
                    this.error("Error showing 'manual_pair' view:", viewError.message);
                    view.off('manual_ip_address', manualIpListener);
                    view.off('close', viewClosedListener);
                    reject(viewError); // Propagate error to end pairing session
                }
            });
        }
    }

    /**
     * As the Quatt CIC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
     * However, I've used the MAC address discovery strategy in the past, with all the MAC address prefixes as defined for Sunplus technologies (that's probably the manufacturer of the network card used in the Quatt CIC) (as defined here: https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd), but one day it stopped detecting the Quatt CIC.
     *
     * Therefore, I've setup a simple network scan, which scans the local network for the Quatt CIC, by trying to connect to port 8080 on all IP addresses in the local subnet. If the port is open, we try to fetch data from the candidate device, and if that succeeds, we assume it's the Quatt CIC.
     */
    private async autodiscoverQuattDevice(): Promise<QuattDetails> {
        // Ensure homeyAddress is fetched safely
        let homeyAddress: string | null = null;
        try {
            homeyAddress = await this.homey.cloud.getLocalAddress();
            if (!homeyAddress) {
                throw new Error("Homey local address is null or undefined.");
            }
        } catch (err: any) {
            this.error("Failed to get Homey local address for network scan:", err.message);
            throw new Error("Could not determine local network for discovery."); // Propagate to onPairListDevices catch
        }

        const lan = homeyAddress.split('.').slice(0, 3).join('.');
        this.log(`Starting network scan on LAN: ${lan}.* for Quatt CIC.`);

        const quattCandidates: string[] = [];
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
            socket.setTimeout(1500); // If no response, assume port is not listening
            socket.on('timeout', () => { // Arrow function for consistent `this` if needed, though not used here
                status = 'closed';
                const index = quattCandidates.indexOf(host);
                if (index > -1) quattCandidates.splice(index, 1);
                socket.destroy();
            });
            socket.on('error', (exception: Error) => { // Added type for exception
                status = 'closed';
                const index = quattCandidates.indexOf(host);
                if (index > -1) quattCandidates.splice(index, 1);
                // this.log(`Socket error for ${host}: ${exception.message}`); // Potentially too verbose
            });
            socket.on('close', async (hadError: boolean) => { // Added hadError parameter
                if (status === 'open' && !hadError) {
                    this.log(`Port 8080 open on ${host}. Verifying if it's a Quatt CIC.`);
                    const hostname = await this.getQuattHostname(host); // getQuattHostname already logs its errors
                    if (hostname) {
                        this.log(`Verified Quatt CIC: ${hostname} at ${host}.`);
                        quattIP = host;
                        quattHostname = hostname;
                        // Optimization: If one is found, could potentially stop scanning or resolve early.
                        // For now, it continues scanning all, then picks the last one found or first.
                        // Current logic implies last one found that successfully sets quattIP/quattHostname will be used.
                    }
                }
                const index = quattCandidates.indexOf(host);
                if (index > -1) quattCandidates.splice(index, 1);
            });

            quattCandidates.push(host);
            socket.connect(8080, host);
        }

        this.log("Network scan initiated for all candidates. Waiting for results...");
        // Wait for all sockets to close or timeout
        let waitCycles = 0;
        const maxWaitCycles = (1500 + 500) / 25; // Max timeout + buffer, divided by sleep interval
        while (quattCandidates.length > 0 && waitCycles < maxWaitCycles) {
            await new Promise(resolve => setTimeout(resolve, 25));
            waitCycles++;
        }
        if (quattCandidates.length > 0) {
            this.log(`Network scan timed out with ${quattCandidates.length} candidates remaining.`);
            quattCandidates.forEach(host => this.log(` - ${host} did not resolve in time.`));
            // Forcibly destroy remaining sockets?
        }


        if (quattIP && quattHostname) {
            this.log(`Automatic discovery finished. Found Quatt CIC: ${quattHostname} at ${quattIP}`);
            return {ip: quattIP, hostname: quattHostname};
        } else {
            this.log('Automatic discovery finished. No Quatt CIC found on the local network.');
            throw new Error('No Quatt device found on the local network during scan.');
        }
    }

    private async getQuattHostname(address: string): Promise<string | undefined> {
        this.log(`Verifying hostname for address: ${address}`);
        try {
            const client = new QuattClient(this.homey.manifest.version, address);
            const stats = await client.getCicStats(false); // false for full stats, could be true for quicker check if available
            if (stats && stats.system && stats.system.hostName) {
                this.log(`Successfully fetched hostname '${stats.system.hostName}' from ${address}`);
                return stats.system.hostName;
            }
            this.log(`Could not retrieve valid hostname from ${address}. Response or system data missing.`);
            return undefined;
        } catch (error: any) {
            this.error(`Error in getQuattHostname for IP ${address}: ${error.message}`);
            return undefined;
        }
    }
}

interface QuattDetails {
    ip: string;
    hostname: string;
}

module.exports = QuattHeatpumpDriver;
