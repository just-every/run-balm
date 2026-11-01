const NativeDate = Date
const supervisionNow = Date.parse('2026-11-15T06:15:00.000Z')

// Share one offset across Node and workerd. Time still advances, preserving the
// order of returned/resubmitted signatures and real session expiry checks.
export function pinSupervisionClock(offset = supervisionNow - NativeDate.now()) {
  const previous = globalThis.Date
  class SupervisionDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [SupervisionDate.now()])) }
    static now() { return NativeDate.now() + offset }
  }
  globalThis.Date = SupervisionDate
  return { offset, restore: () => { globalThis.Date = previous } }
}
