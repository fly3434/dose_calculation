(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NSFlow = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const shifts = [
    { id: 'day', title: '日班', interval: '08:00-15:59', start: 0, end: 8 },
    { id: 'evening', title: '小夜班', interval: '16:00-23:59', start: 8, end: 16 },
    { id: 'night', title: '大夜班', interval: '24:00-隔日07:59', start: 16, end: 24 }
  ];
  const maximumNumericRate = Math.floor(Number.MAX_SAFE_INTEGER / 24);

  function calculate({ currentRate, targetBags, elapsedHours, overrides = {} }) {
    if (!Number.isInteger(currentRate) || currentRate < 1 || currentRate > 500) throw new RangeError('目前流速無效');
    if (!Number.isFinite(targetBags) || targetBags < 0.5 || targetBags > 24 || !Number.isInteger(targetBags * 2)) throw new RangeError('袋數無效');
    if (!Number.isInteger(elapsedHours) || elapsedHours < 0 || elapsedHours > 24) throw new RangeError('變更時間無效');
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('手動設定無效');
    for (const [id, rate] of Object.entries(overrides)) {
      if (!shifts.some(shift => shift.id === id) || !Number.isFinite(rate) || rate < 0 || rate > maximumNumericRate) {
        throw new RangeError('手動流速無效');
      }
    }
    const targetVolume = targetBags * 500;
    const infusedVolume = currentRate * elapsedHours;
    const remainingVolume = targetVolume - infusedVolume;
    const plans = shifts.map(shift => ({ ...shift, hours: Math.max(0, shift.end - Math.max(shift.start, elapsedHours)) }));
    const hasManual = id => Object.prototype.hasOwnProperty.call(overrides, id);
    const manualVolume = plans.reduce((total, plan) => total + (hasManual(plan.id) ? Math.round(overrides[plan.id]) * plan.hours : 0), 0);
    const automaticHours = plans.reduce((total, plan) => total + (hasManual(plan.id) ? 0 : plan.hours), 0);
    const automaticRate = automaticHours ? Math.round(Math.max(0, remainingVolume - manualVolume) / automaticHours) : 0;
    for (const plan of plans) {
      plan.enabled = plan.hours > 0 && remainingVolume > 0;
      plan.isManual = plan.enabled && hasManual(plan.id);
      plan.rate = plan.enabled ? (plan.isManual ? Math.round(overrides[plan.id]) : automaticRate) : 0;
      plan.volume = plan.rate * plan.hours;
    }
    const plannedVolume = plans.reduce((total, plan) => total + plan.volume, 0);
    const cumulativeVolumeAt = boundary => currentRate * Math.min(elapsedHours, boundary)
      + plans.reduce((total, plan) => total + plan.rate * Math.max(0, Math.min(plan.end, boundary) - Math.max(plan.start, elapsedHours)), 0);
    for (const plan of plans) {
      plan.replacementTimes = [];
      plan.replacementCount = 0;
      plan.omittedReplacementCount = 0;
      if (!plan.enabled || plan.rate === 0) continue;
      const start = Math.max(elapsedHours, plan.start);
      const startVolume = cumulativeVolumeAt(start);
      const endVolume = startVolume + plan.volume;
      // Include an empty bag at this interval's start, but allocate an exact
      // end-boundary change to the next shift. Never replace the initial full bag.
      const firstBag = Math.max(1, Math.ceil(startVolume / 500));
      const lastBag = Math.ceil(endVolume / 500) - 1;
      plan.replacementCount = Math.max(0, lastBag - firstBag + 1);
      // Large manual values must not cause an unbounded loop or freeze the UI.
      const shownCount = Math.min(32, plan.replacementCount);
      for (let i = 0; i < shownCount; i++) {
        plan.replacementTimes.push(start + ((firstBag + i) * 500 - startVolume) / plan.rate);
      }
      plan.omittedReplacementCount = plan.replacementCount - shownCount;
    }
    // Bags start full at 08:00 and are replaced after each 500 mL is infused.
    // Do not allocate the full daily target to the currently hanging bag.
    const handovers = [8, 16].map((boundary, index) => {
      const cumulativeVolume = cumulativeVolumeAt(boundary);
      const usedInBag = cumulativeVolume % 500;
      const needsNewBag = cumulativeVolume > 0 && usedInBag === 0;
      const bagVolume = needsNewBag ? 0 : 500 - usedInBag;
      return { id: shifts[index].id, nextTitle: shifts[index + 1].title,
        time: boundary === 8 ? '16:00' : '24:00', cumulativeVolume,
        bagVolume, bags: bagVolume / 500, needsNewBag,
        isPast: elapsedHours > boundary };
    });
    return {
      previousBags: currentRate * 24 / 500, targetVolume, infusedVolume, remainingVolume,
      remainingHours: 24 - elapsedHours, plans, handovers, plannedVolume,
      difference: plannedVolume - remainingVolume,
      projectedDailyVolume: infusedVolume + plannedVolume,
      overAllocatedManualVolume: remainingVolume > 0 ? Math.max(0, manualVolume - remainingVolume) : 0,
      allActiveShiftsManual: plans.some(plan => plan.enabled) && plans.filter(plan => plan.enabled).every(plan => plan.isManual)
    };
  }

  function timeLabel(elapsedHours) {
    if (!Number.isInteger(elapsedHours) || elapsedHours < 0 || elapsedHours > 24) throw new RangeError('時間無效');
    const hour = elapsedHours + 8;
    return (hour >= 24 ? '隔日 ' : '') + String(hour % 24).padStart(2, '0') + ':00';
  }

  function parseRate(text) {
    const normalized = String(text).trim().replace(',', '.');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) && value >= 0 && value <= maximumNumericRate ? value : null;
  }
  function replacementTimeLabel(elapsedHours) {
    if (!Number.isFinite(elapsedHours) || elapsedHours < 0 || elapsedHours > 24) throw new RangeError('換袋時間無效');
    // Round down to a minute; epsilon only corrects floating-point boundary noise.
    const minutes = Math.floor((8 + elapsedHours) * 60 + 1e-8);
    if (minutes === 24 * 60) return '24:00';
    const hour = Math.floor(minutes / 60) % 24;
    return (minutes >= 24 * 60 ? '隔日 ' : '') + String(hour).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  return { calculate, timeLabel, replacementTimeLabel, parseRate, shifts };
});
