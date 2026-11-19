import clips from './clips.json';

/**
 * The sample footage the vision step runs on. Each clip was processed once,
 * offline, by scripts/vision/detect.py: a pretrained YOLO model finds the
 * people, their heads are pixelated, and only the boxes are kept. The number
 * of boxes in a room's clip is the head count that room reports while a class
 * is in it, so what the page shows and what the controller plans on are the
 * same number.
 */
export interface ClipInfo {
  id: string;
  /** people the detector found */
  people: number;
  fps: number;
  frames: number;
  w: number;
  h: number;
  source: { title: string; url: string; author: string; licence: string };
}

export const CLIPS: Record<string, ClipInfo> = Object.fromEntries((clips as ClipInfo[]).map((c) => [c.id, c]));

/** Clip shown for each room while people are in it, and while it is empty. */
export const ROOM_CLIP = ['a301', 'a302', 'a303'];
const EMPTY_CLIP = ['empty1', 'empty2', 'empty3'];

/** Head count the detector reports for a full class in each room. */
export const DETECTED: number[] = ROOM_CLIP.map((id, i) => CLIPS[id]?.people ?? [26, 41, 14][i]);

export function emptyClip(room: number): string | null {
  for (const id of [EMPTY_CLIP[room], ...EMPTY_CLIP]) if (CLIPS[id]) return id;
  return null;
}

export const footageUrl = (id: string, ext: 'mp4' | 'json') => `${import.meta.env.BASE_URL}footage/${id}.${ext}`;
