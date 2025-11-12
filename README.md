# Quatt Homey App

> [!NOTE]
> This repository is a fork of the original Quatt Homey app. Due to potential inactivity of the original maintainer, this fork was created to continue active development and maintenance of the app.

Adds support for reading Quatt Commander-In-Chief (CiC) data and integrating your Quatt heat pump with Homey. This app exposes a wide range of sensor data and control capabilities for advanced automation and monitoring.

## Features
- Real-time monitoring of Quatt heat pump and boiler data
- Exposes all relevant sensor values as Homey capabilities
- Supports Quatt Duo (multiple heat pumps)
- Enables advanced Homey Flows based on heat pump and boiler status
- Computed values such as COP and water temperature difference

## Available Sensor Values
- Central heating mode (boiler)
- Central heating active (cic)
- Central heating on/off (cic)
- Hot water active (boiler)
- Boiler flame on
- Boiler incoming water temperature
- Boiler outgoing water temperature
- Water flow speed (flowmeter)
- Water supply temperature (flowmeter)
- Supervisory control mode (quality control)
- Outside temperature (heatpump)
- Limited by COP (heatpump)
- Silent mode (heatpump)
- Heatpump incoming water temperature
- Heatpump outgoing water temperature
- Heatpump working mode
- Thermal power (heatpump)
- Power consumption (heatpump)
- Thermostat heating on
- Thermostat cooling on
- Thermostat hot water on
- Room temperature (thermostat)
- Room temperature setpoint (thermostat)
- Water supply temperature setpoint (thermostat)

Computed sensor values:
- Heatpump COP
- Heatpump water temperature difference

## Installation

- [Install the stable version from the Homey App Store](https://homey.app/a/io.quatt/)
- [Install the test version](https://homey.app/a/io.quatt/test/)

### Install via Homey CLI

For development or testing purposes, you can install the app directly to your Homey using the Homey CLI:

1. Install the Homey CLI globally:
   ```bash
   npm install -g homey
   ```

2. Login to your Homey account:
   ```bash
   homey login
   ```

3. Clone this repository:
   ```bash
   git clone https://github.com/WebBuildsNL/io.quatt.git
   cd io.quatt
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Install the app on your Homey:
   ```bash
   homey app install
   ```

**Note:** Apps installed via CLI will appear in your Homey apps list. Use `homey app uninstall` to remove them.

## Community & Support
- [Dutch forum thread](https://community.homey.app/t/app-pro-quatt-nl/91802)
- [English forum thread](https://community.homey.app/t/app-pro-quatt/91446)

## Development

This repository contains the source code for the Quatt Homey app. Contributions, bug reports, and feature requests are welcome via GitHub issues or pull requests.

### Local Development
- Clone this repository
- Install dependencies: `npm install`
- Test: `npm test`

## License

This project is licensed under the MIT License.

