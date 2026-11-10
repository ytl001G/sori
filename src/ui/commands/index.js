// Every user action as a named command. Menus, shortcuts, buttons, the context menu and sori live call these.
// Each group registers its commands in core.cmds: play, record, script, files, export, edit, tracks, effects,
// markers, view, voice (목소리 정리), backup (자동 백업); take.js takes a sori live file command's result.
const { cmds, run, curLine } = require('./core');
const { tick, seek, audible, syncMetro } = require('./play');
const { recInfo, recTrim } = require('./record');
const { takeCount, goLine, visibleLines, lineAfter, setScriptView, setStar, importScript } = require('./script');
const F = require('./files');
require('./outside'); // the window's X, a file opened from outside
const { markerSegments } = require('./export');
require('./edit');
const { removeTrack, moveTrack, mixer, setFx, showFx, fxKey } = require('./tracks');
const { FADE_SHAPES, shapeOf, setFadeShape } = require('./effects');
const { moveMarker, setTempo } = require('./markers');
require('./view');
require('./voice');
const { backupNow, EVERY_MS: BACKUP_MS } = require('./backup');
const { takeProject } = require('./take');
const { cue, cueNextLine } = require('./longrec');

module.exports = {
  cmds, run, tick, seek, syncMetro, audible, recInfo, recTrim, markerSegments, takeProject,
  importAudio: F.importAudio, openProject: F.openProject, openRecent: F.openRecent, confirmDiscard: F.confirmDiscard,
  writeProject: F.writeProject, autosave: F.autosave, clearAutosave: F.clearAutosave,
  recoverAutosave: F.recoverAutosave, backupNow, BACKUP_MS,
  removeTrack, moveTrack, mixer, setFx, showFx, fxKey, FADE_SHAPES, setFadeShape, shapeOf, setTempo, moveMarker,
  curLine, cue, cueNextLine, takeCount, goLine, visibleLines, lineAfter, setScriptView, setStar, importScript,
};
