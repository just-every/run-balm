import worker from './worker'
import { pinSupervisionClock } from './supervision-clock.mjs'

// Only CHART-008 uses this entry point; production has no clock override.
export default {
  fetch(request: Request, env: Parameters<typeof worker.fetch>[1] & { SUPERVISION_TEST_CLOCK_OFFSET: string }) {
    pinSupervisionClock(Number(env.SUPERVISION_TEST_CLOCK_OFFSET))
    return worker.fetch(request, env)
  }
}
