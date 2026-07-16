import type { PlatformConfig } from 'homebridge';
import type { ReceiverConfig } from '../receiver-config.js';

export interface Config extends PlatformConfig {
  receivers: ReceiverConfig[];
}
