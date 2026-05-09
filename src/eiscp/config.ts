import type { PlatformConfig } from 'homebridge';
import type { ReceiverConfig } from '../receiverConfig.js';

export interface Config extends PlatformConfig {
  receivers: ReceiverConfig[];
}
