export const SOUND_MANIFEST = [
  { key: 'bgm', path: 'assets/audio/overworld_bgm.mp3', loop: true },
  { key: 'coin', path: 'assets/audio/coin_collect.wav' },
  { key: 'mario_selected', path: 'assets/audio/mario_selected.wav' },
  { key: 'luigi_selected', path: 'assets/audio/luigi_selected.wav' },
  { key: 'mario_jump1', path: 'assets/audio/mario_jump1.wav' },
  { key: 'mario_jump2', path: 'assets/audio/mario_jump2.wav' },
  { key: 'mario_fall', path: 'assets/audio/mario_fall.wav' },
  { key: 'luigi_jump1', path: 'assets/audio/luigi_jump1.wav' },
  { key: 'luigi_jump2', path: 'assets/audio/luigi_jump2.wav' },
  { key: 'luigi_fall', path: 'assets/audio/luigi_fall.wav' },
];

export function initGameAudio(audioManager) {
  SOUND_MANIFEST.forEach(({ key, path, loop }) => {
    audioManager.load(key, path, loop || false);
  });
}