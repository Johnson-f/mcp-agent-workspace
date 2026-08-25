export const CONNECT_SERVER_MODAL_OPEN_EVENT = "agents:connect-server:open";

export function requestConnectServerModal(target: EventTarget) {
  target.dispatchEvent(new Event(CONNECT_SERVER_MODAL_OPEN_EVENT));
}
