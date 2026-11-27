# SPACE GLIDER

A neon vector shooter for the browser — an original homage to the wireframe cockpit games of the
16-bit era and the vector arcade cabinets before them. No build step, no dependencies, no assets:
every line, sound and note is generated at runtime.

## Play

Open `index.html` in a desktop browser (double-click works; no server needed).

| Input | Action |
| --- | --- |
| Mouse / arrow keys (A, D also yaw) | Steer |
| W / S | Throttle |
| Space / left click | Lasers (aim-assisted; they drain energy) |
| F / right click | Homing missile (4 per sector) |
| P, Esc | Pause |
| N | Sound: all → effects only → muted |
| I | Invert pitch |
| C | CRT overlay on/off |

Clicking captures the mouse for mouse-look. If the browser refuses pointer lock, the game falls
back to a virtual stick: the further the cursor is from the crosshair, the harder you turn. Touch
works in a basic way (drag to steer and fire, second finger for a missile).

## The loop

Each sector has three beats, then repeats harder with a new palette:

1. **Hunt** — free flight over the grid. Destroy the hostile quota: Darts (fighters), Crawlers
   (ground armour), Spires (gun towers), and later Wisps (seeker mines) and Hunters (burst-firing
   heavies). Plasma bolts can be shot down. Some kills drop energy cells that restore shield.
2. **Gate** — a rift gate opens; follow the marker and fly through the ring.
3. **Rift** — dodge barriers and wall turrets down the tunnel, then destroy the Core.

Clearing a sector pays shield and missile bonuses, tops up 40 shield and restocks missiles.
There is one life; the top five scores are kept in `localStorage`.

## Code map

| File | What's in it |
| --- | --- |
| `js/core.js` | Math helpers, input, camera/projection, the stroke font, and the renderer |
| `js/audio.js` | WebAudio effects, engine drone and the step-sequenced soundtrack |
| `js/models.js` | Wireframe models (vertex + edge lists) |
| `js/game.js` | State, flight model, enemy AI, weapons, HUD, screens, main loop |
| `test/smoke.js` | Headless end-to-end test |

Rendering notes worth knowing before changing `core.js`:

- Everything is drawn additively into an off-screen buffer, bloomed with two downsampled copies,
  then blended onto the visible canvas over a faded previous frame (`lighten`), which gives
  phosphor trails without brightness build-up.
- Lines go through a small `pen` recorder and are stroked **one segment per path**. On a
  GPU-backed canvas that is 10–80× faster than one large multi-segment path (measured: 1500
  segments in ~1 ms versus ~13 ms).
- If the frame rate stays under 40 fps for a few seconds the game steps quality down on its own:
  device-pixel ratio, then the phosphor blend, then the bloom.

## Test

```
node test/smoke.js
```

Runs the real game scripts against stub DOM / canvas / WebAudio objects and plays a whole session:
title → launch → hunt → gate → rift → Core → sector 2 → death → initials → title. It fails on any
exception, any non-finite number reaching the canvas, or a broken state transition.

For eyeballing a scene, append a hash to the URL: `#demo=surface`, `gate`, `rift`, `boss` or
`over`; add `&fire` to hold the trigger.
