/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert";
import { hello } from "../mod.ts";

Deno.test("hello", () => {
  assertEquals(hello(), "Hello!");
});
