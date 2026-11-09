# Sori

[한국어](README.md)

A multitrack voice editor for Windows: record, cut, clean up and export. The interface is in Korean, with common
shortcuts and only the features that matter. It has a **script recording mode** for delivering one file per line
(game and animation voice work) and a **command line (CLI)** that lets an AI work on projects from a terminal.

## Features

- **Multitrack editing**: move, split, trim and merge clips; delete, keep or insert silence in a range; clip volume and
  fades; markers; tempo (BPM) and a beat grid. Every edit can be undone with Ctrl+Z
- **Recording**: input choice, count-in, metronome, automatic latency measurement
- **Effects**: always-on track and master effects (EQ, compressor, de-esser, hum removal, reverb, echo) and effects
  that change the sound itself (gain, normalize, fades, tempo, pitch, noise reduction…)
- **Voice cleanup**: one pass for noise, rumble, evening out, shortening long pauses and loudness
- **Script recording mode**: load a .txt / .csv / .xlsx script, record takes for each line, star the best one and
  export one file per line
- **Export**: WAV (16/24-bit), MP3 (128/192/320 kbps): the whole project, a range, one track, marker segments, per line
- **Safety**: autosave with crash recovery, and the last 10 automatic backups per project
- **CLI for AIs**: edit a `.vproj` without the app, or drive the running app (`sori live …`). Every command prints
  one JSON line

## Install

Windows 10/11 (64-bit). The installer is coming soon; for now, run it from source (below).

## Run from source

You need:
- Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org) 22.12 or newer (comes with npm)
- [Git](https://git-scm.com) (or Code → Download ZIP on GitHub)
- An internet connection for the first `npm install` and the first `npm start` only. The app itself never goes online
- About 600 MB of disk (libraries about 230 MB + Electron, downloaded on the first start, about 360 MB)

```
git clone https://github.com/ytl001G/sori.git
cd sori
npm install
npm start          # run the app (the first start downloads Electron, so it takes a moment)
npm test           # self-checks for editing, effects and file formats (Node only)
npm run smoke      # starts the app and checks import → edit → effects → export → save
npm run dist       # build the Windows installer into dist/ (the first build downloads its tools)
```

## CLI for AIs

```
node src/cli/sori.js --help
node src/cli/sori.js info project.vproj
node src/cli/sori.js apply script.vproj voiceClean --all-lines
node src/cli/sori.js live state          # what the running app has open
```

Full guide: [docs/cli.md](docs/cli.md)

## Documents

The feature spec is in Korean (`docs/spec.md`); `docs/architecture.md`, `docs/ui-guide.md` and `docs/cli.md`
are in English.

## Privacy

Sori never connects to the internet. Recordings, projects, settings, autosave and backups stay on your computer
(settings, autosave and backups in `%APPDATA%\Sori`). Nothing is collected or sent.

## License

[MIT](LICENSE). The bundled libraries (the lamejs MP3 encoder, soundtouchjs for tempo and pitch, and others) keep their
own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The software is provided "as is", without warranty of any kind. Keep copies of recordings that matter.
