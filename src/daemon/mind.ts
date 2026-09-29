import { NO_MIND, type MindApi, type MindDeps } from './mind-api';

export function createMind(_deps: MindDeps): MindApi {
  return NO_MIND;
}
