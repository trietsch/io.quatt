import {CicStats} from "./cic-stats";
import {RestClient} from "typed-rest-client/RestClient";

type OptionalCicStats = CicStats | null;

/*
 * Look at https://www.pluralsight.com/tech-blog/taming-dynamic-data-in-typescript/ for a way to make this class more type-safe
 * in terms of converting the data from the Quatt CIC to the CicStats interface.
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

    async getCicStats(shouldLog: boolean = true): Promise<OptionalCicStats> {
        try {
            const response = await this.client.get<OptionalCicStats>(`http://${this.deviceAddress}:${this.port}/${this.dataJson}`);

            if (response.statusCode != 200) {
                // FIXME improve non-200 error handling to instruct Homey to set the device to unavailable
                console.log(`Non-200 status code from ${this.deviceAddress}`);

                return null;
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
        } catch (error) {
            if (shouldLog) {
                console.log(`Error fetching data from ${this.deviceAddress}`);
                console.log(error);
            }
            return null;
        }
    }
}
