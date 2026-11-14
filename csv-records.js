'use strict';

function csvRecords(input) {
  const records = [];
  let record = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      record += char;
      if (quoted && input[i + 1] === '"') {
        record += input[i + 1];
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === '\n' || char === '\r') && !quoted) {
      records.push(record);
      record = '';
      if (char === '\r' && input[i + 1] === '\n') i += 1;
    } else {
      record += char;
    }
  }

  if (record || records.length === 0) records.push(record);
  return records;
}

function csvColumns(record) {
  let columns = 1;
  let quoted = false;
  for (let i = 0; i < record.length; i += 1) {
    const char = record[i];
    if (char === '"' && record[i + 1] === '"') i += 1;
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) columns += 1;
  }
  return columns;
}

module.exports = { csvColumns, csvRecords };
