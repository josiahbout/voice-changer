# Voice samples

`<voice id>.mp3` is what the speaker button on each voice card plays (see "Voice previews"
in `../app.js`). Each one is a test recording from `../../voices/test_audio/` converted to
that voice: male voices convert the female recording, female voices the male one, at the
voice's starting pitch for that case (`VOICES` / `RANGE_PITCH` in `app.js`), with the app's
default quality settings. Loudness is evened out across samples.

`original-male.mp3` and `original-female.mp3` are copies of those two recordings, played
when the sample bubble's "Original audio" box is ticked.

Re-make them after adding or changing a voice, with a voice server running:

```bash
..\..\server\.venv\Scripts\python.exe make_previews.py
```

`--port 18889` uses a separate server (so a running VoicePlay isn't disturbed), and
`--only gamer,shy` re-makes just those voices. Only the `.mp3` files ship with the app.
