"""CoolAhead AI, vision step: count the people in a classroom clip.

For one raw video this script
  1. cuts a short segment, centre-crops it to 16:9 and resamples it to 20 fps,
  2. finds every person with a pretrained YOLO pose model and follows them with ByteTrack,
  3. turns the raw tracks into a fixed set of people (one box per person in every frame),
  4. pixelates every head so nobody can be identified,
  5. writes a small web video plus a JSON file with the boxes, and a contact sheet for checking.

The number of people that survive step 3 is the occupancy the cooling engine uses.
Nothing is trained here: the detector is the stock COCO model from Ultralytics.

    python scripts/vision/detect.py --src raw.mp4 --id a302 --start 2 --dur 9
    python scripts/vision/detect.py --all --raw-dir ../footage-raw

--all reads the clip list from clips.json next to this file. See README.md for the details.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("clips.json")
FOOTAGE_DIR = REPO / "public" / "footage"
SUMMARY = REPO / "src" / "data" / "clips.json"

OUT_W, OUT_H, OUT_FPS = 640, 360, 20
STEP = 2                     # the JSON keeps one box every STEP frames
COUNT_CONF = 0.3             # a counted person needs at least this mean detection confidence
MOSAIC = 8                   # privacy mosaic block size in output pixels
DETECT_WIDTH = 1920          # the detector sees the segment at up to this width
SIZE_RANGE = (0.5e6, 1.4e6)  # target size of the encoded clip in bytes
BOX_COLOUR = (174, 181, 15)  # #0FB5AE as BGR, used on the contact sheet only

# Tried in order; the weights download from the official Ultralytics release on first use.
MODELS = ("yolo11x-pose.pt", "yolo11l-pose.pt", "yolov8x-pose.pt")
PERSON = 0
FACE = slice(0, 5)           # COCO keypoints: nose, left eye, right eye, left ear, right ear


# --------------------------------------------------------------------------- video in


def probe_size(src: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(src)],
        capture_output=True, text=True, check=True).stdout
    stream = json.loads(out)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def read_segment(src: Path, start: float, dur: float):
    """Yield the segment as BGR frames: centre-cropped to 16:9, 20 fps, at most DETECT_WIDTH wide."""
    w, h = probe_size(src)
    crop_w = min(w, round(h * 16 / 9)) // 2 * 2
    crop_h = min(h, round(w * 9 / 16)) // 2 * 2
    det_w = min(crop_w, DETECT_WIDTH) // 16 * 16
    det_h = det_w * 9 // 16
    n_frames = round(dur * OUT_FPS)
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start}", "-i", str(src), "-an",
           "-vf", f"crop={crop_w}:{crop_h},fps={OUT_FPS},scale={det_w}:{det_h}:flags=lanczos",
           "-frames:v", str(n_frames), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = det_w * det_h * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(det_h, det_w, 3)
    proc.wait()


# --------------------------------------------------------------------------- detection


def load_model(weights_dir: Path):
    """Returns the first pose model that loads, its name and whether a GPU is available."""
    import torch
    from ultralytics import YOLO

    weights_dir.mkdir(parents=True, exist_ok=True)
    for name in MODELS:
        try:
            return YOLO(str(weights_dir / name)), name, torch.cuda.is_available()
        except Exception as err:  # a missing release asset or a failed download: try the next one
            print(f"  could not load {name}: {err}")
    raise SystemExit("no pose model could be loaded")


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """IoU of every box in a (n,4) against every box in b (m,4); boxes are x1,y1,x2,y2."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    inter = np.clip(rb - lt, 0, None).prod(-1)
    area_a = (a[:, 2:] - a[:, :2]).prod(-1)
    area_b = (b[:, 2:] - b[:, :2]).prod(-1)
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, thresh: float) -> np.ndarray:
    order = np.argsort(-scores)
    keep = []
    while len(order):
        best, rest = order[0], order[1:]
        keep.append(best)
        order = rest[iou_matrix(boxes[best:best + 1], boxes[rest])[0] < thresh]
    return np.array(keep, int)


def tile_windows(w: int, h: int, n: int, overlap: float = 1 / 3):
    """n x n windows that cover the frame and overlap their neighbours by `overlap` of a tile."""
    tw, th = int(w / (n - (n - 1) * overlap)), int(h / (n - (n - 1) * overlap))
    for row in range(n):
        for col in range(n):
            x = round(col * (w - tw) / max(n - 1, 1))
            y = round(row * (h - th) / max(n - 1, 1))
            yield x, y, tw, th


def detect_people(model, frame: np.ndarray, imgsz: int, conf: float, tiles: int, gpu: bool):
    """Run the pose model on the whole frame and, optionally, on overlapping tiles.

    Tiles show small, distant people at a larger scale, which is what a packed room needs.
    A person cut by a tile border is dropped there (the whole frame or the neighbouring
    tile sees them complete), and the remaining duplicates are merged with NMS.
    Returns boxes (n,4), scores (n,) and keypoints (n,17,3) in frame pixels.
    """
    h, w = frame.shape[:2]
    windows = [(0, 0, w, h)]
    if tiles > 1:
        windows += list(tile_windows(w, h, tiles))
    crops = [frame[y:y + th, x:x + tw] for x, y, tw, th in windows]
    results = model.predict(crops, imgsz=imgsz, conf=conf, classes=[PERSON],
                            device=0 if gpu else "cpu", half=gpu, verbose=False)

    boxes, scores, kpts = [], [], []
    for (x, y, tw, th), res in zip(windows, results):
        if len(res.boxes) == 0:
            continue
        b = res.boxes.xyxy.cpu().numpy().astype(float)
        k = res.keypoints.data.cpu().numpy().astype(float)
        edge = 4
        cut = (((b[:, 0] < edge) & (x > 0)) | ((b[:, 1] < edge) & (y > 0)) |
               ((b[:, 2] > tw - edge) & (x + tw < w)) | ((b[:, 3] > th - edge) & (y + th < h)))
        b, k, s = b[~cut], k[~cut], res.boxes.conf.cpu().numpy()[~cut]
        b[:, [0, 2]] += x
        b[:, [1, 3]] += y
        k[:, :, 0] += x
        k[:, :, 1] += y
        boxes.append(b)
        scores.append(s)
        kpts.append(k)
    if not boxes:
        return np.zeros((0, 4)), np.zeros(0), np.zeros((0, 17, 3))
    boxes, scores, kpts = np.concatenate(boxes), np.concatenate(scores), np.concatenate(kpts)
    keep = nms(boxes, scores, 0.6)
    return boxes[keep], scores[keep], kpts[keep]


def head_box(box: np.ndarray, kpts: np.ndarray) -> np.ndarray:
    """Head region of one person, padded generously, as x1,y1,x2,y2.

    With a visible face the nose, eyes and ears give the centre. The size is the larger of
    two estimates, the spread of those points and twice the distance from the face to the top
    of the person box, because in profile the points sit close together.
    Otherwise (person seen from behind, far away or blurred) the head is taken to be at the
    top of the person box: its middle 70 % in width and at least the top 28 % in height, more
    when only the upper body is in view and the head is a bigger share of the box.
    """
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    face = kpts[FACE]
    face = face[face[:, 2] >= 0.5, :2]
    if len(face) >= 2:
        cx, cy = face.mean(0)
        spread = np.linalg.norm(face[:, None] - face[None, :], axis=-1).max()
        side = float(np.clip(max(1.8 * spread, 2.0 * (cy - y1)), 0.3 * bw, min(bw, 0.6 * bh)))
        head = np.array([cx - 0.6 * side, cy - 0.8 * side, cx + 0.6 * side, cy + 0.65 * side])
        # A head cannot stick out of its own person box by more than a small margin.
        margin = 0.1 * side
        return np.array([max(head[0], x1 - margin), max(head[1], y1 - margin),
                         min(head[2], x2 + margin), head[3]])
    height = float(np.clip(0.6 * bw, 0.28 * bh, 0.45 * bh))
    return np.array([x1 + 0.15 * bw, y1, x2 - 0.15 * bw, y1 + height])


# --------------------------------------------------------------------------- tracking


@dataclass
class Track:
    frames: list[int] = field(default_factory=list)
    boxes: list[np.ndarray] = field(default_factory=list)   # normalised x1,y1,x2,y2
    heads: list[np.ndarray] = field(default_factory=list)   # head box relative to the person box
    scores: list[float] = field(default_factory=list)

    def extend(self, other: "Track") -> None:
        self.frames += other.frames
        self.boxes += other.boxes
        self.heads += other.heads
        self.scores += other.scores


def make_tracker(conf: float):
    from ultralytics.trackers.byte_tracker import BYTETracker
    from ultralytics.utils import YAML, IterableSimpleNamespace
    from ultralytics.utils.checks import check_yaml

    cfg = YAML.load(check_yaml("bytetrack.yaml"))
    # A track starts only from a confident detection, but once it exists ByteTrack keeps
    # it alive with weaker ones, and remembers a hidden person for three seconds.
    cfg.update(track_high_thresh=conf, new_track_thresh=conf, track_buffer=3 * OUT_FPS)
    return BYTETracker(IterableSimpleNamespace(**cfg), frame_rate=OUT_FPS)


def track_segment(model, frames, imgsz: int, conf: float, tiles: int, gpu: bool):
    """Detect and track through the segment. Returns the raw tracks and the 640x360 frames."""
    from ultralytics.engine.results import Boxes

    tracker = make_tracker(conf)
    tracks: dict[int, Track] = {}
    small = []
    for t, frame in enumerate(frames):
        h, w = frame.shape[:2]
        boxes, scores, kpts = detect_people(model, frame, imgsz, tracker.args.track_low_thresh,
                                            tiles, gpu)
        dets = Boxes(np.column_stack([boxes, scores, np.zeros(len(boxes))]), (h, w))
        active = tracker.update(dets, frame)
        if len(active) and len(boxes):
            # ByteTrack returns filtered boxes; the detection it used is the one that overlaps most.
            nearest = iou_matrix(active[:, :4], boxes).argmax(1)
            scale = np.array([w, h, w, h])
            for row, d in zip(active, nearest):
                box = boxes[d]
                head = head_box(box, kpts[d])
                size = np.tile(box[2:] - box[:2], 2)
                tr = tracks.setdefault(int(row[4]), Track())
                tr.frames.append(t)
                tr.boxes.append(box / scale)
                tr.heads.append((head - np.tile(box[:2], 2)) / size)
                tr.scores.append(float(scores[d]))
        small.append(cv2.resize(frame, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA))
    return list(tracks.values()), small


def merge_fragments(tracks: list[Track], min_iou: float = 0.3) -> list[Track]:
    """Join tracks that are the same seated person: one ends, another starts in the same place."""
    merged: list[Track] = []
    for tr in sorted(tracks, key=lambda t: t.frames[0]):
        best, best_iou = None, min_iou
        for cand in merged:
            if cand.frames[-1] >= tr.frames[0]:
                continue
            overlap = iou_matrix(cand.boxes[-1][None], tr.boxes[0][None])[0, 0]
            if overlap > best_iou:
                best, best_iou = cand, overlap
        if best is None:
            merged.append(Track(list(tr.frames), list(tr.boxes), list(tr.heads), list(tr.scores)))
        else:
            best.extend(tr)
    return merged


def smooth(values: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing along time (axis 0) with reflected ends."""
    radius = int(3 * sigma)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(values, [(radius, radius)] + [(0, 0)] * (values.ndim - 1), mode="reflect")
    return np.stack([np.convolve(padded[:, i], kernel, mode="valid")
                     for i in range(values.shape[1])], axis=1)


def stabilise(tracks: list[Track], n_frames: int, min_presence: float):
    """Turn raw tracks into a constant set of people.

    Every track is filled by linear interpolation where the detector missed it and smoothed
    over time. Tracks seen in at least `min_presence` of the frames with a mean confidence of
    at least COUNT_CONF become the people of the clip: one steady box in every frame. The
    others (someone walking through, a person hidden most of the time, a weak double of a
    neighbour) are not counted, but if they were in view for half a second or more their
    heads still go into the privacy mask.

    Returns boxes (people, frames, 4), the mean confidence per person, and for every frame
    the list of head regions to hide.
    """
    tracks = merge_fragments(tracks)

    def fill(seen: list[int], rows: list[np.ndarray]) -> np.ndarray:
        rows = np.array(rows)
        return np.stack([np.interp(np.arange(n_frames), seen, rows[:, i]) for i in range(4)], axis=1)

    boxes, conf = [], []
    masks: list[list[np.ndarray]] = [[] for _ in range(n_frames)]
    for tr in tracks:
        box = smooth(fill(tr.frames, tr.boxes), sigma=2.0)
        rel = smooth(fill(tr.frames, tr.heads), sigma=4.0)
        head = np.clip(np.tile(box[:, :2], 2) + rel * np.tile(box[:, 2:] - box[:, :2], 2), 0, 1)
        seen = len(set(tr.frames))
        counted = seen >= min_presence * n_frames and np.mean(tr.scores) >= COUNT_CONF
        if counted:
            boxes.append(np.clip(box, 0, 1))
            conf.append(float(np.mean(tr.scores)))
        elif seen < OUT_FPS // 2:
            continue
        # A counted person is masked for the whole clip, anyone else while they are in view
        # plus a quarter of a second either side.
        first = 0 if counted else max(tr.frames[0] - OUT_FPS // 4, 0)
        last = n_frames - 1 if counted else min(tr.frames[-1] + OUT_FPS // 4, n_frames - 1)
        for t in range(first, last + 1):
            masks[t].append(head[t])
    if not boxes:
        return np.zeros((0, n_frames, 4)), [], masks

    # Two tracks that sit on top of each other for the whole clip are one person.
    boxes = np.array(boxes)
    keep: list[int] = []
    for i in np.argsort(-np.array(conf)):
        if all(np.mean([iou_matrix(boxes[i, t][None], boxes[j, t][None])[0, 0]
                        for t in range(0, n_frames, 5)]) < 0.6 for j in keep):
            keep.append(int(i))
    keep.sort(key=lambda i: (boxes[i, 0, 0], boxes[i, 0, 1]))
    return boxes[keep], [conf[i] for i in keep], masks


# --------------------------------------------------------------------------- video out


def pixelate_heads(frame: np.ndarray, heads: list[np.ndarray]) -> np.ndarray:
    """Replace every head region with a coarse mosaic. Regions snap to the mosaic grid."""
    grid_w, grid_h = OUT_W // MOSAIC, OUT_H // MOSAIC
    coarse = cv2.resize(frame, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    mask = np.zeros((grid_h, grid_w), bool)
    for x1, y1, x2, y2 in heads:
        c1, r1 = int(np.floor(x1 * grid_w)), int(np.floor(y1 * grid_h))
        c2, r2 = int(np.ceil(x2 * grid_w)), int(np.ceil(y2 * grid_h))
        mask[max(r1, 0):max(r2, r1 + 1), max(c1, 0):max(c2, c1 + 1)] = True
    mosaic = cv2.resize(coarse, (OUT_W, OUT_H), interpolation=cv2.INTER_NEAREST)
    mask = cv2.resize(mask.astype(np.uint8), (OUT_W, OUT_H), interpolation=cv2.INTER_NEAREST) > 0
    out = frame.copy()
    out[mask] = mosaic[mask]
    return out


def encode(frames: list[np.ndarray], dst: Path) -> int:
    """Write H.264 / yuv420p / 20 fps with a keyframe every 10 frames. Returns the CRF used.

    The CRF is adjusted until the file lands in SIZE_RANGE; a still, empty room simply
    stays small because there is nothing more to spend bits on.
    """
    crf, tried = 24, set()
    while True:
        tried.add(crf)
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-s", f"{OUT_W}x{OUT_H}", "-r", str(OUT_FPS), "-i", "-", "-an",
               "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
               "-g", "10", "-movflags", "+faststart", str(dst)]
        subprocess.run(cmd, input=b"".join(f.tobytes() for f in frames), check=True)
        size = dst.stat().st_size
        step = 2 if size > SIZE_RANGE[1] else -2 if size < SIZE_RANGE[0] else 0
        if step == 0 or crf + step in tried or not 16 <= crf + step <= 36:
            return crf
        crf += step


def read_video(path: Path) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    return frames


def to_permille(boxes: np.ndarray) -> np.ndarray:
    """x1,y1,x2,y2 in 0-1 -> left, top, width, height in 0-1000."""
    left_top = np.rint(boxes[..., :2] * 1000)
    size = np.rint(boxes[..., 2:] * 1000) - left_top
    return np.concatenate([left_top, size], axis=-1).astype(int)


def write_sheet(dst: Path, clip_id: str, video: list[np.ndarray], doc: dict) -> None:
    """Start, middle and end frame of the encoded clip with the boxes the web app will draw."""
    panels = []
    for f in (0, len(video) // 2, len(video) - 1):
        img = video[f].copy()
        sample = min(f // doc["step"], len(video[::doc["step"]]) - 1)
        for track in doc["tracks"]:
            x, y, w, h = track["b"][4 * sample:4 * sample + 4]
            p1 = (round(x * OUT_W / 1000), round(y * OUT_H / 1000))
            p2 = (round((x + w) * OUT_W / 1000), round((y + h) * OUT_H / 1000))
            cv2.rectangle(img, p1, p2, BOX_COLOUR, 2)
        label = f"{clip_id}  people {doc['people']}  frame {f}/{len(video)}"
        cv2.putText(img, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(img, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        panels.append(img)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), np.hstack(panels), [cv2.IMWRITE_JPEG_QUALITY, 90])


def write_json(dst: Path, doc: dict) -> None:
    """One track per line keeps the file small and still diffable."""
    head = json.dumps({k: v for k, v in doc.items() if k != "tracks"}, indent=2, ensure_ascii=False)
    rows = ",\n".join("    " + json.dumps(t, separators=(",", ":")) for t in doc["tracks"])
    tracks = f"[\n{rows}\n  ]" if rows else "[]"
    dst.write_text(f'{head[:-2]},\n  "tracks": {tracks}\n}}\n', encoding="utf-8")


def write_summary(ids: list[str]) -> None:
    """src/data/clips.json: what the web app needs to list the clips, without the tracks."""
    rows = []
    for clip_id in ids:
        path = FOOTAGE_DIR / f"{clip_id}.json"
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            rows.append({k: doc[k] for k in ("id", "people", "fps", "frames", "w", "h", "source")})
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- one clip


def process_clip(model, gpu: bool, clip: dict, raw_dir: Path, out_dir: Path) -> dict:
    clip_id = clip["id"]
    src = Path(clip["raw"])
    src = src if src.is_absolute() else raw_dir / src
    print(f"[{clip_id}] {src.name}  start {clip['start']} s, {clip['dur']} s")

    frames = read_segment(src, clip["start"], clip["dur"])
    tracks, small = track_segment(model, frames, clip.get("imgsz", 1280),
                                  clip.get("conf", 0.25), clip.get("tiles", 1), gpu)
    boxes, conf, masks = stabilise(tracks, len(small), clip.get("min_presence", 0.6))
    print(f"[{clip_id}] {len(tracks)} raw tracks -> {len(boxes)} people")

    if clip.get("mask", True):
        small = [pixelate_heads(frame, heads) for frame, heads in zip(small, masks)]

    out_dir.mkdir(parents=True, exist_ok=True)
    video_path = out_dir / f"{clip_id}.mp4"
    crf = encode(small, video_path)
    video = read_video(video_path)
    if len(video) != len(small) or video[0].shape[:2] != (OUT_H, OUT_W):
        raise SystemExit(f"{video_path} does not match what was written")

    permille = to_permille(boxes[:, ::STEP])
    doc = {
        "id": clip_id, "w": OUT_W, "h": OUT_H, "fps": OUT_FPS, "frames": len(video),
        "step": STEP, "people": len(boxes),
        "source": clip.get("source", {}),
        "tracks": [{"c": round(c, 2), "b": b.reshape(-1).tolist()} for c, b in zip(conf, permille)],
    }
    write_json(out_dir / f"{clip_id}.json", doc)
    write_sheet(raw_dir / "sheets" / f"{clip_id}.jpg", clip_id, video, doc)
    print(f"[{clip_id}] {len(video)} frames, crf {crf}, {video_path.stat().st_size / 1e6:.2f} MB")
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--all", action="store_true", help="process every clip in clips.json")
    ap.add_argument("--only", nargs="*", help="with --all: just these ids")
    ap.add_argument("--raw-dir", type=Path, default=REPO.parent / "footage-raw",
                    help="folder with the raw downloads; sheets/ and weights/ live there too")
    ap.add_argument("--out-dir", type=Path, default=FOOTAGE_DIR,
                    help="where <id>.mp4 and <id>.json go (default: public/footage)")
    ap.add_argument("--src", help="raw video, absolute or relative to --raw-dir")
    ap.add_argument("--id")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--dur", type=float, default=9.0)
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--tiles", type=int, default=1, help="n x n extra detection tiles for packed rooms")
    ap.add_argument("--min-presence", type=float, default=0.6)
    ap.add_argument("--no-mask", action="store_true", help="leave the heads visible")
    for key in ("title", "url", "author", "licence"):
        ap.add_argument(f"--{key}", default="")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else []
    if args.all:
        clips = [c for c in manifest if not args.only or c["id"] in args.only]
    elif args.src and args.id:
        clips = [{
            "id": args.id, "raw": args.src, "start": args.start, "dur": args.dur,
            "imgsz": args.imgsz, "conf": args.conf, "tiles": args.tiles,
            "min_presence": args.min_presence, "mask": not args.no_mask,
            "source": {k: getattr(args, k) for k in ("title", "url", "author", "licence")},
        }]
    else:
        ap.error("give --all, or --src and --id")

    model, name, gpu = load_model(args.raw_dir / "weights")
    print(f"model {name} on {'GPU' if gpu else 'CPU'}")
    order = [c["id"] for c in manifest] + [c["id"] for c in clips]
    for clip in clips:
        process_clip(model, gpu, clip, args.raw_dir, args.out_dir)
        if args.out_dir.resolve() == FOOTAGE_DIR.resolve():
            write_summary(list(dict.fromkeys(order)))


if __name__ == "__main__":
    main()
