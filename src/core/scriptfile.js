// Reading a script file for 대본 넣기 and `sori script import` (spec §5-5). Plain Node: fs + read-excel-file.
// .xlsx = the first sheet; .txt / .csv / .tsv are decoded as UTF-8, else CP949 (core/script.js).
const fs = require('fs');
const SC = require('./script');

async function readScript(file) {
  if (/\.xlsx$/i.test(file)) return SC.fromTable(await require('read-excel-file/node').readSheet(file));
  const s = SC.decodeText(await fs.promises.readFile(file));
  return /\.txt$/i.test(file) ? SC.fromTxt(s) : SC.fromTable(SC.parseCsv(s));
}

module.exports = { readScript };
