/**
 * Centralized localStorage access for settings that persist across
 * sessions. Keeps the mute-preference key in one place instead of
 * duplicated in main.js and UIManager.js.
 */

const MUTE_STORAGE_KEY = "game_is_muted";
const CAMERA_INVERT_X_KEY = "game_camera_invert_x";
const CAMERA_INVERT_Y_KEY = "game_camera_invert_y";

// Returns the persisted mute state, or false if none was saved yet.
export function getStoredMuteState() {
  return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
}

// Persists the mute state.
export function setStoredMuteState(isMuted) {
  localStorage.setItem(MUTE_STORAGE_KEY, isMuted);
}

// Camera rotation axis inversion (pause menu toggles) — read directly by
// CameraManager every frame, so a toggle takes effect immediately with no
// extra wiring, and survives a reload the same way the mute state does.
export function getStoredCameraInvertX() {
  return localStorage.getItem(CAMERA_INVERT_X_KEY) === "true";
}

export function setStoredCameraInvertX(inverted) {
  localStorage.setItem(CAMERA_INVERT_X_KEY, inverted);
}

export function getStoredCameraInvertY() {
  return localStorage.getItem(CAMERA_INVERT_Y_KEY) === "true";
}

export function setStoredCameraInvertY(inverted) {
  localStorage.setItem(CAMERA_INVERT_Y_KEY, inverted);
}
