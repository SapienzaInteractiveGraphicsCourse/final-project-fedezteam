/**
 * Centralized localStorage access for game settings that need to persist
 * across sessions/page reloads.
 *
 * The mute preference used to be read/written independently in both
 * main.js and UIManager.js, using the same string key typed out twice.
 * Keeping the key (and the read/write logic) in one place means it only
 * has to be changed in one file if it ever needs to.
 */

const MUTE_STORAGE_KEY = "game_is_muted";

/**
 * @returns {boolean} the persisted mute state, or false if none was saved yet.
 */
export function getStoredMuteState() {
  return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
}

/**
 * @param {boolean} isMuted
 */
export function setStoredMuteState(isMuted) {
  localStorage.setItem(MUTE_STORAGE_KEY, isMuted);
}
