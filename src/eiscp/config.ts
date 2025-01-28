import { PlatformConfig } from 'homebridge';
import { ReceiverConfig } from '../receiverConfig';

export interface Config extends PlatformConfig {
  receivers: ReceiverConfig[];
}
