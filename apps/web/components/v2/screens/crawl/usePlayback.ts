'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPlayer, realClock, type Playable } from '../../../../lib/v2/player';

/**
 * The replayed stream's state for a component, and whether it is playing: the player is made once,
 * at `startAt`, and plays from there when `autoplay` is set. The server renders the same first
 * state the browser starts in, still.
 */
export function usePlayback(recording: Playable, startAt: number, autoplay: boolean) {
  const [player] = useState(() => createPlayer(recording, { clock: realClock, startAt }));
  const state = useSyncExternalStore(player.subscribe, player.getState, player.getState);
  const playing = useSyncExternalStore(player.subscribe, player.playing, () => false);
  useEffect(() => {
    if (autoplay) player.play();
    return () => player.dispose();
  }, [player, autoplay]);
  return { state, playing };
}
