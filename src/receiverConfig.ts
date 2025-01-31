import { ReceiverInputConfig } from './receiverInputConfig.js';

export interface ReceiverConfig {
  default_input?: string;
  default_volume?: number;
  filter_inputs?: boolean;
  inputs?: ReceiverInputConfig[];
  ip_address: string;
  max_volume?: number;
  map_volume_100?: boolean;
  model: string;
  name: string;
  poll_status_interval?: string;
  serial?: string;
  volume_type?: string;
  zone: string;
}
