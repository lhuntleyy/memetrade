import { expect, test } from "bun:test";
import { pgTextArray } from "../src/pg.ts";

test("pgTextArray: kosong, biasa, karakter khusus", () => {
  expect(pgTextArray([])).toBe("{}");
  expect(pgTextArray(["a:null", "b:gte"])).toBe('{"a:null","b:gte"}');
  expect(pgTextArray(['x"y', "c\\d"])).toBe('{"x\\"y","c\\\\d"}');
});
