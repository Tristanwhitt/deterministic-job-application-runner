'use strict';

const assert = require('assert');
const { csvColumns, csvRecords } = require('../csv-records');

const header = Array.from({ length: 24 }, (_, index) => `column_${index + 1}`).join(',');
const fields = Array.from({ length: 24 }, (_, index) => `value_${index + 1}`);
fields[2] = '"comma, retained"';
fields[8] = '"line one\nline two"';
fields[15] = '"escaped ""quote"" retained"';
const row = fields.join(',');
const records = csvRecords(`${header}\r\n${row}\r\n`);

assert.strictEqual(records.length, 2);
assert.strictEqual(csvColumns(records[0]), 24);
assert.strictEqual(csvColumns(records[1]), 24);
assert.match(records[1], /line one\nline two/);

console.log('csv-records regression: ok');
