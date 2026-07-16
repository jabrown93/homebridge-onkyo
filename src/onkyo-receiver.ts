import {type CharacteristicValue, type PlatformAccessory, type Service} from 'homebridge';
import pollingtoevent from 'polling-to-event';
import {type OnkyoPlatform} from './onkyo-platform.js';
import {type ReceiverConfig} from './receiver-config.js';
import {type Eiscp} from './eiscp/eiscp.js';
import {type ReceiverInputConfig} from './receiver-input-config.js';
import eiscpCommandsData from './eiscp/eiscp-commands-data.js';
import {PLUGIN_NAME} from './settings.js';

type RxInput = {
	'code': string;
	'label': string;
};

type CommandInputs = {
	'power': string;
	'volume': string;
	'input': string;
	'muting': string;
};

type CommandZones = {
	[zone: string]: CommandInputs;
	'main': CommandInputs;
	'zone2': CommandInputs;
};

export class OnkyoReceiver {
	private readonly platform: OnkyoPlatform;
	private readonly eiscp: Eiscp;
	private attemptCount: number;
	private readonly receiver: ReceiverConfig;
	private readonly cmdMap: CommandZones;
	private readonly buttons: Map<number, string>;
	private state: boolean;
	private mState: boolean;
	private vState: number;
	private iState: number;
	private readonly interval: number;
	private readonly avrManufacturer: string;
	private readonly avrSerial: string;
	private readonly switchHandling: string;
	private tvService?: Service;
	private tvSpeakerService?: Service;
	private rxInputs!: {'inputs': RxInput[]};
	private dimmer?: Service;
	private speed?: Service;
	private readonly inputs?: ReceiverInputConfig[];
	public accessory: PlatformAccessory;

	constructor(
		platform: OnkyoPlatform,
		receiver: ReceiverConfig,
		accessory: PlatformAccessory,
	) {
		this.platform = platform;
		this.receiver = receiver;
		this.accessory = accessory;
		this.inputs = this.receiver.inputs;

		this.platform.log.info('**************************************************************');
		this.platform.log.info('  GitHub: https://github.com/jabrown93/homebridge-onkyo ');
		this.platform.log.info('**************************************************************');
		this.platform.log.info('start success...');
		this.platform.log.debug('Debug mode enabled');

		this.eiscp = platform.connections[receiver.ip_address];
		this.attemptCount = 0;

		this.platform.log.debug('name %s', this.receiver.name);
		this.platform.log.debug('IP %s', this.receiver.ip_address);
		this.platform.log.debug('Model %s', this.receiver.model);
		this.receiver.zone = (this.receiver.zone ?? 'main').toLowerCase();
		this.platform.log.debug('Zone %s', this.receiver.zone);
		this.platform.log.debug('Input Mappings %s', this.inputs);

		if (this.receiver.volume_type === undefined) {
			this.platform.log.warn('WARNING: Your receiveruration is missing the parameter "volume_type". Assuming "none".');
			this.receiver.volume_type = 'none';
		}

		if (this.receiver.filter_inputs === undefined) {
			this.platform.log.warn('WARNING: Your receiveruration is missing the parameter "filter_inputs". Assuming "false".');
			this.receiver.filter_inputs = false;
		}

		this.cmdMap = {
			'main': {
				'power': 'system-power',
				'volume': 'master-volume',
				'muting': 'audio-muting',
				'input': 'input-selector',
			},
			'zone2': {
				'power': 'power',
				'volume': 'volume',
				'muting': 'muting',
				'input': 'selector',
			},
		};

		this.receiver.poll_status_interval ??= '0';
		this.platform.log.debug(
			'poll_status_interval: %s',
			this.receiver.poll_status_interval,
		);
		this.receiver.max_volume ??= 60;
		this.platform.log.debug('max_volume: %s', this.receiver.max_volume);
		this.receiver.map_volume_100 ??= true;
		this.platform.log.debug('map_volume_100: %s', this.receiver.map_volume_100);
		this.buttons = new Map();
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.REWIND,
			'rew',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.FAST_FORWARD,
			'ff',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.NEXT_TRACK,
			'skip-f',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.PREVIOUS_TRACK,
			'skip-r',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.ARROW_UP,
			'up',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.ARROW_DOWN,
			'down',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.ARROW_LEFT,
			'left',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.ARROW_RIGHT,
			'right',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.SELECT,
			'enter',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.BACK,
			'exit',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.EXIT,
			'exit',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.PLAY_PAUSE,
			'play',
		);
		this.buttons.set(
			this.platform.api.hap.Characteristic.RemoteKey.INFORMATION,
			'home',
		);

		this.state = false;
		this.mState = false;
		this.vState = 0;
		this.iState = 0;
		this.interval = Number(this.receiver.poll_status_interval);
		this.avrManufacturer = 'Onkyo';
		this.avrSerial = this.receiver.serial ?? this.receiver.ip_address;
		this.platform.log.debug('avrSerial: %s', this.avrSerial);
		this.switchHandling = 'check';
		if (this.interval > 10 && this.interval < 100_000)
			this.switchHandling = 'poll';

		this.eiscp.on('debug', this.eventDebug.bind(this));
		this.eiscp.on('error', this.eventError.bind(this));
		this.eiscp.on('connect', this.eventConnect.bind(this));
		this.eiscp.on('close', this.eventClose.bind(this));
		this.eiscp.on(
			this.cmdMap[this.receiver.zone].power,
			this.eventSystemPower.bind(this),
		);
		this.eiscp.on(
			this.cmdMap[this.receiver.zone].volume,
			this.eventVolume.bind(this),
		);
		this.eiscp.on(
			this.cmdMap[this.receiver.zone].muting,
			this.eventAudioMuting.bind(this),
		);
		this.eiscp.on(
			this.cmdMap[this.receiver.zone].input,
			this.eventInput.bind(this),
		);

		this.setUp();
	}

	private setUp() {
		this.createRxInput();
		this.polling();
		this.createAccessoryInformationService();
		this.tvService = this.createTvService();
		this.tvSpeakerService = this.createTvSpeakerService();
		this.addSources(this.tvService);
		if (this.receiver.volume_type !== undefined && this.receiver.volume_type !== '' && this.receiver.volume_type !== 'none') {
			this.platform.log.debug(
				'Creating %s service linked to TV for receiver %s',
				this.receiver.volume_type,
				this.receiver.name,
			);
			this.createVolumeType(this.tvService);
		}

		this.platform.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
	}

	private createRxInput() {
		const data = eiscpCommandsData;
		const inSets: string[] = [];
		for (const set in data.modelsets) {
			if (!Object.hasOwn(data.modelsets, set))
				continue;

			if (data.modelsets[set].some(model => model.includes(this.receiver.model))) {
				this.platform.log.debug('Found modelset: %s', set);
				inSets.push(set);
			}
		}

		// Get list of commands from eiscpData
		const eiscpData = data.commands.main.SLI.values;
		// Create a JSON object for inputs from the eiscpData
		const inputs: {'inputs': RxInput[]} = {
			'inputs': [],
		};
		for (const exkey in eiscpData) {
			if (!Object.hasOwn(eiscpData, exkey))
				continue;

			const name = eiscpData[exkey].name;
			if (name === undefined)
				continue;

			let hold = name.toString();
			if (hold.includes(','))
				hold = hold.slice(0, hold.indexOf(','));

			let newExkey = exkey;
			if (exkey.includes('“') || exkey.includes('”')) {
				newExkey = newExkey.replaceAll('“', '');
				newExkey = newExkey.replaceAll('”', '');
			}

			if (
				newExkey.includes('UP')
				|| newExkey.includes('DOWN')
				|| newExkey.includes('QSTN')
			)
				continue;

			// Work around specific bug for “26”
			if (newExkey === '“26”')
				newExkey = '26';

			if (!Object.hasOwn(eiscpData, newExkey) || !Object.hasOwn(eiscpData[newExkey], 'models'))
				continue;

			const set = eiscpData[newExkey].models;

			if (inSets.includes(set)) {
				const input: RxInput = {
					'code': newExkey,
					'label': hold,
				};
				inputs.inputs.push(input);
			}
		}

		this.rxInputs = inputs;
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
	}

	private eventSystemPower(response: string) {
		if (this.state !== (response === 'on'))
			this.platform.log.info('Event - System Power changed: %s', response);

		this.state = response === 'on';
		this.platform.log.debug(
			'eventSystemPower - message: %s, new state %s',
			response,
			this.state,
		);
		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Active,
			this.state,
		);
	}

	private eventAudioMuting(response: string) {
		this.mState = response === 'on';
		this.platform.log.debug(
			'eventAudioMuting - message: %s, new mState %s',
			response,
			this.mState,
		);
		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Mute,
			this.mState,
		);
	}

	private eventInput(response: string | string[] | undefined) {
		if (response === undefined) {
			// Then invalid Input chosen
			this.platform.log.error('eventInput - ERROR - INVALID INPUT - Model does not support selected input.');
		} else {
			let input = JSON.stringify(response);
			input = input.replaceAll(/["\[\]]+/gv, '');
			if (input.includes(','))
				input = input.slice(0, input.indexOf(','));

			// Convert to iState input code
			const index =
				input === null
					? -1
					: this.rxInputs.inputs.findIndex(i => i.label === input);
			if (this.iState !== index + 1)
				this.platform.log.info('Event - Input changed: %s', input);

			this.iState = index + 1;

			this.platform.log.debug(
				'eventInput - message: %s - new iState: %s - input: %s',
				response,
				this.iState,
				input,
			);
		}

		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.ActiveIdentifier,
			this.iState,
		);
	}

	private eventVolume(response: number) {
		if (this.receiver.map_volume_100) {
			const volumeMultiplier = (this.receiver.max_volume ?? 1) / 100;
			const newVolume = response / volumeMultiplier;
			this.vState = Math.round(newVolume);
			this.platform.log.debug(
				'eventVolume - message: %s, new vState %s PERCENT',
				response,
				this.vState,
			);
		} else {
			this.vState = response;
			this.platform.log.debug(
				'eventVolume - message: %s, new vState %s ACTUAL',
				response,
				this.vState,
			);
		}

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Volume,
			this.vState,
		);
	}

	private eventClose(response) {
		this.platform.log.debug('eventClose: %s', response);
	}

	/// /////////////////////
	// GET AND SET FUNCTIONS
	/// /////////////////////
	private setPowerState(powerOn: CharacteristicValue, context: string): void {
		// if context is statuspoll, then we need to ensure that we do not set the actual value
		if (context === 'statuspoll') {
			this.platform.log.debug(
				'setPowerState - polling mode, ignore, state: %s',
				this.state,
			);
			return;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.attemptCount++;

		this.state = powerOn as boolean;
		if (!this.state) {
			this.platform.log.debug(
				'setPowerState - actual mode, power state: %s, switching to OFF',
				this.state,
			);
			this.eiscp.command(
				this.receiver.zone
				+ '.'
				+ this.cmdMap[this.receiver.zone].power
				+ '=standby',
				error => {
					if (error === undefined)
						return;

					this.state = false;
					this.platform.log.error(
						'setPowerState - PWR OFF: ERROR - current state: %s',
						this.state,
					);
				},
			);
			this.tvService?.updateCharacteristic(
				this.platform.api.hap.Characteristic.Active,
				this.state,
			);
			return;
		}

		this.platform.log.debug(
			'setPowerState - actual mode, power state: %s, switching to ON',
			this.state,
		);
		this.eiscp.command(
			this.receiver.zone + '.' + this.cmdMap[this.receiver.zone].power + '=on',
			error => {
				if (error !== undefined) {
					this.state = false;
					this.platform.log.error(
						'setPowerState - PWR ON: ERROR - current state: %s',
						this.state,
					);
					this.tvService?.updateCharacteristic(
						this.platform.api.hap.Characteristic.Active,
						'statuspoll',
					);
					return;
				}

				// If the AVR has just been turned on, apply the default volume
				this.platform.log.debug('Attempting to set the default volume to '
					+ this.receiver.default_volume);
				if (this.receiver.default_volume !== undefined && this.receiver.default_volume !== 0) {
					this.platform.log.info('Setting default volume to ' + this.receiver.default_volume);
					this.eiscp.command(
						this.receiver.zone
						+ '.'
						+ this.cmdMap[this.receiver.zone].volume
						+ ':'
						+ this.receiver.default_volume,
						volumeError => {
							if (volumeError !== undefined) {
								this.platform.log.error(
									'Error while setting default volume: %s',
									volumeError,
								);
							}
						},
					);
				}

				// If the AVR has just been turned on, apply the Input default
				this.platform.log.debug('Attempting to set the default input selector to '
					+ this.receiver.default_input);

				// Handle default_input being either a custom label or manufacturer label
				let label = this.receiver.default_input;
				if (this.inputs) {
					for (const input of this.inputs) {
						if (input.input_name === this.receiver.default_input)
							label = input.input_name;
						else if (input.display_name === this.receiver.default_input)
							label = input.display_name;
					}
				}

				const index =
					label === null
						? -1
						: this.rxInputs.inputs.findIndex(i => i.label === label);
				this.iState = index + 1;

				if (this.state && label !== undefined && label !== '') {
					this.platform.log.info('Setting default input selector to ' + label);
					this.eiscp.command(
						this.receiver.zone
						+ '.'
						+ this.cmdMap[this.receiver.zone].input
						+ '='
						+ label,
						inputError => {
							if (inputError !== undefined) {
								this.platform.log.error(
									'Error while setting default input: %s',
									inputError,
								);
							}
						},
					);
				}
			},
		);

		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Active,
			this.state,
		);
	}

	private polling() {
		// Status Polling
		if (this.switchHandling !== 'poll')
			return;

		this.platform.log.debug('start long poller..');
		// PWR Polling
		const statusemitter = pollingtoevent(
			done => {
				this.platform.log.debug('start PWR polling..');
				const isResponse = this.getPowerState('statuspoll');
				done(null, isResponse, this.attemptCount);
			},
			{
				'longpolling': true,
				'interval': this.interval * 1000,
				'longpollEventName': 'statuspoll',
			},
		);

		statusemitter.on('statuspoll', (isOn: boolean) => {
			this.state = isOn;
			this.platform.log.debug(
				'event - PWR status poller - new state: ',
				this.state,
			);
		});
		// Audio-Input Polling
		const iStatusEmitter = pollingtoevent(
			done => {
				this.platform.log.debug('start INPUT polling..');
				const response = this.getInputSource('i_statuspoll');
				done(null, response, this.attemptCount);
			},
			{
				'longpolling': true,
				'interval': this.interval * 1000,
				'longpollEventName': 'i_statuspoll',
			},
		);

		iStatusEmitter.on('i_statuspoll', (data: number) => {
			this.iState = data;
			this.platform.log.debug(
				'event - INPUT status poller - new iState: ',
				this.iState,
			);
		});
		// Audio-Muting Polling
		const mStatusEmitter = pollingtoevent(
			done => {
				this.platform.log.debug('start MUTE polling..');
				const isResponse = this.getMuteState('m_statuspoll');
				done(null, isResponse, this.attemptCount);
			},
			{
				'longpolling': true,
				'interval': this.interval * 1000,
				'longpollEventName': 'm_statuspoll',
			},
		);

		mStatusEmitter.on('m_statuspoll', (isMuted: boolean) => {
			this.mState = isMuted;
			this.platform.log.debug(
				'event - MUTE status poller - new mState: ',
				this.mState,
			);
		});
		// Volume Polling
		const vStatusEmitter = pollingtoevent(
			done => {
				this.platform.log.debug('start VOLUME polling..');
				const response = this.getVolumeState('v_statuspoll');
				done(null, response, this.attemptCount);
			},
			{
				'longpolling': true,
				'interval': this.interval * 1000,
				'longpollEventName': 'v_statuspoll',
			},
		);

		vStatusEmitter.on('v_statuspoll', (data: number) => {
			this.vState = data;
			this.platform.log.debug(
				'event - VOLUME status poller - new vState: ',
				this.vState,
			);
		});
	}

	private getPowerState(context) {
		// if context is statuspoll, then we need to request the actual value
		if (
			context !== 'statuspoll'
			&& this.switchHandling === 'poll'
		) {
			this.platform.log.debug(
				'getPowerState - polling mode, return state: ',
				this.state,
			);
			return this.state;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.platform.log.debug(
			'getPowerState - actual mode, return state: ',
			this.state,
		);
		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].power
			+ '=query',
			error => {
				if (error === undefined)
					return;

				this.state = false;
				this.platform.log.debug(
					'getPowerState - PWR QRY: ERROR - current state: %s',
					this.state,
				);
			},
		);
		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Active,
			this.state,
		);
		return this.state;
	}

	private getVolumeState(context) {
		// if context is v_statuspoll, then we need to request the actual value
		if (
			context !== 'v_statuspoll'
			&& this.switchHandling === 'poll'
		) {
			this.platform.log.debug(
				'getVolumeState - polling mode, return vState: ',
				this.vState,
			);
			return this.vState;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.platform.log.debug(
			'getVolumeState - actual mode, return vState: ',
			this.vState,
		);
		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].volume
			+ '=query',
			error => {
				if (error === undefined)
					return;

				this.vState = 0;
				this.platform.log.debug(
					'getVolumeState - VOLUME QRY: ERROR - current vState: %s',
					this.vState,
				);
			},
		);

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Volume,
			this.vState,
		);

		return this.vState;
	}

	private setVolumeState(volumeLvl: CharacteristicValue, context) {
		// if context is v_statuspoll, then we need to ensure this we do not set the actual value
		if (context === 'v_statuspoll') {
			this.platform.log.debug(
				'setVolumeState - polling mode, ignore, vState: %s',
				this.vState,
			);
			return;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.attemptCount++;
		const volumeLevel = volumeLvl as number;

		// Are we mapping volume to 100%?
		if (this.receiver.map_volume_100) {
			const volumeMultiplier = this.receiver.max_volume !== undefined && this.receiver.max_volume !== 0
				? this.receiver.max_volume / 100
				: 100;
			const newVolume = volumeMultiplier * volumeLevel;
			this.vState = Math.round(newVolume);
			this.platform.log.debug(
				'setVolumeState - actual mode, PERCENT, volume vState: %s',
				this.vState,
			);
		} else if (volumeLevel > (this.receiver.max_volume ?? 100)) {
			// Determine if max_volume threshold breached, if so set to max.
			this.vState = this.receiver.max_volume ?? 100;
			this.platform.log.debug(
				'setVolumeState - VOLUME LEVEL of: %s exceeds max_volume: %s. Resetting to max.',
				volumeLevel,
				this.receiver.max_volume,
			);
		} else {
			// Must be using actual volume number
			this.vState = volumeLevel;
			this.platform.log.debug(
				'setVolumeState - actual mode, ACTUAL volume vState: %s',
				this.vState,
			);
		}

		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].volume
			+ ':'
			+ this.vState,
			error => {
				if (error === undefined)
					return;

				this.vState = 0;
				this.platform.log.debug(
					'setVolumeState - VOLUME : ERROR - current vState: %s',
					this.vState,
				);
			},
		);

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Volume,
			this.vState,
		);
	}

	private setVolumeRelative(volumeDirection, context) {
		// if context is v_statuspoll, then we need to ensure this we do not set the actual value
		if (context === 'v_statuspoll') {
			this.platform.log.debug(
				'setVolumeRelative - polling mode, ignore, vState: %s',
				this.vState,
			);
			return;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.attemptCount++;

		if (
			volumeDirection
			=== this.platform.api.hap.Characteristic.VolumeSelector.INCREMENT
		) {
			this.platform.log.debug('setVolumeRelative - VOLUME : level-up');
			this.eiscp.command(
				this.receiver.zone
				+ '.'
				+ this.cmdMap[this.receiver.zone].volume
				+ ':level-up',
				error => {
					if (error === undefined)
						return;

					this.vState = 0;
					this.platform.log.error(
						'setVolumeRelative - VOLUME : ERROR - current vState: %s',
						this.vState,
					);
				},
			);
		} else if (
			volumeDirection
			=== this.platform.api.hap.Characteristic.VolumeSelector.DECREMENT
		) {
			this.platform.log.debug('setVolumeRelative - VOLUME : level-down');
			this.eiscp.command(
				this.receiver.zone
				+ '.'
				+ this.cmdMap[this.receiver.zone].volume
				+ ':level-down',
				error => {
					if (error === undefined)
						return;

					this.vState = 0;
					this.platform.log.error(
						'setVolumeRelative - VOLUME : ERROR - current vState: %s',
						this.vState,
					);
				},
			);
		} else {
			this.platform.log.error('setVolumeRelative - VOLUME : ERROR - unknown direction sent');
		}

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Volume,
			this.vState,
		);
	}

	private getMuteState(context) {
		// if context is m_statuspoll, then we need to request the actual value
		if (
			context !== 'm_statuspoll'
			&& this.switchHandling === 'poll'
		) {
			this.platform.log.debug(
				'getMuteState - polling mode, return mState: ',
				this.mState,
			);
			return this.mState;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.platform.log.debug(
			'getMuteState - actual mode, return mState: ',
			this.mState,
		);
		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].muting
			+ '=query',
			error => {
				if (error === undefined)
					return;

				this.mState = false;
				this.platform.log.debug(
					'getMuteState - MUTE QRY: ERROR - current mState: %s',
					this.mState,
				);
			},
		);

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Mute,
			this.mState,
		);

		return this.mState;
	}

	private setMuteState(muteOn: CharacteristicValue, context: string) {
		// if context is m_statuspoll, then we need to ensure this we do not set the actual value
		if (context === 'm_statuspoll') {
			this.platform.log.debug(
				'setMuteState - polling mode, ignore, mState: %s',
				this.mState,
			);
			return this.mState;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.attemptCount++;

		this.mState = muteOn as boolean;
		if (this.mState) {
			this.platform.log.debug(
				'setMuteState - actual mode, mute mState: %s, switching to ON',
				this.mState,
			);
			this.eiscp.command(
				this.receiver.zone
				+ '.'
				+ this.cmdMap[this.receiver.zone].muting
				+ '=on',
				error => {
					if (error === undefined)
						return;

					this.mState = false;
					this.platform.log.error(
						'setMuteState - MUTE ON: ERROR - current mState: %s',
						this.mState,
					);
				},
			);
		} else {
			this.platform.log.debug(
				'setMuteState - actual mode, mute mState: %s, switching to OFF',
				this.mState,
			);
			this.eiscp.command(
				this.receiver.zone
				+ '.'
				+ this.cmdMap[this.receiver.zone].muting
				+ '=off',
				error => {
					if (error === undefined)
						return;

					this.mState = false;
					this.platform.log.error(
						'setMuteState - MUTE OFF: ERROR - current mState: %s',
						this.mState,
					);
				},
			);
		}

		this.tvSpeakerService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.Mute,
			this.mState,
		);
		return this.mState;
	}

	private getInputSource(context: string) {
		// if context is i_statuspoll, then we need to request the actual value
		if (
			context !== 'i_statuspoll'
			&& this.switchHandling === 'poll'
		) {
			this.platform.log.debug(
				'getInputState - polling mode, return iState: ',
				this.iState,
			);
			return this.iState;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.platform.log.debug(
			'getInputState - actual mode, return iState: ',
			this.iState,
		);
		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].input
			+ '=query',
			error => {
				if (error === undefined)
					return;

				this.iState = 1;
				this.platform.log.error(
					'getInputState - INPUT QRY: ERROR - current iState: %s',
					this.iState,
				);
			},
		);

		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.ActiveIdentifier,
			this.iState,
		);

		return this.iState;
	}

	private setInputSource(source: CharacteristicValue, context) {
		// if context is i_statuspoll, then we need to ensure this we do not set the actual value
		if (context === 'i_statuspoll') {
			this.platform.log.info(
				'setInputState - polling mode, ignore, iState: %s',
				this.iState,
			);
			return;
		}

		if (this.receiver.ip_address === '') {
			this.platform.log.error('Ignoring request; No ip_address defined.');
			throw new Error('No ip_address defined.');
		}

		this.attemptCount++;

		this.iState = source as number;
		const label = this.rxInputs.inputs[this.iState - 1].label;

		this.platform.log.debug(
			'setInputState - actual mode, ACTUAL input iState: %s - label: %s',
			this.iState,
			label,
		);

		this.eiscp.command(
			this.receiver.zone
			+ '.'
			+ this.cmdMap[this.receiver.zone].input
			+ ':'
			+ label,
			error => {
				if (error !== undefined) {
					this.platform.log.error(
						'setInputState - INPUT : ERROR - current iState:%s - Source:%s',
						this.iState,
						(source as number).toString(),
					);
				}
			},
		);

		this.tvService?.updateCharacteristic(
			this.platform.api.hap.Characteristic.ActiveIdentifier,
			this.iState,
		);
	}

	private remoteKeyPress(remoteKey: CharacteristicValue) {
		const button = remoteKey as number;
		const press = this.buttons.get(button);
		if (press === undefined) {
			this.platform.log.error('Remote button %d not supported.', button);
			return;
		}

		this.platform.log.debug('remoteKeyPress - INPUT: pressing key %s', press);
		this.eiscp.command(this.receiver.zone + '.setup=' + press, error => {
			if (error === undefined)
				return;

			this.iState = 1;
			this.platform.log.error(
				'remoteKeyPress - INPUT: ERROR pressing button %s',
				press,
			);
		});
	}

	/// /////////////////////
	// TV SERVICE FUNCTIONS
	/// /////////////////////
	private addSources(service: Service) {
		// If input name mappings are provided, use them.
		// Option to only receiver specified inputs with filter_inputs
		this.platform.log.debug('Supported inputs', this.rxInputs.inputs);
		if (this.receiver.filter_inputs && this.inputs) {
			// Check the rxInputs.inputs items to see if each exists in this.inputs. Return new array of those that do.
			this.rxInputs.inputs = this.rxInputs.inputs.filter(rxinput => this.inputs?.some(input => input.input_name === rxinput.label));
		}

		this.platform.log.debug('Inputs: %s', this.rxInputs.inputs);
		// Create final array of inputs, using any labels defined in the receiver's inputs to override the default labels
		return this.rxInputs.inputs.map((i, index: number) => {
			const hapId = index + 1;
			let inputName = i.label;
			if (this.inputs) {
				for (const input of this.inputs) {
					if (input.input_name !== i.label)
						continue;

					this.platform.log.debug(
						'Found input mapping for %s to %s ',
						i.label,
						input.display_name,
					);
					inputName = input.display_name ?? i.label;
				}
			}

			return this.setupInput(i.code, inputName, hapId, service);
		});
	}

	private setupInput(inputCode: string, name: string, hapId: number, television: Service) {
		const normalizedName = name.replace('-', ' ');
		const input = this.accessory.addService(
			this.platform.api.hap.Service.InputSource,
			`${this.receiver.name} ${normalizedName}`,
			inputCode,
		);
		const inputSourceType =
			this.platform.api.hap.Characteristic.InputSourceType.HDMI;

		input
			.setCharacteristic(this.platform.api.hap.Characteristic.Identifier, hapId)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.ConfiguredName,
				normalizedName,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.IsConfigured,
				this.platform.api.hap.Characteristic.IsConfigured.CONFIGURED,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.InputSourceType,
				inputSourceType,
			);

		input
			.getCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName)
			.setProps({
				'perms': [this.platform.api.hap.Perms.PAIRED_READ],
			});

		television.addLinkedService(input);
		return input;
	}

	private createAccessoryInformationService() {
		const informationService =
			this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)
			?? this.accessory.addService(this.platform.api.hap.Service.AccessoryInformation);

		informationService
			.setCharacteristic(
				this.platform.api.hap.Characteristic.Manufacturer,
				this.avrManufacturer,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.Model,
				this.receiver.model,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.SerialNumber,
				this.avrSerial,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.FirmwareRevision,
				'info.version',
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.Name,
				this.receiver.name,
			);

		return informationService;
	}

	private createVolumeType(service: Service) {
		if (this.receiver.volume_type === 'dimmer') {
			this.dimmer = this.accessory.addService(
				this.platform.api.hap.Service.Lightbulb,
				this.receiver.name + ' Volume',
				'dimmer',
			);
			this.dimmer
				.getCharacteristic(this.platform.api.hap.Characteristic.On)
			// Inverted logic taken from https://github.com/langovoi/homebridge-upnp
				.onGet(() => !this.getMuteState(null))
				.onSet(value => this.setMuteState(!(value as boolean), ''));
			this.dimmer
				.addCharacteristic(this.platform.api.hap.Characteristic.Brightness)
				.onGet(this.getVolumeState.bind(this))
				.onSet(this.setVolumeState.bind(this));

			service.addLinkedService(this.dimmer);
		} else if (this.receiver.volume_type === 'speed') {
			this.speed = this.accessory.addService(
				this.platform.api.hap.Service.Fan,
				this.receiver.name + ' Volume',
				'speed',
			);
			this.speed
				.getCharacteristic(this.platform.api.hap.Characteristic.On)
			// Inverted logic taken from https://github.com/langovoi/homebridge-upnp
				.onGet(context => !this.getMuteState(context))
				.onSet((value, context) => this.setMuteState(!(value as boolean), context as string));
			this.speed
				.addCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed)
				.onGet(this.getVolumeState.bind(this))
				.onSet(this.setVolumeState.bind(this));

			service.addLinkedService(this.speed);
		}
	}

	private createTvService() {
		this.platform.log.debug(
			'Creating TV service for receiver %s',
			this.receiver.name,
		);
		const tvService =
			this.accessory.getService(this.platform.api.hap.Service.Television)
			?? this.accessory.addService(
				this.platform.api.hap.Service.Television,
				this.receiver.name,
			);

		tvService
			.getCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName)
			.setValue(this.receiver.name)
			.setProps({
				'perms': [this.platform.api.hap.Perms.PAIRED_READ],
			});

		tvService.setCharacteristic(
			this.platform.api.hap.Characteristic.SleepDiscoveryMode,
			this.platform.api.hap.Characteristic.SleepDiscoveryMode
				.ALWAYS_DISCOVERABLE,
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

	private createTvSpeakerService() {
		this.platform.log.debug(
			'Creating TV Speaker service for receiver `%s`',
			this.receiver.name,
		);
		const tvSpeakerService =
			this.accessory.getService(this.platform.api.hap.Service.TelevisionSpeaker)
			?? this.accessory.addService(
				this.platform.api.hap.Service.TelevisionSpeaker,
				this.receiver.name + ' Volume',
				'tvSpeakerService',
			);
		tvSpeakerService
			.setCharacteristic(
				this.platform.api.hap.Characteristic.Active,
				this.platform.api.hap.Characteristic.Active.ACTIVE,
			)
			.setCharacteristic(
				this.platform.api.hap.Characteristic.VolumeControlType,
				this.platform.api.hap.Characteristic.VolumeControlType.ABSOLUTE,
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
