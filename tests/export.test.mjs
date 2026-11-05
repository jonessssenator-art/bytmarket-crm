import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { makeXlsx } from "../web/src/export-xlsx.mjs";
test("Excel export preserves numbers, Cyrillic and treats spreadsheet injection as text", () => {
  const zip = unzipSync(
    makeXlsx(
      ["Товар", "Остаток"],
      [
        ["Мыло & <лимон>", 49],
        ['=HYPERLINK("evil")', 0],
      ],
    ),
  );
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Мыло &amp; &lt;лимон&gt;/);
  assert.match(sheet, /<v>49<\/v>/);
  assert.match(sheet, /t="inlineStr"[^>]*><is><t[^>]*>=HYPERLINK/);
  assert.ok(!sheet.includes("<f>"));
  assert.ok(zip["[Content_Types].xml"]);
});
