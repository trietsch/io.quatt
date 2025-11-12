import {CicStats} from "./cic-stats";
import {RestClient} from "typed-rest-client/RestClient";
import { QuattApiError } from './errors';

export { QuattRemoteApiClient, QuattTokens, QuattRemoteSettings } from './remote-api';

type OptionalCicStats = CicStats | null;

/*
 * Look at https://www.pluralsight.com/tech-blog/taming-dynamic-data-in-typescript/ for a way to make this class more type-safe
 * in terms of converting the data from the Quatt CiC to the CicStats interface.
 */
export class QuattClient {
    private readonly appVersion: string;
    private deviceAddress: string;
    private client: RestClient;

    private readonly dataJson: string = "beta/feed/data.json";
    private readonly port: number = 8080;

    constructor(appVersion: string, deviceAddress: string) {
        this.appVersion = appVersion;
        this.deviceAddress = deviceAddress;
        this.client = new RestClient(`Homey Quatt App/${this.appVersion}`, this.deviceAddress);
    }

    setDeviceAddress(deviceAddress: string) {
        this.deviceAddress = deviceAddress;
    }

    async getCicStats(): Promise<OptionalCicStats> {
        const fetchPromise = this.client.get<OptionalCicStats>(
            `http://${this.deviceAddress}:${this.port}/${this.dataJson}`
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new QuattApiError(`Connection to ${this.deviceAddress} timed out after 5 seconds`)), 5000)
        );
        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (response.statusCode != 200) {
            throw new QuattApiError(`Failed to fetch data from ${this.deviceAddress}: Status code ${response.statusCode}`);
        }

        const result = response.result;

        if (result !== null) {
            result.qc.supervisoryControlMode = parseInt(result.qc.supervisoryControlMode) >= 100 ? '100' : result.qc.supervisoryControlMode.toString();
            result.hp1.getMainWorkingMode = result.hp1.getMainWorkingMode.toString();

            if (result.hp2 && result.hp2.getMainWorkingMode !== null) {
                result.hp2.getMainWorkingMode = result.hp2.getMainWorkingMode.toString();
            }
        }

        return result;
    }
}
