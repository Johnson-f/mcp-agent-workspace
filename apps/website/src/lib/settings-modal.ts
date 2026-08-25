export const SETTINGS_MODAL_OPEN_EVENT = "agents:settings:open";

export function requestSettingsModal(target: EventTarget) {
  target.dispatchEvent(new Event(SETTINGS_MODAL_OPEN_EVENT));
}
