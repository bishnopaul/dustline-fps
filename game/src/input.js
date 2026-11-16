// input.js — keyboard and mouse state, and the pointer-lock plumbing. The simulation reads
// held keys every step and edge-triggered presses once per frame; mouse movement is
// accumulated between frames and consumed by the player controller.

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  let dx = 0, dy = 0;
  let firing = false;
  let locked = false;

  const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE',
    'KeyG', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4']);

  addEventListener('keydown', e => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    held.add(e.code);
  });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('blur', () => { held.clear(); firing = false; });

  canvas.addEventListener('mousedown', e => { if (locked && e.button === 0) firing = true; });
  addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
  addEventListener('mousemove', e => {
    if (!locked) return;
    dx += e.movementX || 0;
    dy += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    if (input.onLockChange) input.onLockChange(locked);
  });

  const input = {
    held, pressed,
    onLockChange: null,
    get firing() { return firing; },
    get locked() { return locked; },
    lock() { canvas.requestPointerLock(); },
    unlock() { document.exitPointerLock(); },
    // mouse delta since the last call, in pixels
    takeMouse() {
      const out = { dx, dy };
      dx = 0; dy = 0;
      return out;
    },
    // was this code newly pressed since the last call?
    takePress(code) {
      const had = pressed.has(code);
      if (had) pressed.delete(code);
      return had;
    },
    clearPresses() { pressed.clear(); },
  };
  return input;
}
