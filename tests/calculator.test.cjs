'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, timeLabel, replacementTimeLabel, parseRate } = require('../calculator.js');
const base = { currentRate: 80, targetBags: 4, elapsedHours: 4 };
const rates = result => result.plans.map(plan => plan.rate);

test('500 mL bags and original-rate daily volume have correct units', () => {
  const r = calculate(base);
  assert.equal(r.previousBags, 3.84);
  assert.equal(r.targetVolume, 2000);
  assert.equal(r.infusedVolume, 320);
  assert.equal(r.remainingVolume, 1680);
  assert.deepEqual(r.plans.map(p => p.hours), [4, 8, 8]);
  assert.deepEqual(rates(r), [84, 84, 84]);
  assert.equal(r.plannedVolume, 1680);
  assert.equal(r.difference, 0);
});
test('manual day rate redistributes evening and night', () => {
  const r = calculate({ ...base, overrides: { day: 100 } });
  assert.deepEqual(rates(r), [100, 80, 80]);
  assert.equal(r.difference, 0);
});
test('manual evening rate redistributes day and night', () => {
  const r = calculate({ ...base, overrides: { evening: 90 } });
  assert.deepEqual(rates(r), [80, 90, 80]);
  assert.equal(r.difference, 0);
});
test('manual night rate redistributes day and evening', () => {
  const r = calculate({ ...base, overrides: { night: 90 } });
  assert.deepEqual(rates(r), [80, 80, 90]);
  assert.equal(r.difference, 0);
});
test('two fixed shifts leave remaining volume to third shift', () => {
  const r = calculate({ ...base, overrides: { day: 100, evening: 90 } });
  assert.deepEqual(rates(r), [100, 90, 70]);
  assert.equal(r.plannedVolume, 1680);
});
test('manual decimal rounds before redistribution', () => {
  const r = calculate({ ...base, overrides: { day: 100.5 } });
  assert.deepEqual(rates(r), [101, 80, 80]);
  assert.equal(r.difference, 4);
});
test('fully manual plans preserve rates and expose mismatch', () => {
  const r = calculate({ ...base, overrides: { day: 100, evening: 100, night: 100 } });
  assert.equal(r.allActiveShiftsManual, true);
  assert.deepEqual(rates(r), [100, 100, 100]);
  assert.equal(r.difference, 320);
});
test('partial evening and rounded total retain true remaining hours', () => {
  const r = calculate({ ...base, elapsedHours: 12 });
  assert.deepEqual(r.plans.map(p => p.hours), [0, 4, 8]);
  assert.deepEqual(rates(r), [0, 87, 87]);
  assert.equal(r.plannedVolume, 1044);
  assert.equal(r.difference, 4);
});
test('shift boundaries use correct overlaps', () => {
  for (const [elapsedHours, hours] of [[0,[8,8,8]],[8,[0,8,8]],[16,[0,0,8]],[24,[0,0,0]]]) {
    assert.deepEqual(calculate({ ...base, elapsedHours }).plans.map(p => p.hours), hours);
  }
});
test('next-day endpoint avoids division by zero', () => {
  const r = calculate({ ...base, elapsedHours: 24 });
  assert.equal(r.remainingVolume, 80);
  assert.deepEqual(rates(r), [0,0,0]);
  assert.equal(r.difference, -80);
});
test('met and exceeded targets propose no negative rates', () => {
  const exceeded = calculate({ currentRate: 500, targetBags: 0.5, elapsedHours: 1, overrides: { day: 100 } });
  assert.equal(exceeded.remainingVolume, -250);
  assert.equal(exceeded.plannedVolume, 0);
  assert.equal(exceeded.difference, 250);
  assert.equal(exceeded.plans.some(p => p.isManual), false);
  const met = calculate({ currentRate: 250, targetBags: 0.5, elapsedHours: 1 });
  assert.equal(met.remainingVolume, 0);
  assert.equal(met.plannedVolume, 0);
});
test('manual over-allocation stays visible and automatic rates become zero', () => {
  const r = calculate({ ...base, overrides: { day: 500 } });
  assert.deepEqual(rates(r), [500,0,0]);
  assert.equal(r.overAllocatedManualVolume, 320);
  assert.equal(r.difference, 320);
});
test('ended shift overrides allocate zero volume', () => {
  const r = calculate({ ...base, elapsedHours: 16, overrides: { day: 500, evening: 500 } });
  assert.deepEqual(rates(r), [0,0,90]);
  assert.equal(r.difference, 0);
});
test('half-unit automatic rates round up', () => {
  const r = calculate({ currentRate: 5, targetBags: 0.5, elapsedHours: 4 });
  assert.deepEqual(rates(r), [12,12,12]);
  assert.equal(r.difference, 10);
});
test('time labels distinguish midnight and next-day 08:00', () => {
  assert.deepEqual([0,8,16,24].map(timeLabel), ['08:00','16:00','隔日 00:00','隔日 08:00']);
  assert.throws(() => timeLabel(25));
});
test('numeric entry accepts decimals but rejects incomplete or non-finite values', () => {
  for (const [text, value] of [['80',80],['80.5',80.5],['80,5',80.5],['.5',0.5],['0',0],[' 100 ',100]]) assert.equal(parseRate(text), value);
  for (const text of ['', '-', '-1', 'NaN', 'Infinity', '1e309', '1.2.3', '80 mL', '999999999999999999']) assert.equal(parseRate(text), null);
});
test('invalid major inputs and overrides are rejected', () => {
  for (const currentRate of [0,501,1.5,NaN,Infinity]) assert.throws(() => calculate({ ...base, currentRate }));
  for (const targetBags of [0,24.5,0.75,NaN,Infinity]) assert.throws(() => calculate({ ...base, targetBags }));
  for (const elapsedHours of [-1,25,1.5,NaN,Infinity]) assert.throws(() => calculate({ ...base, elapsedHours }));
  for (const day of [-1,NaN,Infinity,Number.MAX_VALUE]) assert.throws(() => calculate({ ...base, overrides: { day } }));
  assert.throws(() => calculate({ ...base, overrides: { typo: 80 } }));
});
test('3600 input combinations preserve hours, nonnegative rates and rounding bound', () => {
  for (let elapsedHours = 0; elapsedHours <= 24; elapsedHours++) {
    for (let halfBags = 1; halfBags <= 48; halfBags++) {
      for (const currentRate of [1,80,500]) {
        const r = calculate({ currentRate, targetBags: halfBags / 2, elapsedHours });
        assert.equal(r.plans.reduce((sum,p) => sum+p.hours,0), 24-elapsedHours);
        assert.ok(r.plans.every(p => Number.isFinite(p.rate) && p.rate >= 0 && (p.hours > 0 || p.rate === 0)));
        assert.equal(r.plannedVolume, r.plans.reduce((sum,p) => sum+p.rate*p.hours,0));
        if (r.remainingVolume > 0 && r.remainingHours > 0) assert.ok(Math.abs(r.difference) <= r.remainingHours/2);
        else assert.equal(r.plannedVolume,0);
      }
    }
  }
});
test('handover bags reflect the partial hanging bag from a full 08:00 start',()=>{
  const r=calculate(base);
  assert.deepEqual(r.handovers.map(h=>h.cumulativeVolume),[656,1328]);
  assert.deepEqual(r.handovers.map(h=>h.bagVolume),[344,172]);
  assert.deepEqual(r.handovers.map(h=>h.bags),[0.688,0.344]);
});
test('changing day or evening flow recalculates the following handover bag',()=>{
  const r=calculate({...base,overrides:{day:100,evening:90}});
  assert.deepEqual(r.handovers.map(h=>h.cumulativeVolume),[720,1440]);
  assert.deepEqual(r.handovers.map(h=>h.bagVolume),[280,60]);
});
test('an exact bag boundary displays an empty bag and need for replacement',()=>{
  const r=calculate({currentRate:75,targetBags:4,elapsedHours:4,overrides:{day:50}});
  assert.equal(r.handovers[0].cumulativeVolume,500);
  assert.equal(r.handovers[0].bagVolume,0);
  assert.equal(r.handovers[0].needsNewBag,true);
});
test('zero delivery leaves the initial full bag instead of reporting an empty one',()=>{
  const r=calculate({currentRate:80,targetBags:4,elapsedHours:0,overrides:{day:0}});
  assert.equal(r.handovers[0].cumulativeVolume,0);
  assert.equal(r.handovers[0].bagVolume,500);
  assert.equal(r.handovers[0].needsNewBag,false);
});
test('past handovers are marked as historical estimates and ignore future overrides',()=>{
  const r=calculate({...base,elapsedHours:12,overrides:{night:100}});
  assert.equal(r.handovers[0].isPast,true);
  assert.equal(r.handovers[0].cumulativeVolume,640);
  assert.equal(r.handovers[0].bagVolume,360);
  assert.equal(r.handovers[1].isPast,false);
});
test('replacement forecasts carry the partial bag across all three shifts',()=>{
  const r=calculate(base);
  assert.deepEqual(r.plans.map(p=>p.replacementTimes.map(replacementTimeLabel)),[['14:08'],['20:05'],['隔日 02:02']]);
  assert.ok(Math.abs(r.plans[0].replacementTimes[0]-(4+180/84))<1e-10);
});
test('manual day changes update subsequent replacement times using the remaining bag',()=>{
  const r=calculate({...base,overrides:{day:100}});
  assert.deepEqual(r.plans.map(p=>p.replacementTimes.map(replacementTimeLabel)),[['13:48'],['19:30'],['隔日 01:45']]);
});
test('a replacement exactly at a handover belongs only to the following shift',()=>{
  const r=calculate({currentRate:80,targetBags:6,elapsedHours:0});
  assert.deepEqual(r.plans.map(p=>p.replacementTimes.map(replacementTimeLabel)),[['12:00'],['16:00','20:00'],['24:00','隔日 04:00']]);
  assert.equal(r.plans.flatMap(p=>p.replacementTimes).filter(t=>t===8).length,1);
  assert.ok(r.plans.every(p=>p.replacementTimes.every(t=>t<24)));
});
test('an empty bag at the selected change time is replaced immediately once',()=>{
  const r=calculate({currentRate:125,targetBags:4,elapsedHours:4});
  assert.equal(r.infusedVolume,500);
  assert.equal(r.plans[0].replacementTimes[0],4);
  assert.equal(replacementTimeLabel(r.plans[0].replacementTimes[0]),'12:00');
});
test('zero flow defers replacement of an empty bag until delivery resumes',()=>{
  const r=calculate({currentRate:80,targetBags:4,elapsedHours:0,overrides:{day:125,evening:0,night:125}});
  assert.deepEqual(r.plans[1].replacementTimes,[]);
  assert.equal(r.plans[2].replacementTimes[0],16);
});
test('no replacement is forecast for ended shifts, exceeded targets or insufficient delivery',()=>{
  const ended=calculate({...base,elapsedHours:24});
  assert.ok(ended.plans.every(p=>p.replacementTimes.length===0));
  const exceeded=calculate({currentRate:500,targetBags:0.5,elapsedHours:1});
  assert.ok(exceeded.plans.every(p=>p.replacementTimes.length===0));
  const low=calculate({currentRate:5,targetBags:0.5,elapsedHours:0});
  assert.ok(low.plans.every(p=>p.replacementTimes.length===0));
});
test('replacement forecasting handles huge manual values with a bounded list and explicit count',()=>{
  const r=calculate({...base,overrides:{day:1e9}}),day=r.plans[0];
  assert.equal(day.replacementTimes.length,32);
  assert.ok(day.omittedReplacementCount>0);
  assert.equal(day.replacementTimes.length+day.omittedReplacementCount,day.replacementCount);
});
test('fractional forecast times round down to minutes and mark midnight/next day',()=>{
  assert.equal(replacementTimeLabel(4.999),'12:59');
  assert.equal(replacementTimeLabel(8),'16:00');
  assert.equal(replacementTimeLabel(16),'24:00');
  assert.equal(replacementTimeLabel(17.5),'隔日 01:30');
  for(const value of [-1,25,NaN,Infinity])assert.throws(()=>replacementTimeLabel(value));
});
