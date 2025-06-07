import Homey from 'homey';



// Define an interface for global app settings, even if empty for now
interface AppSettings {
    // Example: globalApiKey?: string;
    // For this app, specific device IP is stored with the device, not globally.
}

class Quatt extends Homey.App {
    private settingsKey = `${this.homey.manifest.id}.settings`;

    private settingsExist: boolean = false;
    private appSettings: AppSettings = {};

    async onInit() {
        this.log(`${this.homey.manifest.id} started`);

        await this.initGlobalVars();
        await this.initSettings();
    }

    async initGlobalVars() {
        this.log('initGlobalVars');

        this.homey.settings.getKeys().forEach((key) => {
            if (key == this.settingsKey) {
                this.settingsExist = true;
            }
        });
    }

    async initSettings() {
        try {
            if (this.settingsExist) {
                this.log('initSettings - Found settings key', this.settingsKey);
                this.appSettings = this.homey.settings.get(this.settingsKey);

                return true;
            }

            this.log(`initSettings - Initializing ${this.settingsKey} with default empty settings object.`);
            // No default global settings needed for this app currently.
            // If global settings were introduced, they would be initialized here.
            this.updateSettings({});

            return true;
        } catch (err) {
            this.error(err);
        }
    }

    getSettings(): AppSettings {
        // Ensure that what's returned from Homey settings is cast to AppSettings
        const settings = this.homey.settings.get(this.settingsKey);
        return (settings || {}) as AppSettings;
    }

    updateSettings(settings: AppSettings) {
        this.debug('updateSettings - New app settings:', { ...settings });

        this.appSettings = settings;
        this.saveSettings();
    }

    saveSettings() {
        // No need to check for undefined, as appSettings is initialized to {}
        this.homey.settings.set(this.settingsKey, this.appSettings);
        this.log('Saved settings.');
    }

    // TODO add init devices on startup (i.e. reconnect and ensure that the connection is still valid) - This is a good note.

    // Helper to format error/objects for logging - these are fine.
    private static formatLogArg(arg: unknown): string {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === 'string') return arg;
        try {
            return JSON.stringify(arg);
        } catch (e) {
            return String(arg); // Fallback for unstringifiable objects
        }
    }

    private static formatLogArgs(args: unknown[]): string[] {
        return args.map(Quatt.formatLogArg);
    }

    // Consider prefixing these with `this.homey.app.manifest.id` for easier filtering in logs if many apps are installed
    trace(...args: unknown[]): void {
        console.trace(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    debug(...args: unknown[]): void {
        console.debug(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    info(...args: unknown[]): void {
        console.info(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    log(...args: unknown[]): void {
        console.log(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    warn(...args: unknown[]): void {
        console.warn(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    error(...args: unknown[]): void {
        console.error(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }

    fatal(...args: unknown[]): void {
        console.error(`[${this.homey.manifest.id}]`, ...Quatt.formatLogArgs(args));
    }
}

module.exports = Quatt;
