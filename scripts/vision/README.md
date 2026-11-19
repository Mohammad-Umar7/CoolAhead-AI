# Vision step: counting people in a room

`detect.py` turns a raw stock clip into what the web app plays: a short, privacy-masked video
and a JSON file with one bounding box per person per frame. The number of people it reports is
the occupancy that CoolAhead AI feeds into the cooling decision for that zone.

Nothing is trained here. The detector is a stock pretrained model.

## What it does to a clip

1. **Cut.** ffmpeg takes the chosen segment, centre-crops it to 16:9 and resamples it to 20 fps.
   Detection runs on that segment at up to 1920 px wide; the web version is 640x360.
2. **Detect.** `yolo11x-pose.pt` (Ultralytics YOLO11 pose, pretrained on COCO, person class only)
   runs on every frame at `imgsz=1280`. For packed rooms (`"tiles": 2`) it also runs on a 2x2 grid
   of overlapping tiles so that small, distant people are seen at a larger scale; the tile and
   full-frame detections are merged with NMS.
3. **Track.** ByteTrack (the Ultralytics implementation, `bytetrack.yaml`) links the detections
   over time. A track starts at confidence 0.25 and is then kept alive by weaker detections.
4. **Stabilise.** Fragments of the same seated person are joined, gaps are filled by linear
   interpolation and the boxes are smoothed over time. A track counts as a person when it is seen
   in at least 60 % of the frames with a mean confidence of at least 0.3. The result is a constant
   number of boxes for the whole clip, and that number is the people count.
5. **Mask.** Every head is replaced by an 8 px mosaic, baked into the video. The head region
   comes from the pose keypoints (nose, eyes, ears) when they are confident and from the top of
   the person box otherwise, which also covers people seen from behind. Heads of people who are
   not counted (someone passing through, for example) are masked as well.
6. **Write.** `public/footage/<id>.mp4` (H.264, yuv420p, 640x360, 20 fps, no audio, keyframe every
   10 frames, faststart) and `public/footage/<id>.json`. The script reads the encoded file back and
   refuses to continue if the frame count or size differs from what it wrote.

The boxes are not drawn into the video. The web app draws them from the JSON.

## Output format

```json
{ "id": "a301", "w": 640, "h": 360, "fps": 20, "frames": 180, "step": 2, "people": 19,
  "source": { "title": "...", "url": "https://...", "author": "...", "licence": "..." },
  "tracks": [ { "c": 0.91, "b": [x, y, w, h, x, y, w, h, ...] } ] }
```

`b` holds one box for every `step`-th frame (frames 0, 2, 4, ...), as left, top, width, height in
per-mille of the frame. `c` is the mean detection confidence of the track.
`src/data/clips.json` lists every clip with the same fields except `tracks`.

For each clip a contact sheet goes to `<raw-dir>/sheets/<id>.jpg`: the first, middle and last
frame of the encoded video with the boxes on top, for checking the result by eye.

## Regenerating

Requirements: Python 3.11, `ultralytics`, `opencv-python`, `lap` (ByteTrack's assignment solver)
and `ffmpeg` on the PATH. torch 2.3 needs `numpy < 2`; on the development machine the global
numpy is 2.x, so the script runs from a small venv that sits next to the raw footage:

```bash
python -m venv --system-site-packages ../footage-raw/.venv
../footage-raw/.venv/Scripts/python -m pip install "numpy<2" "lap>=0.5.12"
```

The raw downloads are not in the repository. Save each one from its source page (table below)
into the raw folder under the file name given in `clips.json`. Then, from the repository root:

```bash
# every clip in scripts/vision/clips.json, plus src/data/clips.json
../footage-raw/.venv/Scripts/python scripts/vision/detect.py --all --raw-dir ../footage-raw

# only some of them
../footage-raw/.venv/Scripts/python scripts/vision/detect.py --all --only a301 empty2

# a clip that is not in the manifest
../footage-raw/.venv/Scripts/python scripts/vision/detect.py --src pexels-10602890.mp4 --id a303 \
    --start 0 --dur 10 --title "Students in Class" --author "Vincuk Konan" \
    --url https://www.pexels.com/video/students-in-class-10602890/ --licence "Pexels License"
```

Other options: `--tiles 2`, `--imgsz`, `--conf`, `--min-presence`, `--no-mask`, `--out-dir`.
The model weights download from the official Ultralytics release on first use into
`<raw-dir>/weights`. On an RTX 4070 laptop GPU a 9 s clip takes about 25 s, or about 100 s
with tiles.

## Clips and credits

| Clip | Shows | People | Source | Author | Licence |
|---|---|---|---|---|---|
| `a302` | Conference hall seen from the back | 36 | [Audience raise hands at business conference](https://mixkit.co/free-stock-video/audience-raise-hands-at-business-conference-13192/) | Mixkit | Mixkit Restricted License |
| `a301` | University lecture hall seen from the back | 19 | [Medical lecture at a University](https://mixkit.co/free-stock-video/medical-lecture-at-a-university-27729/) | Mixkit | Mixkit Restricted License |
| `a303` | Classroom, students at their desks | 10 | [Students in Class](https://www.pexels.com/video/students-in-class-10602890/) | Vincuk Konan | Pexels License |
| `empty1` | Empty hall with rows of seats | 0 | [Empty Conference Room with Red Press Background](https://www.pexels.com/video/empty-conference-room-with-red-press-background-34199357/) | Tomaž Rakovec | Pexels License |
| `empty2` | Empty classroom | 0 | [Empty Classroom](https://www.pexels.com/video/empty-classroom-5734765/) | Pavel Danilyuk | Pexels License |
| `empty3` | Empty classroom | 0 | [Empty Classroom with Desks and Whiteboard](https://www.pexels.com/video/empty-classroom-with-desks-and-whiteboard-40205134/) | Elements Interactive | Pexels License |

Licence note. The Pexels License allows free use and modification. The two Mixkit clips are the
free 720p downloads, which Mixkit offers "for personal use only" under its Restricted License.
Read <https://mixkit.co/license/> before publishing them or using them commercially.
If that licence does not fit, these Pexels-licensed clips can take the two slots instead
(less classroom-like, same pipeline):

```bash
../footage-raw/.venv/Scripts/python scripts/vision/detect.py --src pexels-34495148.mp4 --id a302 \
    --start 0 --dur 9 --tiles 2 --title "School Assembly with Engaged Audience and Presenters" \
    --author "JMT 35" --licence "Pexels License" \
    --url https://www.pexels.com/video/school-assembly-with-engaged-audience-and-presenters-34495148/
../footage-raw/.venv/Scripts/python scripts/vision/detect.py --src pexels-34013015.mp4 --id a301 \
    --start 0 --dur 6.4 --tiles 2 --title "Engaging Conference Room Presentation with Audience" \
    --author "Airam Dato-on" --licence "Pexels License" \
    --url https://www.pexels.com/video/engaging-conference-room-presentation-with-audience-34013015/
```

## Known limits

- In a packed room the count is a lower bound. People far from the camera whose head is only a
  few pixels wide, or who are hidden behind others, are missed.
- The stabilisation assumes that the people stay in view. Pick a segment where the camera
  barely moves; a pan makes people enter and leave, and they are then not counted.
- The empty-room clips went through the same detector and came out with zero tracks.
