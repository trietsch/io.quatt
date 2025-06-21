# Quatt Homey App

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

- [Install the stable version from the Homey App Store](https://homey.app/nl-nl/app/io.quatt/Quatt/)
- [Install the test version](https://homey.app/nl-nl/app/io.quatt/Quatt/test/)

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

