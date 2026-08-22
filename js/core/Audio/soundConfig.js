// Manifest of every sound effect and music track used by the game, keyed by
// the name AudioManager will use to reference it.
//
// The KEY is not just a label: playSFX() resolves a generic request like
// "jump" or "fall" into `<speaker>_<effect>`, where the speaker is the
// playable character (or Yoshi while he's being ridden — see
// AudioManager.setVoice). So the keys below have to keep that shape even
// where the file on disk is named the other way round, as with Peach's two
// greetings. Everything else is looked up by its exact key.
export const SOUND_MANIFEST = [
  // Looping music. The first one is what the game opens on; the other two
  // take over inside the matching boss zone (see AudioManager.playMusic and
  // updateGame's zone check in main.js).
  { key: 'bgm', path: 'assets/audio/overworld_bgm.mp3', loop: true },
  { key: 'kamek_battle', path: 'assets/audio/kamek_battle.mp3', loop: true },
  { key: 'bowser_battle', path: 'assets/audio/bowser_battle.mp3', loop: true },

  // Interface and pickups.
  { key: 'pause', path: 'assets/audio/menu_pause.wav' },
  { key: 'coin', path: 'assets/audio/coin_collect.wav' },
  { key: 'star', path: 'assets/audio/star_collect.wav' },
  { key: 'mushroom', path: 'assets/audio/1up.wav' },
  { key: 'gameover', path: 'assets/audio/gameover.mp3' },
  { key: 'ending', path: 'assets/audio/peach_ending.mp3' },
  { key: 'mario_selected', path: 'assets/audio/mario_selected.wav' },
  { key: 'luigi_selected', path: 'assets/audio/luigi_selected.wav' },

  // The two playable characters. "jump" and "damage" ship as two variants
  // each, alternated by playSFX so repeating the same action doesn't replay
  // the identical clip.
  { key: 'mario_jump1', path: 'assets/audio/Mario/mario_jump1.wav' },
  { key: 'mario_jump2', path: 'assets/audio/Mario/mario_jump2.wav' },
  { key: 'mario_fall', path: 'assets/audio/Mario/mario_fall.wav' },
  { key: 'mario_damage1', path: 'assets/audio/Mario/mario_damage1.wav' },
  { key: 'mario_damage2', path: 'assets/audio/Mario/mario_damage2.wav' },
  { key: 'luigi_jump1', path: 'assets/audio/Luigi/luigi_jump1.wav' },
  { key: 'luigi_jump2', path: 'assets/audio/Luigi/luigi_jump2.wav' },
  { key: 'luigi_fall', path: 'assets/audio/Luigi/luigi_fall.wav' },
  { key: 'luigi_damage1', path: 'assets/audio/Luigi/luigi_damage1.wav' },
  { key: 'luigi_damage2', path: 'assets/audio/Luigi/luigi_damage2.wav' },

  // Yoshi speaks for the rider while he's being ridden: same `<speaker>_`
  // key shape as the two characters above, so "jump" and "fall" resolve to
  // him instead once main.js has called setVoice("yoshi"). He has no damage
  // grunt on purpose — that one falls back through to Mario/Luigi.
  { key: 'yoshi_jump1', path: 'assets/audio/Yoshi/yoshi_jump1.wav' },
  { key: 'yoshi_jump2', path: 'assets/audio/Yoshi/yoshi_jump2.wav' },
  { key: 'yoshi_fall', path: 'assets/audio/Yoshi/yoshi_fall.wav' },
  { key: 'yoshi_mounted', path: 'assets/audio/Yoshi/yoshi_mounted.wav' },

  // Peach's ending dialogue (see interactions/PeachCutscene.js). Her
  // greeting differs per character, so its keys are spelled the way
  // playSFX resolves them — "peach_call" -> "mario_peach_call" — even
  // though the files themselves are named peach_call_mario/luigi.
  // Her per-line blip has two takes, alternated like the jump and damage
  // grunts — but with no speaker prefix, since Peach is the only one who
  // ever says these (see AudioManager._resolveSFX).
  { key: 'mario_peach_call', path: 'assets/audio/Peach/peach_call_mario.wav' },
  { key: 'luigi_peach_call', path: 'assets/audio/Peach/peach_call_luigi.wav' },
  { key: 'peach_talk1', path: 'assets/audio/Peach/peach_talk.wav' },
  { key: 'peach_talk2', path: 'assets/audio/Peach/peach_talk2.wav' },

  // The two bosses, all looked up by their exact key (see main.js): the
  // greeting on arriving in their zone, the roar that opens each ranged
  // attack's wind-up, the yelp on a non-fatal stomp and the death cry.
  { key: 'kamek_start', path: 'assets/audio/Kamek/kamek_start.wav' },
  { key: 'kamek_attack', path: 'assets/audio/Kamek/kamek_attack.wav' },
  { key: 'kamek_hit', path: 'assets/audio/Kamek/kamek_hit.wav' },
  { key: 'kamek_last_hit', path: 'assets/audio/Kamek/kamek_last_hit.wav' },
  { key: 'bowser_start', path: 'assets/audio/Bowser/bowser_start.wav' },
  { key: 'bowser_attack', path: 'assets/audio/Bowser/bowser_attack.wav' },
  { key: 'bowser_hit', path: 'assets/audio/Bowser/bowser_hit.wav' },
  { key: 'bowser_last_hit', path: 'assets/audio/Bowser/bowser_last_hit.wav' },
];

// Preloads every entry of SOUND_MANIFEST into the given AudioManager.
export function initGameAudio(audioManager) {
  SOUND_MANIFEST.forEach(({ key, path, loop }) => {
    audioManager.load(key, path, loop || false);
  });
}
