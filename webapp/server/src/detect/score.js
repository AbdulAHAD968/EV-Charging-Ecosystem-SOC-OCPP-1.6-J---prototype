// Pure scoring math: turns a list of alerts (plus optional attack time windows)
// into the Score shape described in CONTRACT.md. No I/O, no bus calls here.

// Expected rule ids per scenario (same as siem/detect.py).
export const EXPECTED_RULES = {
  A1: [100110, 100111, 100112, 100113],
  A2: [100111, 100120, 100121, 100122, 100123, 100124, 100125],
  A3: [100130, 100131, 100132, 100133, 100135],
};

/**
 * Compute the score for one scenario given its alerts and its time window.
 * window: {start, end} as ISO strings or ms epoch, or null if the attack has not run.
 * Returns {state, first_alert_s, time_to_detect_s, rules_expected, rules_fired, recall, alerts}.
 */
function scoreScenario(scenario, allAlerts, window) {
  const expected = EXPECTED_RULES[scenario] || [];
  if (!window || window.start == null) {
    return {
      state: 'idle',
      first_alert_s: null,
      time_to_detect_s: null,
      rules_expected: expected,
      rules_fired: [],
      recall: 0,
      alerts: 0,
    };
  }
  const startMs = toMs(window.start);
  const endMs = window.end != null ? toMs(window.end) : Infinity;
  // give a little grace after the window ends, mirrors siem/detect.py's +90s
  const graceMs = endMs === Infinity ? Infinity : endMs + 90_000;

  // Rule 100111 (session from a non-registered address) is a shared indicator that can
  // legitimately apply to A1, A2 or A3 (CONTRACT.md). Attribute it by which window it
  // falls inside rather than trusting the alert's fixed display scenario tag; every other
  // rule id belongs to exactly one scenario, so the tag match is still correct for those.
  const inWindow = allAlerts.filter((a) => {
    const t = toMs(a.ts);
    if (t == null || t < startMs || t > graceMs) return false;
    if (a.ruleId === 100111) return expected.includes(100111);
    return a.scenario === scenario;
  });

  const firedSet = new Set(inWindow.map((a) => a.ruleId));
  const rulesFired = [...firedSet].sort((a, b) => a - b);
  const recall = expected.length ? Math.round((rulesFired.filter((r) => expected.includes(r)).length / expected.length) * 100) / 100 : 0;

  let firstAlertS = null;
  let timeToDetectS = null;
  if (inWindow.length) {
    const firstMs = Math.min(...inWindow.map((a) => toMs(a.ts)));
    firstAlertS = Math.round((firstMs - startMs) / 100) / 10;
    timeToDetectS = firstAlertS;
  }

  return {
    state: window.end != null ? 'done' : 'running',
    first_alert_s: firstAlertS,
    time_to_detect_s: timeToDetectS,
    rules_expected: expected,
    rules_fired: rulesFired,
    recall,
    alerts: inWindow.length,
  };
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Compute the full score object across all three scenarios.
 * windows: {A1: {start,end}|null, A2: {...}|null, A3: {...}|null}
 * Alerts outside every window count as false positives; the rest count as benign-adjacent true positives.
 */
export function computeScore(alerts, windows = {}) {
  const A1 = scoreScenario('A1', alerts, windows.A1);
  const A2 = scoreScenario('A2', alerts, windows.A2);
  const A3 = scoreScenario('A3', alerts, windows.A3);

  const inAnyWindow = (a) => {
    for (const scen of ['A1', 'A2', 'A3']) {
      const w = windows[scen];
      if (!w || w.start == null) continue;
      if (a.ruleId === 100111) {
        if (!EXPECTED_RULES[scen].includes(100111)) continue;
      } else if (a.scenario !== scen) continue;
      const startMs = toMs(w.start);
      const endMs = w.end != null ? toMs(w.end) + 90_000 : Infinity;
      const t = toMs(a.ts);
      if (t != null && t >= startMs && t <= endMs) return true;
    }
    return false;
  };

  const falsePositives = alerts.filter((a) => !inAnyWindow(a)).length;
  const benignEvents = alerts.filter((a) => inAnyWindow(a)).length;

  return {
    type: 'score',
    A1,
    A2,
    A3,
    total_alerts: alerts.length,
    false_positives: falsePositives,
    benign_events: benignEvents,
  };
}

// The live engine does not yet know attack start/stop times on its own;
// attacks/index.js tracks them and the server wires them in. Until then,
// getScore() in engine.js calls computeScore(alerts) with no windows,
// which still reports rules fired per scenario, just without timing/FP split.
let lastWindows = {};

/** Record (or clear) the currently known attack windows, used by getScore(). */
export function setWindows(windows) {
  lastWindows = windows || {};
}

/** Return the last computed score, using whatever windows were last set. */
export function getScore(alerts) {
  return computeScore(alerts, lastWindows);
}
