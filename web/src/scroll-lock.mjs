// A page may have several nested dialogs. Restore scrolling only after the
// last dialog closes, even when a route unmounts them in parent-first order.
const locks = new WeakMap();
export function lockPageScroll(body) {
  let state = locks.get(body);
  if (!state) {
    state = {
      count: 0,
      value: body.style.getPropertyValue("overflow"),
      priority: body.style.getPropertyPriority("overflow"),
    };
    locks.set(body, state);
    body.style.setProperty("overflow", "hidden");
  }
  state.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count) return;
    if (state.value)
      body.style.setProperty("overflow", state.value, state.priority);
    else body.style.removeProperty("overflow");
    locks.delete(body);
  };
}
