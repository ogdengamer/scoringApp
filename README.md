# Score Dial

A board game score keeper for Android (and any phone browser) built around a rotary dial.

- **Turn clockwise** to add points, **counter-clockwise** to subtract. The pending change shows in the centre in green or red.
- **Slow turns** move about one point per 20°. **Fast spins** speed up, so big swings are quick.
- **Lift your finger** to add the change to the selected player's score.
- **Tap a player** to select them. Tap the selected player again, or long-press any player, to rename, recolour or remove them.
- **−1 / +1** buttons nudge the score and apply it automatically after a short pause. **Undo** reverts the last change.
- The game is saved on the device and works offline. It is an installable PWA.

**Live app:** https://ogdengamer.github.io/scoringApp/

## Install on Android
1. Open the live URL in Chrome.
2. Open the ⋮ menu and choose **Install app** (or **Add to Home screen**).
3. It then launches full-screen like a native app.

## Develop
It is plain HTML/CSS/JS with no build step.

```sh
python3 -m http.server 8000      # then open http://localhost:8000
node tests/run.mjs               # unit tests (or open http://localhost:8000/tests/)
python3 tools/make_icons.py      # regenerate icons/
```

To try a local build on a phone, use `adb reverse tcp:8000 tcp:8000` and open `http://localhost:8000` in the phone's Chrome. Installing a PWA needs HTTPS or localhost.

### Tuning the dial feel
The constants are in `DIAL_DEFAULTS` at the top of [js/dial.js](js/dial.js):

| Setting | Effect |
|---|---|
| `basePointsPerRad` | Slow-speed sensitivity. 2.9 ≈ 1 point per 20°. |
| `speedGain` | How strongly speed accelerates the count. |
| `maxPointsPerRad` | Cap for fast spins. |

### Shipping changes
Bump `CACHE` in [sw.js](sw.js) whenever app files change, so installed copies pick up the new version.
