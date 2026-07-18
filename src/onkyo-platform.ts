import {
  type API,
  type DynamicPlatformPlugin,
  type Logger,
  type PlatformAccessory,
} from 'homebridge';
import { Eiscp } from './eiscp/eiscp.js';
import { OnkyoReceiver } from './onkyo-receiver.js';
import { type Config } from './eiscp/config.js';

export class OnkyoPlatform implements DynamicPlatformPlugin {
  public readonly api: API;
  public readonly config: Config;
  public readonly log: Logger;
  public readonly receiverAccessories: OnkyoReceiver[];
  public readonly accessories: PlatformAccessory[];
  public readonly existingAccessories: Map<string, PlatformAccessory>;

  public readonly connections: Record<string, Eiscp>;
  public numberReceivers?: number;

  constructor(log: Logger, config: Config, api: API) {
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

  private createAccessories() {
    this.numberReceivers = this.config.receivers.length;
    this.log.debug('Creating %s receivers...', this.numberReceivers);
    if (this.numberReceivers === 0) {
      return;
    }

    for (const receiver of this.config.receivers) {
      if (!Object.hasOwn(this.connections, receiver.ip_address)) {
        this.log.debug(
          'Creating new connection for ip %s',
          receiver.ip_address
        );
        this.connections[receiver.ip_address] = new Eiscp(this.log);
        this.connections[receiver.ip_address].connect({
          host: receiver.ip_address,
          reconnect: true,
          model: receiver.model,
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
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.existingAccessories.set(accessory.UUID, accessory);
  }
}
