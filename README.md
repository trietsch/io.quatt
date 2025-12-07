# Quatt Homey App

> **Note:** This is an actively maintained fork of the [original Quatt Homey app](https://github.com/trietsch/io.quatt). The original maintainer appears to be inactive, so this fork continues development with new features and bug fixes.
>
> **This app is not yet available in the Homey App Store.** See [Installation](#installation) for how to install it manually.

Integrate your Quatt heat pump with Homey for monitoring, automation, and energy tracking. This app reads data from the Quatt Commander-In-Chief (CiC) and exposes it as Homey capabilities.

## Features

- **Real-time monitoring** of heat pump, boiler, and thermostat data
- **Homey Energy tab integration** - track power consumption (W) and energy usage (kWh)
- **Quatt Duo support** - works with single and dual heat pump setups
- **Flow triggers & conditions** - automate based on heating status, temperatures, COP, and more
- **Remote control via Quatt Cloud** - control sound levels and pricing limits (requires pairing)
- **Automatic device discovery** - finds your Quatt CiC on the local network

## Energy Tracking

The app integrates with Homey's Energy tab, allowing you to:
- See real-time power consumption on the device tile
- Track cumulative energy usage (kWh) over time
- Monitor your heat pump's energy consumption alongside other devices

> **Note:** Energy data starts accumulating from when the device is added. The Quatt API provides real-time power readings; historical data is not available.

## Available Sensors

### Heat Pump
- Power consumption (W)
- Thermal power output
- COP (Coefficient of Performance)
- Working mode
- Outside temperature
- Incoming/outgoing water temperature
- Water temperature difference (computed)
- Silent mode status
- Limited by COP status

### Boiler
- Central heating mode
- Flame on/off
- Hot water active
- Incoming/outgoing water temperature
- Water pressure

### Thermostat
- Room temperature
- Room temperature setpoint
- Heating/cooling active
- Hot water demand
- Water supply temperature setpoint

### Flow Meter
- Water flow speed
- Water supply temperature

## Installation

### Prerequisites

Install the [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started):

```bash
npm install -g homey
homey login
```

### Install from Source

```bash
# Clone the repository
git clone https://github.com/WebBuildsNL/io.quatt.git
cd io.quatt

# Install dependencies
npm install

# Build and install on your Homey
homey app install
```

To update to a newer version, pull the latest changes and reinstall:

```bash
git pull
homey app install
```

### Uninstall

```bash
homey app uninstall
```

## Remote Control (Optional)

The app supports remote control of your Quatt via the Quatt Cloud Mobile API. This enables Flow action cards for:
- Setting day/night sound levels
- Setting pricing limits

To enable remote control:
1. Go to the device settings in Homey
2. Select "Repair Device"
3. Follow the pairing flow (requires pressing the CiC button)

## Configuration

### Device Settings

- **IP Address Override** - Manually set the Quatt CiC IP address if auto-discovery doesn't work
- **Update Interval** - How often to poll for data (1-60 seconds, default: 5)

## Community & Support

- [Dutch forum thread](https://community.homey.app/t/app-pro-quatt-nl/91802)
- [English forum thread](https://community.homey.app/t/app-pro-quatt/91446)
- [GitHub Issues](https://github.com/WebBuildsNL/io.quatt/issues)

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

### Local Development

```bash
npm install      # Install dependencies
npm test         # Run tests
homey app run    # Run with live logs
```

## Credits

- Original app by [@trietsch](https://github.com/trietsch)
- Nice PR's on the original repository [@jvmenen](https://github.com/jvmenen)
- Continued development by [Dennis](https://github.com/cannonb4ll)

## License

This project is licensed under the MIT License.
