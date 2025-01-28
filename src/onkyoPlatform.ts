import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import eiscp from './eiscp/eiscp.js';
import { OnkyoReceiver } from './onkyoReceiver.js';

export class OnkyoPlatform implements DynamicPlatformPlugin {
  public readonly api: API;
  public readonly config: PlatformConfig;
  public readonly log: Logger;
  public readonly receiverAccessories: OnkyoReceiver[];
  public readonly accessories: PlatformAccessory[];
  public readonly existingAccessories: Map<string, PlatformAccessory>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly connections: Record<string, any>;
  public numberReceivers?: number;

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.api = api;
    this.config = config;
    this.log = log;
    this.existingAccessories = new Map();
    this.accessories = [];
    this.connections = {};
    this.receiverAccessories = [];

    if (this.config === undefined) {
      this.log.error(
        'ERROR: your configuration is incorrect. Configuration changed with version 0.7.x'
      );
      throw new Error(
        'ERROR: your configuration is incorrect. Configuration changed with version 0.7.x'
      );
    }

    this.log.info('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.createAccessories();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.existingAccessories.set(accessory.UUID, accessory);
  }

  private createAccessories() {
    this.numberReceivers = this.config.receivers.length;
    this.log.debug('Creating %s receivers...', this.numberReceivers);
    if (this.numberReceivers === 0) {
      return;
    }
    this.config.receivers.forEach(receiver => {
      if (!this.connections[receiver.ip_address]) {
        this.log.debug(
          'Creating new connection for ip %s',
          receiver.ip_address
        );
        this.connections[receiver.ip_address] = eiscp;
        this.connections[receiver.ip_address].connect({
          host: receiver['ip_address'],
          reconnect: true,
          model: receiver['model'],
        });
      }
      const uuid = this.api.hap.uuid.generate(
        'homebridge:homebridge-onkyo' + receiver.name
      );
      const accessory =
        this.existingAccessories.get(uuid) ??
        new this.api.platformAccessory(
          receiver.name,
          uuid,
          this.api.hap.Categories.AUDIO_RECEIVER
        );
      const onkyoReceiver = new OnkyoReceiver(this, receiver, accessory);
      this.receiverAccessories.push(onkyoReceiver);
    });
  }
}
