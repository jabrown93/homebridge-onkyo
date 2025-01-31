# homebridge-onkyo

[![npm](https://img.shields.io/npm/dt/homebridge-onkyo.svg)](https://www.npmjs.com/package/homebridge-onkyo)
[![npm](https://img.shields.io/npm/l/homebridge-onkyo.svg)](https://github.com/jabrown93/homebridge-onkyo/blob/master/LICENSE)

[![NPM Version](https://img.shields.io/npm/v/homebridge-onkyo.svg)](https://www.npmjs.com/package/homebridge-onkyo)
![Node.js CI](https://github.com/jabrown93/homebridge-onkyo/workflows/Node.js%20CI/badge.svg?branch=master)
![CodeQL](https://github.com/jabrown93/homebridge-onkyo/workflows/CodeQL/badge.svg)

Homebridge plugin for Onkyo Receivers
Should work for all supported models as listed in the eiscp/eiscp-commands.json file. If your model is not listed, try TX-NR609.

# Description

This is an enhanced fork from the original/unmaintained homebridge-onkyo-avr plugin written by gw-wiscon.
Existing users of my original fork or gw-wiscon's be sure to update the "platform" config to "Onkyo".

# Changelog

Changes are tracked via [Github Releases](https://github.com/jabrown93/homebridge-onkyo/releases).

# Volume Control

For Siri Control of Volume, Mute, and Input - Use an app like EVE which has control sliders and create scenes for "Volume Mute" or "Volume Unmute", and/or various volume level scenes like "Volume Low" or "Volume Loud", or for inputs like "input network" or "input fm". It may be easiest to set the volume or Input first using the OnkyoRemote3 app and then creating the scenes so the volume or input is pre-set (without using the slider).

For Alexa Control of Volume, Mute, Input - (if using the Alexa plugin) - create DummySwitches (homebridge-dummy) and setup an automation to run the scene created from above. "Alexa, turn on Volume Loud."

# Installation

As a prerequisite ensure that the Onkyo receiver is controllable using the OnkyoRemote3 iOS app.

It is recommended to install and configure this plugin using [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x#readme), however you can also install manually using the following manual tasks:

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-onkyo
3. Update your configuration file. See the sample below.

# Configuration

Example accessory config (needs to be added to the homebridge config.json):

```
"platforms": [{
       "platform": "Onkyo",
       "receivers": [
           {
               "model": "TX-NR609",
               "ip_address": "10.0.0.46",
               "poll_status_interval": "3000",
               "name": "ReceiverConfig",
               "zone": "main",
               "default_input": "net",
               "default_volume": "10",
               "max_volume": "40",
               "map_volume_100": false,
               "inputs": [
                   {"input_name": "dvd", "display_name": "Blu-ray"},
                   {"input_name": "video2", "display_name": "Switch"},
                   {"input_name": "video3", "display_name": "Wii U"},
                   {"input_name": "video6", "display_name": "Apple TV"},
                   {"input_name": "video4", "display_name": "AUX"},
                   {"input_name": "cd", "display_name": "TV/CD"}
               ],
               "volume_dimmer": false,
               "volume_speed": true,
               "switch_service": false,
               "filter_inputs": true
           }
       ]
   }]
```

### Config Explanation:

| Field                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **platform**                 | (required) Must always be "Onkyo".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **receivers**                | (required) List of receiver accessories to create. Must contain at least 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ReceiverConfig Attributes    |
| ---------------------------- | ------------                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **name**                     | (required) The name you want to use for control of the Onkyo accessories.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **ip_address**               | (required) The internal ip address of your Onkyo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **model**                    | (required) Must be a valid model listed in config.schema.json file. If your model is not listed, you can use the TX-NR609 if your model supports the Integra Serial Communication Protocol (ISCP).                                                                                                                                                                                                                                                                                                                                                    |
| **poll_status_interval**     | (optional) Poll Status Interval. Defaults to 0 or no polling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **default_input**            | (optional) A valid source input. Default will use last known input. See output of 3.ts in eiscp/examples for options.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **default_volume**           | (optional) Initial receiver volume upon powerup. This is the true volume number, not a percentage. Ignored if powerup from device knob or external app (like OnkyoRemote3).                                                                                                                                                                                                                                                                                                                                                                           |
| **max_volume**               | (optional) ReceiverConfig volume max setting. This is a true volume number, not a percentage, and intended so there is not accidental setting of volume to 80. Ignored by external apps (like OnkyoRemote3). Defaults to 30.                                                                                                                                                                                                                                                                                                                          |
| **map_volume_100**           | (optional) Will remap the volume percentages that appear in the Home app so that the configured max_volume will appear as 100% in the Home app. For example, if the max_volume is 30, then setting the volume slider to 50% would set the receiver's actual volume to 15. Adjusting the stereo volume knob to 35 will appear as 100% in the Home app. This option could confuse some users to it defaults to off false, but it does give the user finer volume control especially when sliding volume up and down in the Home app. Defaults to False. |
| **zone**                     | (optional) Defaults to main. Optionally control zone2 where supported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **inputs**                   | (optional) List of inputs you want populated for the TV service and what you want them to be displayed as.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **filter_inputs**            | (optional) Boolean value. Setting this to `true` limits inputs displayed in HomeKit to those you provide in `inputs`. If `false` or not defined, all inputs supported by `model` will be displayed.                                                                                                                                                                                                                                                                                                                                                   |
| **volume_dimmer**            | (optional) Boolean value. Setting this to `false` disables additional Dimmer accessory for separate volume control.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

# Troubleshooting

For Troubleshooting look in the homebridge-onkyo/node_modules/eiscp/examples directory and see if you can run 3.ts. "node 3.ts". It should output all available commands.

You can find the output also in the [wiki](https://github.com/jabrown93/homebridge-onkyo/wiki/EISCP-output-of-3.js).

# EISCP Dependency

This plugin depends on an EISCP library. As the needed package does not reside on NPM installation of this dependency caused various problems. As a workaround, the library was copied into this project in the eiscp folder. As the library was not updated for years it is unlikely that this project misses updates on the library.
Please note that the EISCP library is not covered under the license of of homebridge-onkyo and comes with its own license in the EISCP folder.
The original Github repository is [untitledlt / eiscp.ts](https://github.com/untitledlt/eiscp.js).
