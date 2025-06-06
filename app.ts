import Homey from 'homey';



class Quatt extends Homey.App {
    private settingsKey = `${this.homey.manifest.id}.settings`;

    private settingsExist: boolean = false;
    private appSettings: any = {};

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

            this.log(`initSettings - Initializing ${this.settingsKey} with defaults`);
            this.updateSettings({
                ipAddress: '',
            });

            return true;
        } catch (err) {
            this.error(err);
        }
    }

    updateSettings(settings: any) {
        this.debug('updateSettings - New settings:', { ...settings });

        this.appSettings = settings;
        this.saveSettings();
    }

    saveSettings() {
        if (typeof this.appSettings === 'undefined') {
            this.log('Not saving settings; settings empty!');
            return;
        }

        this.homey.settings.set(this.settingsKey, this.appSettings);
        this.log('Saved settings.');
    }

    // TODO add init devices on startup (i.e. reconnect and ensure that the connection is still valid)

    // Helper to format error/objects for logging
    private static formatLogArg(arg: any): string {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === 'string') return arg;
        return JSON.stringify(arg);
    }

    private static formatLogArgs(args: any[]): any[] {
        return args.map(Quatt.formatLogArg);
    }

    trace(...args: any[]): void {
        console.trace('[log]', ...Quatt.formatLogArgs(args));
    }

    debug(...args: any[]): void {
        console.debug('[debug]', ...Quatt.formatLogArgs(args));
    }

    info(...args: any[]): void {
        console.log('[info]', ...Quatt.formatLogArgs(args));
    }

    log(...args: any[]): void {
        console.log('[log]', ...Quatt.formatLogArgs(args));
    }

    warn(...args: any[]): void {
        console.warn('[warn]', ...Quatt.formatLogArgs(args));
    }

    error(...args: any[]): void {
        console.error('[error]', ...Quatt.formatLogArgs(args));
    }

    fatal(...args: any[]): void {
        console.error('[fatal]', ...Quatt.formatLogArgs(args));
    }

}

module.exports = Quatt;
