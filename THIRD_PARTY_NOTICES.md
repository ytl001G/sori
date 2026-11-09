# Third-party notices

Sori itself is under the MIT License (`LICENSE`). It ships these libraries unmodified, each under its own license.
Most license texts come with each package (`node_modules/<package>/`, inside the installed app's `resources/app.asar`);
the ones a package does not ship are in `licenses/` (also inside `app.asar`): the LGPL-3.0 and GPL-3.0 texts for lamejs,
whose own LICENSE file is only the LAME FAQ, and the MIT texts of fft.js and worker-f.

| Library | Used for | License | Copyright | Source |
|---|---|---|---|---|
| @breezystack/lamejs 1.2.7 | MP3 export | LGPL-3.0 (`licenses/LGPL-3.0.txt`, `licenses/GPL-3.0.txt`) | Alex Zhukov and contributors (a fork of zhuker/lamejs, based on LAME) | https://github.com/shijinyu/lamejs |
| soundtouchjs 0.3.0 | tempo and pitch changes | LGPL-2.1 | Steve 'Cutter' Blades and contributors (a port of SoundTouch by Olli Parviainen) | https://github.com/cutterbl/SoundTouchJS |
| fft.js 4.0.4 | spectrum, noise reduction | MIT (`licenses/fft.js-MIT.txt`) | Copyright Fedor Indutny, 2017 | https://github.com/indutny/fft.js |
| read-excel-file 9.3.14 | reading .xlsx scripts | MIT | Copyright (c) 2018 gitlab.com/catamphetamine | https://gitlab.com/catamphetamine/read-excel-file |
| fflate 0.8.3 | used by read-excel-file (unzip .xlsx) | MIT | Copyright (c) 2026 Arjun Barrett | https://github.com/101arrowz/fflate |
| saxen 11.2.0 | used by read-excel-file (XML) | MIT | Copyright (c) 2012 Vopilovskii Konstantin, (c) 2017-present Nico Rehwaldt | https://github.com/nikku/saxen |
| unzipper-esm 0.13.3 | used by read-excel-file (unzip) | MIT | Copyright (c) 2012 - 2013 Near Infinity Corporation | https://github.com/catamphetamine/node-unzipper |
| worker-f 0.1.21 | used by read-excel-file | MIT (`licenses/worker-f-MIT.txt`) | catamphetamine | https://gitlab.com/catamphetamine/worker-f |
| graceful-fs 4.2.11 | used by unzipper-esm | ISC | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors | https://github.com/isaacs/node-graceful-fs |
| node-int64 0.4.0 | used by unzipper-esm | MIT | Copyright (c) 2014 Robert Kieffer | https://github.com/broofa/node-int64 |
| @phosphor-icons/core 2.1.1 | icons | MIT | Copyright (c) 2023 Phosphor Icons | https://github.com/phosphor-icons/phosphor-core |
| Pretendard 1.3.9 | UI font | SIL Open Font License 1.1 (`node_modules/pretendard/dist/LICENSE.txt`) | Copyright (c) 2021, Kil Hyung-jin | https://github.com/orioncactus/pretendard |
| Electron | the app shell | MIT (Chromium and others: `LICENSES.chromium.html` next to `Sori.exe`) | GitHub Inc. and contributors | https://github.com/electron/electron |

## LGPL libraries (lamejs, soundtouchjs)

They are used as separate, unmodified JavaScript files, loaded at run time. You may replace them with your own
build of the same library: in a source checkout, change the package in `node_modules/`; in the installed app, unpack
`resources/app.asar` (`npx @electron/asar extract app.asar app`), replace the file under `node_modules/`, and pack it
again. Their source code is at the links above.
