import { assetUrl } from "../Assets/basePath.js";

// Manifest of every sound/music track, keyed by name. Generic requests
// ("jump", "fall") resolve to `<speaker>_<effect>` via playSFX/_resolveSFX
// (see AudioManager.setVoice) — keys below follow that shape even where
// the file on disk is named differently (Peach's two greetings).
export const SOUND_MANIFEST = [
  // Looping music: overworld on start, the other two per boss zone.
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

  // Mario/Luigi: jump and damage ship as two takes, alternated by playSFX.
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

  // Yoshi speaks for the rider while mounted (setVoice("yoshi")). No
  // damage grunt on purpose — falls back to Mario/Luigi's.
  { key: 'yoshi_jump1', path: 'assets/audio/Yoshi/yoshi_jump1.wav' },
  { key: 'yoshi_jump2', path: 'assets/audio/Yoshi/yoshi_jump2.wav' },
  { key: 'yoshi_fall', path: 'assets/audio/Yoshi/yoshi_fall.wav' },
  { key: 'yoshi_mounted', path: 'assets/audio/Yoshi/yoshi_mounted.wav' },
  // Egg-hatch cry, looked up directly (before anyone is riding him).
  { key: 'yoshi_spawn', path: 'assets/audio/Yoshi/yoshi_spawn.wav' },

  // Peach (PeachCutscene.js): per-character greeting, then two alternated
  // generic blips per line (no speaker prefix — only Peach uses these).
  { key: 'mario_peach_call', path: 'assets/audio/Peach/peach_call_mario.wav' },
  { key: 'luigi_peach_call', path: 'assets/audio/Peach/peach_call_luigi.wav' },
  { key: 'peach_talk1', path: 'assets/audio/Peach/peach_talk.wav' },
  { key: 'peach_talk2', path: 'assets/audio/Peach/peach_talk2.wav' },

  // Toad (QuestManager.js): two alternated generic blips, plus four
  // exact-key one-offs for the first meeting and each quest handoff.
  { key: 'toad_talk1', path: 'assets/audio/Toad/toad_1.wav' },
  { key: 'toad_talk2', path: 'assets/audio/Toad/toad_2.wav' },
  { key: 'toad_welcome', path: 'assets/audio/Toad/toad_welcome.wav' },
  { key: 'toad_kamek', path: 'assets/audio/Toad/toad_kamek.wav' },
  { key: 'toad_bowser', path: 'assets/audio/Toad/toad_bowser.wav' },
  { key: 'toad_give_star', path: 'assets/audio/Toad/toad_give_star.wav' },

  // Bosses: zone-arrival greeting, attack roar, stomp yelp, death cry.
  { key: 'kamek_start', path: 'assets/audio/Kamek/kamek_start.wav' },
  { key: 'kamek_attack', path: 'assets/audio/Kamek/kamek_attack.wav' },
  { key: 'kamek_hit', path: 'assets/audio/Kamek/kamek_hit.wav' },
  { key: 'kamek_last_hit', path: 'assets/audio/Kamek/kamek_last_hit.wav' },
  { key: 'bowser_start', path: 'assets/audio/Bowser/bowser_start.wav' },
  { key: 'bowser_attack', path: 'assets/audio/Bowser/bowser_attack.wav' },
  { key: 'bowser_hit', path: 'assets/audio/Bowser/bowser_hit.wav' },
  { key: 'bowser_last_hit', path: 'assets/audio/Bowser/bowser_last_hit.wav' },
];

// Preloads every entry into `audioManager`, resolving each relative path
// through assetUrl() (see basePath.js) before handing it to `new Audio`.
export function initGameAudio(audioManager) {
  SOUND_MANIFEST.forEach(({ key, path, loop }) => {
    audioManager.load(key, assetUrl(path), loop || false);
  });
}
