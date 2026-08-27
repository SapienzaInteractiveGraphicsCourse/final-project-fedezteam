/**
 * Centralized localStorage access for settings that persist across
 * sessions. Keeps the mute-preference key in one place instead of
 * duplicated in main.js and UIManager.js.
 */

const MUTE_STORAGE_KEY = "game_is_muted";

// Returns the persisted mute state, or false if none was saved yet.
export function getStoredMuteState() {
  return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
}

// Persists the mute state.
export function setStoredMuteState(isMuted) {
  localStorage.setItem(MUTE_STORAGE_KEY, isMuted);
}
