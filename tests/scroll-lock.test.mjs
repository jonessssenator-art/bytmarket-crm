import test from "node:test";
import assert from "node:assert/strict";
import { lockPageScroll } from "../web/src/scroll-lock.mjs";
function body(value = "", priority = "") {
  return {
    style: {
      getPropertyValue: () => value,
      getPropertyPriority: () => priority,
      setProperty: (_, v, p = "") => {
        value = v;
        priority = p;
      },
      removeProperty: () => {
        value = "";
        priority = "";
      },
    },
  };
}
test("nested dialogs keep scrolling locked until last unmount in either order", () => {
  for (const parentFirst of [true, false]) {
    const b = body();
    const parent = lockPageScroll(b),
      child = lockPageScroll(b);
    (parentFirst ? parent : child)();
    assert.equal(b.style.getPropertyValue("overflow"), "hidden");
    (parentFirst ? child : parent)();
    assert.equal(b.style.getPropertyValue("overflow"), "");
    parent();
    child();
    const next = lockPageScroll(b);
    next();
    assert.equal(b.style.getPropertyValue("overflow"), "");
  }
});
test("scroll lock preserves original inline setting and independent documents", () => {
  const a = body("auto", "important"),
    b = body("scroll");
  const releaseA = lockPageScroll(a),
    releaseB = lockPageScroll(b);
  releaseA();
  assert.equal(a.style.getPropertyValue("overflow"), "auto");
  assert.equal(a.style.getPropertyPriority("overflow"), "important");
  assert.equal(b.style.getPropertyValue("overflow"), "hidden");
  releaseB();
  assert.equal(b.style.getPropertyValue("overflow"), "scroll");
});
