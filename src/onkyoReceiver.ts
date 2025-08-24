import { OnkyoPlatform } from './onkyoPlatform.js';
import { ReceiverConfig } from './receiverConfig.js';
import { Eiscp } from './eiscp/eiscp.js';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { ReceiverInputConfig } from './receiverInputConfig.js';
import pollingtoevent from 'polling-to-event';
// @ts-expect-error need to import json
import eiscpDataAll from './eiscp/eiscp-commands.json' with { type: 'json' };
import { PLUGIN_NAME } from './settings.js';

interface CommandInputs {
  power?: string;
  volume?: string;
  input?: string;
  muting?: string;
}

interface CommandZones {
  main: CommandInputs;
  zone2: CommandInputs;
}

export class OnkyoReceiver {
  private readonly platform: OnkyoPlatform;
  private readonly eiscp: Eiscp;
  private setAttempt: number;
  private readonly receiver: ReceiverConfig;
  private readonly cmdMap: CommandZones;
  private readonly buttons: Map<number, string>;
  private state: boolean;
  private m_state: boolean;
  private v_state: number;
  private i_state: number;
  private readonly interval: number;
  private readonly avrManufacturer: string;
  private readonly avrSerial: string;
  private readonly switchHandling: string;
  private tvService?: Service;
  public accessory: PlatformAccessory;
  private infoService?: Service;
  private tvSpeakerService?: Service;
  private RxInputs;
  private reachable: boolean;
  private dimmer?: Service;
  private speed?: Service;
  private readonly inputs?: ReceiverInputConfig[];

  constructor(
    platform: OnkyoPlatform,
    receiver: ReceiverConfig,
    accessory: PlatformAccessory
  ) {
    this.platform = platform;
    this.receiver = receiver;
    this.accessory = accessory;
    this.reachable = true;
    this.inputs = this.receiver.inputs;

    this.platform.log.info(
      '**************************************************************'
    );
    this.platform.log.info(
      '  GitHub: https://github.com/jabrown93/homebridge-onkyo '
    );
    this.platform.log.info(
      '**************************************************************'
    );
    this.platform.log.info('start success...');
    this.platform.log.debug('Debug mode enabled');

    this.eiscp = platform.connections[receiver.ip_address];
    this.setAttempt = 0;

    this.platform.log.debug('name %s', this.receiver.name);
    this.platform.log.debug('IP %s', this.receiver.ip_address);
    this.platform.log.debug('Model %s', this.receiver.model);
    this.receiver.zone = (this.receiver.zone ?? 'main').toLowerCase();
    this.platform.log.debug('Zone %s', this.receiver.zone);
    this.platform.log.debug('Input Mappings %s', this.inputs);

    if (this.receiver.volume_type === undefined) {
      this.platform.log.warn(
        'WARNING: Your receiveruration is missing the parameter "volume_type". Assuming "none".'
      );
      this.receiver.volume_type = 'none';
    }

    if (this.receiver.filter_inputs === undefined) {
      this.platform.log.warn(
        'WARNING: Your receiveruration is missing the parameter "filter_inputs". Assuming "false".'
      );
      this.receiver.filter_inputs = false;
    }

    this.cmdMap = {
      main: {
        power: 'system-power',
        volume: 'master-volume',
        muting: 'audio-muting',
        input: 'input-selector',
      },
      zone2: {
        power: 'power',
        volume: 'volume',
        muting: 'muting',
        input: 'selector',
      },
    };

    this.receiver.poll_status_interval =
      this.receiver.poll_status_interval ?? '0';
    this.platform.log.debug(
      'poll_status_interval: %s',
      this.receiver.poll_status_interval
    );
    this.receiver.max_volume = this.receiver.max_volume ?? 60;
    this.platform.log.debug('max_volume: %s', this.receiver.max_volume);
    this.receiver.map_volume_100 = this.receiver.map_volume_100 ?? true;
    this.platform.log.debug('map_volume_100: %s', this.receiver.map_volume_100);
    this.buttons = new Map();
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.REWIND,
      'rew'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.FAST_FORWARD,
      'ff'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.NEXT_TRACK,
      'skip-f'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.PREVIOUS_TRACK,
      'skip-r'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.ARROW_UP,
      'up'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.ARROW_DOWN,
      'down'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.ARROW_LEFT,
      'left'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.ARROW_RIGHT,
      'right'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.SELECT,
      'enter'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.BACK,
      'exit'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.EXIT,
      'exit'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.PLAY_PAUSE,
      'play'
    );
    this.buttons.set(
      this.platform.api.hap.Characteristic.RemoteKey.INFORMATION,
      'home'
    );

    this.state = false;
    this.m_state = false;
    this.v_state = 0;
    this.i_state = 0;
    this.interval = Number.parseInt(this.receiver.poll_status_interval, 10);
    this.avrManufacturer = 'Onkyo';
    this.avrSerial = this.receiver.serial ?? this.receiver.ip_address;
    this.platform.log.debug('avrSerial: %s', this.avrSerial);
    this.switchHandling = 'check';
    if (this.interval > 10 && this.interval < 100_000) {
      this.switchHandling = 'poll';
    }

    this.eiscp.on('debug', this.eventDebug.bind(this));
    this.eiscp.on('error', this.eventError.bind(this));
    this.eiscp.on('connect', this.eventConnect.bind(this));
    this.eiscp.on('close', this.eventClose.bind(this));
    this.eiscp.on(
      this.cmdMap[this.receiver.zone].power,
      this.eventSystemPower.bind(this)
    );
    this.eiscp.on(
      this.cmdMap[this.receiver.zone].volume,
      this.eventVolume.bind(this)
    );
    this.eiscp.on(
      this.cmdMap[this.receiver.zone].muting,
      this.eventAudioMuting.bind(this)
    );
    this.eiscp.on(
      this.cmdMap[this.receiver.zone].input,
      this.eventInput.bind(this)
    );

    this.setUp();
  }

  private setUp() {
    this.createRxInput();
    this.polling();
    this.infoService = this.createAccessoryInformationService();
    this.tvService = this.createTvService();
    this.tvSpeakerService = this.createTvSpeakerService();
    this.addSources(this.tvService);
    if (this.receiver.volume_type && this.receiver.volume_type !== 'none') {
      this.platform.log.debug(
        'Creating %s service linked to TV for receiver %s',
        this.receiver.volume_type,
        this.receiver.name
      );
      this.createVolumeType(this.tvService);
    }

    this.platform.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  private createRxInput() {
    const inSets = [];
    for (const set in eiscpDataAll.modelsets) {
      eiscpDataAll.modelsets[set].forEach(model => {
        if (model.includes(this.receiver.model)) {
          this.platform.log.debug('Found modelset: %s', set);
          inSets.push(set as unknown as never);
        }
      });
    }

    // Get list of commands from eiscpData
    const eiscpData = eiscpDataAll.commands.main.SLI.values;
    // Create a JSON object for inputs from the eiscpData
    const inputs = {
      Inputs: [],
    };
    for (const exkey in eiscpData) {
      let hold = eiscpData[exkey].name.toString();
      if (hold.includes(',')) {
        hold = hold.slice(0, hold.indexOf(','));
      }
      let newExkey = exkey;
      if (exkey.includes('“') || exkey.includes('”')) {
        newExkey = newExkey.replace(/“/g, '');
        newExkey = newExkey.replace(/”/g, '');
      }

      if (
        newExkey.includes('UP') ||
        newExkey.includes('DOWN') ||
        newExkey.includes('QSTN')
      ) {
        continue;
      }

      // Work around specific bug for “26”
      if (newExkey === '“26”') {
        newExkey = '26';
      }

      if (!(newExkey in eiscpData) || !('models' in eiscpData[newExkey])) {
        continue;
      }
      const set = eiscpData[newExkey].models;

      if (inSets.includes(set as unknown as never)) {
        const input = {
          code: newExkey,
          label: hold,
        };
        inputs.Inputs.push(input as never);
      }
    }
    this.RxInputs = inputs;
  }

  /// ////////////////
  // EVENT FUNCTIONS
  /// ////////////////
  private eventDebug(response) {
    this.platform.log.debug('eventDebug: %s', response);
  }

  private eventError(response) {
    this.platform.log.error('eventError: %s', response);
  }

  private eventConnect(response) {
    this.platform.log.debug('eventConnect: %s', response);
    this.reachable = true;
  }

  private eventSystemPower(response: string) {
    if (this.state !== (response === 'on')) {
      this.platform.log.info('Event - System Power changed: %s', response);
    }

    this.state = response === 'on';
    this.platform.log.debug(
      'eventSystemPower - message: %s, new state %s',
      response,
      this.state
    );
    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Active,
      this.state
    );
  }

  private eventAudioMuting(response: string) {
    this.m_state = response === 'on';
    this.platform.log.debug(
      'eventAudioMuting - message: %s, new m_state %s',
      response,
      this.m_state
    );
    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Mute,
      this.m_state
    );
  }

  private eventInput(response) {
    if (response) {
      let input = JSON.stringify(response);
      input = input.replace(/[[\]"]+/g, '');
      if (input.includes(',')) {
        input = input.slice(0, input.indexOf(','));
      }

      // Convert to i_state input code
      const index =
        input !== null
          ? this.RxInputs.Inputs.findIndex(i => i.label === input)
          : -1;
      if (this.i_state !== index + 1) {
        this.platform.log.info('Event - Input changed: %s', input);
      }

      this.i_state = index + 1;

      this.platform.log.debug(
        'eventInput - message: %s - new i_state: %s - input: %s',
        response,
        this.i_state,
        input
      );
    } else {
      // Then invalid Input chosen
      this.platform.log.error(
        'eventInput - ERROR - INVALID INPUT - Model does not support selected input.'
      );
    }
    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.ActiveIdentifier,
      this.i_state
    );
  }

  private eventVolume(response) {
    if (this.receiver.map_volume_100) {
      const volumeMultiplier = (this.receiver.max_volume ?? 1) / 100;
      const newVolume = response / volumeMultiplier;
      this.v_state = Math.round(newVolume);
      this.platform.log.debug(
        'eventVolume - message: %s, new v_state %s PERCENT',
        response,
        this.v_state
      );
    } else {
      this.v_state = response;
      this.platform.log.debug(
        'eventVolume - message: %s, new v_state %s ACTUAL',
        response,
        this.v_state
      );
    }

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Volume,
      this.v_state
    );
  }

  eventClose(response) {
    this.platform.log.debug('eventClose: %s', response);
    this.reachable = false;
  }

  /// /////////////////////
  // GET AND SET FUNCTIONS
  /// /////////////////////
  private setPowerState(powerOn: CharacteristicValue, context: string): void {
    // if context is statuspoll, then we need to ensure that we do not set the actual value
    if (context && context === 'statuspoll') {
      this.platform.log.debug(
        'setPowerState - polling mode, ignore, state: %s',
        this.state
      );
      return;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.setAttempt++;

    this.state = powerOn as boolean;
    if (!powerOn) {
      this.platform.log.debug(
        'setPowerState - actual mode, power state: %s, switching to OFF',
        this.state
      );
      this.eiscp.command(
        this.receiver.zone +
          '.' +
          this.cmdMap[this.receiver.zone].power +
          '=standby',
        error => {
          if (error) {
            this.state = false;
            this.platform.log.error(
              'setPowerState - PWR OFF: ERROR - current state: %s',
              this.state
            );
          }
        }
      );
      this.tvService?.updateCharacteristic(
        this.platform.api.hap.Characteristic.Active,
        this.state
      );
      return;
    }
    this.platform.log.debug(
      'setPowerState - actual mode, power state: %s, switching to ON',
      this.state
    );
    this.eiscp.command(
      this.receiver.zone + '.' + this.cmdMap[this.receiver.zone].power + '=on',
      error => {
        if (error) {
          this.state = false;
          this.platform.log.error(
            'setPowerState - PWR ON: ERROR - current state: %s',
            this.state
          );
          this.tvService?.updateCharacteristic(
            this.platform.api.hap.Characteristic.Active,
            'statuspoll'
          );
          return;
        }
        // If the AVR has just been turned on, apply the default volume
        this.platform.log.debug(
          'Attempting to set the default volume to ' +
            this.receiver.default_volume
        );
        if (this.receiver.default_volume) {
          this.platform.log.info(
            'Setting default volume to ' + this.receiver.default_volume
          );
          this.eiscp.command(
            this.receiver.zone +
              '.' +
              this.cmdMap[this.receiver.zone].volume +
              ':' +
              this.receiver.default_volume,
            error => {
              if (error) {
                this.platform.log.error(
                  'Error while setting default volume: %s',
                  error
                );
              }
            }
          );
        }

        // If the AVR has just been turned on, apply the Input default
        this.platform.log.debug(
          'Attempting to set the default input selector to ' +
            this.receiver.default_input
        );

        // Handle default_input being either a custom label or manufacturer label
        let label = this.receiver.default_input;
        if (this.inputs) {
          this.inputs.forEach(input => {
            if (input.input_name === this.receiver.default_input) {
              label = input.input_name;
            } else if (input.display_name === this.receiver.default_input) {
              label = input.display_name;
            }
          });
        }

        const index =
          label !== null
            ? this.RxInputs.Inputs.findIndex(i => i.label === label)
            : -1;
        this.i_state = index + 1;

        if (powerOn && label) {
          this.platform.log.info('Setting default input selector to ' + label);
          this.eiscp.command(
            this.receiver.zone +
              '.' +
              this.cmdMap[this.receiver.zone].input +
              '=' +
              label,
            error => {
              if (error) {
                this.platform.log.error(
                  'Error while setting default input: %s',
                  error
                );
              }
            }
          );
        }
      }
    );

    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Active,
      this.state
    );
  }

  private updatePowerState() {
    this.platform.log.debug('updatePowerState - current state: %s', this.state);
    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].power +
        '=query',
      error => {
        if (error) {
          this.state = false;
          this.platform.log.debug(
            'updatePowerState - PWR QRY: ERROR - current state: %s',
            this.state
          );
        }
      }
    );
    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Active,
      this.state
    );
  }

  private polling() {
    // Status Polling
    if (this.switchHandling === 'poll') {
      this.platform.log.debug('start long poller..');
      // PWR Polling
      const statusemitter = pollingtoevent(
        done => {
          this.platform.log.debug('start PWR polling..');
          const res = this.getPowerState('statuspoll');
          done(null, res, this.setAttempt);
        },
        {
          longpolling: true,
          interval: this.interval * 1000,
          longpollEventName: 'statuspoll',
        }
      );

      statusemitter.on('statuspoll', data => {
        this.state = data;
        this.platform.log.debug(
          'event - PWR status poller - new state: ',
          this.state
        );
      });
      // Audio-Input Polling
      const i_statusemitter = pollingtoevent(
        done => {
          this.platform.log.debug('start INPUT polling..');
          const res = this.getInputSource('i_statuspoll');
          done(null, res, this.setAttempt);
        },
        {
          longpolling: true,
          interval: this.interval * 1000,
          longpollEventName: 'i_statuspoll',
        }
      );

      i_statusemitter.on('i_statuspoll', data => {
        this.i_state = data;
        this.platform.log.debug(
          'event - INPUT status poller - new i_state: ',
          this.i_state
        );
      });
      // Audio-Muting Polling
      const m_statusemitter = pollingtoevent(
        done => {
          this.platform.log.debug('start MUTE polling..');
          const res = this.getMuteState('m_statuspoll');
          done(null, res, this.setAttempt);
        },
        {
          longpolling: true,
          interval: this.interval * 1000,
          longpollEventName: 'm_statuspoll',
        }
      );

      m_statusemitter.on('m_statuspoll', data => {
        this.m_state = data;
        this.platform.log.debug(
          'event - MUTE status poller - new m_state: ',
          this.m_state
        );
      });
      // Volume Polling
      const v_statusemitter = pollingtoevent(
        done => {
          this.platform.log.debug('start VOLUME polling..');
          const res = this.getVolumeState('v_statuspoll');
          done(null, res, this.setAttempt);
        },
        {
          longpolling: true,
          interval: this.interval * 1000,
          longpollEventName: 'v_statuspoll',
        }
      );

      v_statusemitter.on('v_statuspoll', data => {
        this.v_state = data;
        this.platform.log.debug(
          'event - VOLUME status poller - new v_state: ',
          this.v_state
        );
      });
    }
  }

  private getPowerState(context) {
    // if context is statuspoll, then we need to request the actual value
    if (
      (!context || context !== 'statuspoll') &&
      this.switchHandling === 'poll'
    ) {
      this.platform.log.debug(
        'getPowerState - polling mode, return state: ',
        this.state
      );
      return this.state;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.platform.log.debug(
      'getPowerState - actual mode, return state: ',
      this.state
    );
    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].power +
        '=query',
      error => {
        if (error) {
          this.state = false;
          this.platform.log.debug(
            'getPowerState - PWR QRY: ERROR - current state: %s',
            this.state
          );
        }
      }
    );
    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Active,
      this.state
    );
    return this.state;
  }

  private getVolumeState(context) {
    // if context is v_statuspoll, then we need to request the actual value
    if (
      (!context || context !== 'v_statuspoll') &&
      this.switchHandling === 'poll'
    ) {
      this.platform.log.debug(
        'getVolumeState - polling mode, return v_state: ',
        this.v_state
      );
      return this.v_state;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.platform.log.debug(
      'getVolumeState - actual mode, return v_state: ',
      this.v_state
    );
    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].volume +
        '=query',
      error => {
        if (error) {
          this.v_state = 0;
          this.platform.log.debug(
            'getVolumeState - VOLUME QRY: ERROR - current v_state: %s',
            this.v_state
          );
        }
      }
    );

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Volume,
      this.v_state
    );

    return this.v_state;
  }

  private setVolumeState(volumeLvl, context) {
    // if context is v_statuspoll, then we need to ensure this we do not set the actual value
    if (context && context === 'v_statuspoll') {
      this.platform.log.debug(
        'setVolumeState - polling mode, ignore, v_state: %s',
        this.v_state
      );
      return;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.setAttempt++;

    // Are we mapping volume to 100%?
    if (this.receiver.map_volume_100) {
      const volumeMultiplier = this.receiver.max_volume
        ? this.receiver.max_volume / 100
        : 100;
      const newVolume = volumeMultiplier * volumeLvl;
      this.v_state = Math.round(newVolume);
      this.platform.log.debug(
        'setVolumeState - actual mode, PERCENT, volume v_state: %s',
        this.v_state
      );
    } else if (volumeLvl > (this.receiver.max_volume ?? 100)) {
      // Determine if max_volume threshold breached, if so set to max.
      this.v_state = this.receiver.max_volume ?? 100;
      this.platform.log.debug(
        'setVolumeState - VOLUME LEVEL of: %s exceeds max_volume: %s. Resetting to max.',
        volumeLvl,
        this.receiver.max_volume
      );
    } else {
      // Must be using actual volume number
      this.v_state = volumeLvl;
      this.platform.log.debug(
        'setVolumeState - actual mode, ACTUAL volume v_state: %s',
        this.v_state
      );
    }

    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].volume +
        ':' +
        this.v_state,
      error => {
        if (error) {
          this.v_state = 0;
          this.platform.log.debug(
            'setVolumeState - VOLUME : ERROR - current v_state: %s',
            this.v_state
          );
        }
      }
    );

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Volume,
      this.v_state
    );
  }

  setVolumeRelative(volumeDirection, context) {
    // if context is v_statuspoll, then we need to ensure this we do not set the actual value
    if (context && context === 'v_statuspoll') {
      this.platform.log.debug(
        'setVolumeRelative - polling mode, ignore, v_state: %s',
        this.v_state
      );
      return;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.setAttempt++;

    if (
      volumeDirection ===
      this.platform.api.hap.Characteristic.VolumeSelector.INCREMENT
    ) {
      this.platform.log.debug('setVolumeRelative - VOLUME : level-up');
      this.eiscp.command(
        this.receiver.zone +
          '.' +
          this.cmdMap[this.receiver.zone].volume +
          ':level-up',
        error => {
          if (error) {
            this.v_state = 0;
            this.platform.log.error(
              'setVolumeRelative - VOLUME : ERROR - current v_state: %s',
              this.v_state
            );
          }
        }
      );
    } else if (
      volumeDirection ===
      this.platform.api.hap.Characteristic.VolumeSelector.DECREMENT
    ) {
      this.platform.log.debug('setVolumeRelative - VOLUME : level-down');
      this.eiscp.command(
        this.receiver.zone +
          '.' +
          this.cmdMap[this.receiver.zone].volume +
          ':level-down',
        error => {
          if (error) {
            this.v_state = 0;
            this.platform.log.error(
              'setVolumeRelative - VOLUME : ERROR - current v_state: %s',
              this.v_state
            );
          }
        }
      );
    } else {
      this.platform.log.error(
        'setVolumeRelative - VOLUME : ERROR - unknown direction sent'
      );
    }

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Volume,
      this.v_state
    );
  }

  private getMuteState(context) {
    // if context is m_statuspoll, then we need to request the actual value
    if (
      (!context || context !== 'm_statuspoll') &&
      this.switchHandling === 'poll'
    ) {
      this.platform.log.debug(
        'getMuteState - polling mode, return m_state: ',
        this.m_state
      );
      return this.m_state;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.platform.log.debug(
      'getMuteState - actual mode, return m_state: ',
      this.m_state
    );
    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].muting +
        '=query',
      error => {
        if (error) {
          this.m_state = false;
          this.platform.log.debug(
            'getMuteState - MUTE QRY: ERROR - current m_state: %s',
            this.m_state
          );
        }
      }
    );

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Mute,
      this.m_state
    );

    return this.m_state;
  }

  private setMuteState(muteOn: CharacteristicValue, context: string) {
    // if context is m_statuspoll, then we need to ensure this we do not set the actual value
    if (context && context === 'm_statuspoll') {
      this.platform.log.debug(
        'setMuteState - polling mode, ignore, m_state: %s',
        this.m_state
      );
      return this.m_state;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.setAttempt++;

    this.m_state = muteOn as boolean;
    if (this.m_state) {
      this.platform.log.debug(
        'setMuteState - actual mode, mute m_state: %s, switching to ON',
        this.m_state
      );
      this.eiscp.command(
        this.receiver.zone +
          '.' +
          this.cmdMap[this.receiver.zone].muting +
          '=on',
        error => {
          if (error) {
            this.m_state = false;
            this.platform.log.error(
              'setMuteState - MUTE ON: ERROR - current m_state: %s',
              this.m_state
            );
          }
        }
      );
    } else {
      this.platform.log.debug(
        'setMuteState - actual mode, mute m_state: %s, switching to OFF',
        this.m_state
      );
      this.eiscp.command(
        this.receiver.zone +
          '.' +
          this.cmdMap[this.receiver.zone].muting +
          '=off',
        error => {
          if (error) {
            this.m_state = false;
            this.platform.log.error(
              'setMuteState - MUTE OFF: ERROR - current m_state: %s',
              this.m_state
            );
          }
        }
      );
    }

    this.tvSpeakerService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.Mute,
      this.m_state
    );
    return this.m_state;
  }

  private getInputSource(context: string) {
    // if context is i_statuspoll, then we need to request the actual value
    if (
      (!context || context !== 'i_statuspoll') &&
      this.switchHandling === 'poll'
    ) {
      this.platform.log.debug(
        'getInputState - polling mode, return i_state: ',
        this.i_state
      );
      return this.i_state;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.platform.log.debug(
      'getInputState - actual mode, return i_state: ',
      this.i_state
    );
    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].input +
        '=query',
      error => {
        if (error) {
          this.i_state = 1;
          this.platform.log.error(
            'getInputState - INPUT QRY: ERROR - current i_state: %s',
            this.i_state
          );
        }
      }
    );

    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.ActiveIdentifier,
      this.i_state
    );

    return this.i_state;
  }

  setInputSource(source, context) {
    // if context is i_statuspoll, then we need to ensure this we do not set the actual value
    if (context && context === 'i_statuspoll') {
      this.platform.log.info(
        'setInputState - polling mode, ignore, i_state: %s',
        this.i_state
      );
      return;
    }

    if (!this.receiver.ip_address) {
      this.platform.log.error('Ignoring request; No ip_address defined.');
      throw new Error('No ip_address defined.');
    }

    this.setAttempt++;

    this.i_state = source;
    const label = this.RxInputs.Inputs[this.i_state - 1].label;

    this.platform.log.debug(
      'setInputState - actual mode, ACTUAL input i_state: %s - label: %s',
      this.i_state,
      label
    );

    this.eiscp.command(
      this.receiver.zone +
        '.' +
        this.cmdMap[this.receiver.zone].input +
        ':' +
        label,
      error => {
        if (error) {
          this.platform.log.error(
            'setInputState - INPUT : ERROR - current i_state:%s - Source:%s',
            this.i_state,
            source.toString()
          );
        }
      }
    );

    this.tvService?.updateCharacteristic(
      this.platform.api.hap.Characteristic.ActiveIdentifier,
      this.i_state
    );
  }

  remoteKeyPress(button) {
    if (this.buttons.get(button)) {
      const press = this.buttons.get(button);
      this.platform.log.debug('remoteKeyPress - INPUT: pressing key %s', press);
      this.eiscp.command(this.receiver.zone + '.setup=' + press, error => {
        if (error) {
          this.i_state = 1;
          this.platform.log.error(
            'remoteKeyPress - INPUT: ERROR pressing button %s',
            press
          );
        }
      });
    } else {
      this.platform.log.error('Remote button %d not supported.', button);
    }
  }

  identify(callback) {
    this.platform.log.info('Identify requested! %s', this.receiver.ip_address);
    callback(); // success
  }

  /// /////////////////////
  // TV SERVICE FUNCTIONS
  /// /////////////////////
  addSources(service) {
    // If input name mappings are provided, use them.
    // Option to only receiver specified inputs with filter_inputs
    this.platform.log.debug('Supported inputs', this.RxInputs.Inputs);
    if (this.receiver.filter_inputs && this.inputs) {
      // Check the RxInputs.Inputs items to see if each exists in this.inputs. Return new array of those that do.
      this.RxInputs.Inputs = this.RxInputs.Inputs.filter(rxinput => {
        return this.inputs?.some(input => {
          return input.input_name === rxinput.label;
        });
      });
    }

    this.platform.log.debug(this.RxInputs.Inputs);
    // Create final array of inputs, using any labels defined in the receiver's inputs to override the default labels
    return this.RxInputs.Inputs.map((i, index: number) => {
      const hapId = index + 1;
      let inputName = i.label;
      if (this.inputs) {
        this.inputs.forEach(input => {
          if (input.input_name === i.label) {
            this.platform.log.debug(
              'Found input mapping for %s to %s ',
              i.label,
              input.display_name
            );
            inputName = input.display_name;
          }
        });
      }

      return this.setupInput(i.code, inputName, hapId, service);
    });
  }

  setupInput(inputCode, name: string, hapId: number, television: Service) {
    const normalizedName = name.replace('-', ' ');
    const input = this.accessory.addService(
      this.platform.api.hap.Service.InputSource,
      `${this.receiver.name} ${normalizedName}`,
      inputCode
    );
    const inputSourceType =
      this.platform.api.hap.Characteristic.InputSourceType.HDMI;

    input
      .setCharacteristic(this.platform.api.hap.Characteristic.Identifier, hapId)
      .setCharacteristic(
        this.platform.api.hap.Characteristic.ConfiguredName,
        normalizedName
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.IsConfigured,
        this.platform.api.hap.Characteristic.IsConfigured.CONFIGURED
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.InputSourceType,
        inputSourceType
      );

    input
      .getCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName)
      .setProps({
        perms: [this.platform.api.hap.Perms.PAIRED_READ],
      });

    television.addLinkedService(input);
    return input;
  }

  private createAccessoryInformationService() {
    const informationService =
      this.accessory.getService(
        this.platform.api.hap.Service.AccessoryInformation
      ) ??
      this.accessory.addService(
        this.platform.api.hap.Service.AccessoryInformation
      );

    informationService
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Manufacturer,
        this.avrManufacturer
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Model,
        this.receiver.model
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.avrSerial
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.FirmwareRevision,
        'info.version'
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Name,
        this.receiver.name
      );

    return informationService;
  }

  createVolumeType(service) {
    if (this.receiver.volume_type === 'dimmer') {
      this.dimmer = this.accessory.addService(
        this.platform.api.hap.Service.Lightbulb,
        this.receiver.name + ' Volume',
        'dimmer'
      );
      this.dimmer
        .getCharacteristic(this.platform.api.hap.Characteristic.On)
        // Inverted logic taken from https://github.com/langovoi/homebridge-upnp
        .onGet(() => {
          return !this.getMuteState(null);
        })
        .onSet(value => this.setMuteState(!value, ''));
      this.dimmer
        .addCharacteristic(this.platform.api.hap.Characteristic.Brightness)
        .onGet(this.getVolumeState.bind(this))
        .onSet(this.setVolumeState.bind(this));

      service.addLinkedService(this.dimmer);
    } else if (this.receiver.volume_type === 'speed') {
      this.speed = this.accessory.addService(
        this.platform.api.hap.Service.Fan,
        this.receiver.name + ' Volume',
        'speed'
      );
      this.speed
        .getCharacteristic(this.platform.api.hap.Characteristic.On)
        // Inverted logic taken from https://github.com/langovoi/homebridge-upnp
        .onGet(context => {
          return !this.getMuteState(context);
        })
        .onSet((value, context) => this.setMuteState(!value, context));
      this.speed
        .addCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed)
        .onGet(this.getVolumeState.bind(this))
        .onSet(this.setVolumeState.bind(this));

      service.addLinkedService(this.speed);
    }
  }

  createTvService() {
    this.platform.log.debug(
      'Creating TV service for receiver %s',
      this.receiver.name
    );
    const tvService =
      this.accessory.getService(this.platform.api.hap.Service.Television) ??
      this.accessory.addService(
        this.platform.api.hap.Service.Television,
        this.receiver.name
      );

    tvService
      .getCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName)
      .setValue(this.receiver.name)
      .setProps({
        perms: [this.platform.api.hap.Perms.PAIRED_READ],
      });

    tvService.setCharacteristic(
      this.platform.api.hap.Characteristic.SleepDiscoveryMode,
      this.platform.api.hap.Characteristic.SleepDiscoveryMode
        .ALWAYS_DISCOVERABLE
    );

    tvService
      .getCharacteristic(this.platform.api.hap.Characteristic.Active)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.setPowerState.bind(this));

    tvService
      .getCharacteristic(this.platform.api.hap.Characteristic.ActiveIdentifier)
      .onSet(this.setInputSource.bind(this))
      .onGet(this.getInputSource.bind(this));

    tvService
      .getCharacteristic(this.platform.api.hap.Characteristic.RemoteKey)
      .onSet(this.remoteKeyPress.bind(this));

    return tvService;
  }

  createTvSpeakerService() {
    this.platform.log.debug(
      'Creating TV Speaker service for receiver `%s`',
      this.receiver.name
    );
    const tvSpeakerService =
      this.accessory.getService(
        this.platform.api.hap.Service.TelevisionSpeaker
      ) ??
      this.accessory.addService(
        this.platform.api.hap.Service.TelevisionSpeaker,
        this.receiver.name + ' Volume',
        'tvSpeakerService'
      );
    tvSpeakerService
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Active,
        this.platform.api.hap.Characteristic.Active.ACTIVE
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.VolumeControlType,
        this.platform.api.hap.Characteristic.VolumeControlType.ABSOLUTE
      );
    tvSpeakerService
      .getCharacteristic(this.platform.api.hap.Characteristic.VolumeSelector)
      .onSet(this.setVolumeRelative.bind(this));
    tvSpeakerService
      .getCharacteristic(this.platform.api.hap.Characteristic.Mute)
      .onGet(this.getMuteState.bind(this))
      .onSet(this.setMuteState.bind(this));
    tvSpeakerService
      .addCharacteristic(this.platform.api.hap.Characteristic.Volume)
      .onGet(this.getVolumeState.bind(this))
      .onSet(this.setVolumeState.bind(this));

    this.tvService?.addLinkedService(tvSpeakerService);
    return tvSpeakerService;
  }
}
