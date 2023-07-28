# Quatt CIC network discovery

As the Quatt CIC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
The list of MAC addresses is based on the fact that my own Quatt CIC MAC address is identified as Sunplus Technology Co., Ltd.

A list of other MAC address ranges for Sunplus can be found [here](https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd).
These ranges have been added to the discovery of the CIC. Please create an issue if there are false positives.
