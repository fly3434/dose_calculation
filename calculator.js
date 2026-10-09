(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NSFlow = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const shifts = [
    { id: 'day', title: '日班', interval: '08:00–16:00', start: 0, end: 8 },
    { id: 'evening', title: '小夜班', interval: '16:00–24:00', start: 8, end: 16 },
    { id: 'night', title: '大夜班', interval: '00:00–隔日 08:00', start: 16, end: 24 }
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
    return {
      previousBags: currentRate * 24 / 500, targetVolume, infusedVolume, remainingVolume,
      remainingHours: 24 - elapsedHours, plans, plannedVolume,
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
  return { calculate, timeLabel, parseRate, shifts };
});
