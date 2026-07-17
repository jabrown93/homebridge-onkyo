import type { API } from 'homebridge';
import { OnkyoPlatform } from './onkyo-platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 This method registers the platform with Homebridge
 */
function registerPlatform(api: API) {
  api.registerPlatform(PLATFORM_NAME, OnkyoPlatform);
}

export default registerPlatform;
