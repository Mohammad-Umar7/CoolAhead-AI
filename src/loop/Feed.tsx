import { useEffect, useRef, useState } from 'react';
import { CLIPS, footageUrl } from '../data/footage';

interface RawTracks {
  w: number;
  h: number;
  fps: number;
  frames: number;
  step: number;
  tracks: { c: number; b: number[] }[];
}

export interface Tracks extends RawTracks {
  /** horizontal centre of each person in the first frame, 0..1: the order a sweep finds them in */
  cx: number[];
}

const cache = new Map<string, Promise<Tracks | null>>();

/** Boxes for a clip, most confident person first. Missing files resolve to null. */
function loadTracks(id: string): Promise<Tracks | null> {
  let hit = cache.get(id);
  if (!hit) {
    hit = fetch(footageUrl(id, 'json'))
      .then((r) => (r.ok ? (r.json() as Promise<RawTracks>) : null))
      .then((raw) => {
        if (!raw) return null;
        const tracks = raw.tracks.slice().sort((a, b) => b.c - a.c);
        return { ...raw, tracks, cx: tracks.map((t) => (t.b[0] + t.b[2] / 2) / 1000) };
      })
      .catch(() => null);
    cache.set(id, hit);
  }
  return hit;
}

export function useTracks(id: string | null) {
  const [tracks, setTracks] = useState<Tracks | null>(null);
  useEffect(() => {
    let live = true;
    setTracks(null);
    if (id && CLIPS[id]) void loadTracks(id).then((t) => live && setTracks(t));
    return () => {
      live = false;
    };
  }, [id]);
  return tracks;
}

/** How many of the first `count` people a sweep that has reached `reveal` (0..1 across the frame) has found. */
export function found(tracks: Tracks | null, count: number, reveal: number) {
  if (!tracks) return Math.round(count * Math.min(1, Math.max(0, reveal)));
  let n = 0;
  const top = Math.min(count, tracks.tracks.length);
  for (let i = 0; i < top; i++) if (tracks.cx[i] <= reveal) n++;
  return reveal >= 1 ? count : n;
}

const W = 792;
const H = 446;

interface Props {
  clip: string | null;
  tracks: Tracks | null;
  /** how many people the room reports */
  count: number;
  online: boolean;
  /** called every frame for how far the detector's sweep has got, 0..1 */
  reveal: () => number;
}

/**
 * One room's camera: the sample clip with the detector's boxes drawn over it,
 * in step with the video. The clip itself carries no boxes, and the faces in it
 * were pixelated when it was prepared.
 */
export default function Feed({ clip, tracks, count, online, reveal }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ tracks, count, reveal });
  live.current = { tracks, count, reveal };
  const has = !!clip && !!CLIPS[clip];

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { tracks: tr, count: n, reveal: rv } = live.current;
      g.clearRect(0, 0, W, H);
      const v = video.current;
      if (!tr || !v || n <= 0) return;
      const r = rv();
      const f = ((v.currentTime * tr.fps) % tr.frames) / tr.step;
      const last = Math.floor((tr.frames - 1) / tr.step);
      const i0 = Math.min(last, Math.floor(f));
      const i1 = Math.min(last, i0 + 1);
      const k = f - Math.floor(f);
      const top = Math.min(n, tr.tracks.length);
      for (let i = 0; i < top; i++) {
        const cx = tr.cx[i];
        if (cx > r) continue;
        const b = tr.tracks[i].b;
        const a = i0 * 4;
        const z = i1 * 4;
        const x = ((b[a] + (b[z] - b[a]) * k) / 1000) * W;
        const y = ((b[a + 1] + (b[z + 1] - b[a + 1]) * k) / 1000) * H;
        const w = ((b[a + 2] + (b[z + 2] - b[a + 2]) * k) / 1000) * W;
        const h = ((b[a + 3] + (b[z + 3] - b[a + 3]) * k) / 1000) * H;
        // a box the sweep has only just reached arrives bright and settles
        const fresh = r < 1 ? Math.max(0, 1 - (r - cx) / 0.1) : 0;
        g.fillStyle = `rgba(46, 240, 190, ${0.07 + 0.22 * fresh})`;
        g.strokeStyle = fresh > 0 ? `rgba(255, 255, 255, ${0.6 + 0.4 * fresh})` : 'rgba(46, 240, 190, 0.95)';
        g.lineWidth = 2 + 1.5 * fresh;
        g.beginPath();
        g.roundRect(x, y, w, h, 5);
        g.fill();
        g.stroke();
      }
      if (r > 0 && r < 1) {
        const x = r * W;
        const grad = g.createLinearGradient(x - 70, 0, x, 0);
        grad.addColorStop(0, 'rgba(46, 240, 190, 0)');
        grad.addColorStop(1, 'rgba(46, 240, 190, 0.28)');
        g.fillStyle = grad;
        g.fillRect(x - 70, 0, 70, H);
        g.fillStyle = 'rgba(255, 255, 255, 0.95)';
        g.fillRect(x - 1, 0, 2, H);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!online) {
    return (
      <div className="feed lost">
        <div className="feed-lost">
          <strong>No signal</strong>
          <span>reported as unknown, not as empty</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`feed${has ? '' : ' bare'}`}>
      {has && <video key={clip} ref={video} src={footageUrl(clip!, 'mp4')} muted loop autoPlay playsInline preload="auto" />}
      {!has && (
        <div className="feed-bare">
          <span>{count >= 1 ? 'Sample footage not loaded' : 'Empty room'}</span>
        </div>
      )}
      <canvas ref={canvas} width={W} height={H} />
    </div>
  );
}
