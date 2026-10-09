'use strict';
// Execute the real app.js event handlers in a minimal DOM model.
// These are logic tests, not browser layout or Safari validation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NSFlow = require('../calculator.js');
class Element {
  constructor() {
    this.value=''; this.hidden=false; this.disabled=false; this.textContent='';
    this.attrs={}; this.events={}; this.dataset={}; this.nodes={};
    this.style={ setProperty() {} };
    this.classList={ toggle() {} };
  }
  addEventListener(type,fn) { (this.events[type] ||= []).push(fn); }
  emit(type,extra={}) { for (const fn of this.events[type] || []) fn({ target:this,currentTarget:this,preventDefault(){},...extra }); }
  setAttribute(key,value) { this.attrs[key]=value; }
  removeAttribute(key) { delete this.attrs[key]; }
  querySelector(selector) { return this.nodes[selector]; }
  append(node) { (this.children ||= []).push(node); }
  focus() {} blur() {} showModal() { this.open=true; } close() { this.open=false; this.emit('close'); }
  getBoundingClientRect() { return { left:0,right:400,top:0,bottom:800 }; }
}
function newCard() {
  const card=new Element();
  for (const name of ['shift-name','shift-interval','rate-input','rate-slider','rate-label','rate-error','apply-rate','auto-rate','cancel-rate','rate-actions','shift-badge','shift-allocation']) card.nodes['.'+name]=new Element();
  card.nodes['.rate-slider'].min='0'; card.nodes['.rate-slider'].max='500';
  card.nodes['.rate-actions'].hidden=true;
  return card;
}
function launch() {
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const ids=new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element=new Element();
    for (const attr of ['min','max','value']) {
      const value=match[0].match(new RegExp('\\b'+attr+'="([^"]+)"'));
      if(value) element[attr]=value[1];
    }
    element.hidden=/\bhidden\b/.test(match[0]);
    ids.set(match[1],element);
  }
  ids.get('shift-template').content={firstElementChild:{cloneNode:newCard}};
  const classes={'.total-card':new Element(),'.total-icon':new Element()};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),{
    document:{getElementById:id=>ids.get(id),querySelector:selector=>classes[selector]},
    NSFlow,Intl,Number,Math,Object,String,Promise,Error,
    navigator:{},window:{matchMedia:()=>({matches:false}),isSecureContext:false},
    setTimeout:fn=>{fn();return 1;},clearTimeout(){}
  });
  return { get:id=>ids.get(id),card:id=>ids.get('shift-cards').children.find(card=>card.dataset.shift===id) };
}
test('real UI initializes computed outputs and manual day edit rebalances rates',()=>{
  const ui=launch();
  assert.equal(ui.get('remaining-volume').textContent,'1,680');
  const day=ui.card('day');
  day.querySelector('.rate-input').value='100';
  day.querySelector('.rate-input').emit('input');
  day.querySelector('.apply-rate').emit('click');
  assert.equal(day.querySelector('.shift-badge').textContent,'手動固定');
  assert.equal(ui.card('evening').querySelector('.rate-input').value,'80');
  assert.equal(ui.card('night').querySelector('.rate-input').value,'80');
  assert.equal(ui.get('planned-volume').textContent,'1,680');
});
test('invalid text does not change plans; manual decimal rounds on apply',()=>{
  const ui=launch(),day=ui.card('day'),input=day.querySelector('.rate-input');
  input.value='-5';input.emit('input');day.querySelector('.apply-rate').emit('click');
  assert.equal(input.attrs['aria-invalid'],'true');
  assert.equal(ui.get('planned-volume').textContent,'1,680');
  input.value='100.5';input.emit('input');day.querySelector('.apply-rate').emit('click');
  assert.equal(input.value,'101');
  assert.equal(ui.get('difference').textContent,'+4 mL');
});
test('major time change clears manual settings and disables ended shifts',()=>{
  const ui=launch(),day=ui.card('day');
  day.querySelector('.rate-slider').value='100';day.querySelector('.rate-slider').emit('input');
  ui.get('change-time').value='12';ui.get('change-time').emit('input');
  assert.equal(day.querySelector('.rate-input').disabled,true);
  assert.equal(day.querySelector('.shift-badge').textContent,'已結束');
  assert.equal(ui.card('evening').querySelector('.rate-input').value,'87');
  assert.equal(ui.get('planned-volume').textContent,'1,044');
  assert.equal(ui.get('reset-rates').hidden,true);
});
test('endpoint and exceeded target show notices with disabled rates',()=>{
  const ui=launch();
  ui.get('change-time').value='24';ui.get('change-time').emit('input');
  assert.match(ui.get('calculation-notice').textContent,/剩餘時間為 0/);
  assert.equal(ui.get('difference').textContent,'-80 mL');
  ui.get('change-time').value='1';ui.get('change-time').emit('input');
  ui.get('current-rate').value='500';ui.get('current-rate').emit('input');
  ui.get('target-bags').value='0.5';ui.get('target-bags').emit('input');
  assert.equal(ui.get('remaining-volume').textContent,'-250');
  assert.match(ui.get('calculation-notice').textContent,/超過新目標/);
  assert.ok(['day','evening','night'].every(id=>ui.card(id).querySelector('.rate-input').disabled));
});
test('manual conflicts and restore automatic controls update visible results',()=>{
  const ui=launch(),day=ui.card('day');
  day.querySelector('.rate-slider').value='500';day.querySelector('.rate-slider').emit('input');
  assert.match(ui.get('allocation-notice').textContent,/超出剩餘目標 320 mL/);
  assert.equal(ui.card('night').querySelector('.rate-input').value,'0');
  day.querySelector('.auto-rate').emit('click');
  assert.equal(ui.get('allocation-notice').hidden,true);
  assert.equal(ui.get('difference').textContent,'0 mL');
});
test('help dialog opens and closes using actual handlers',()=>{
  const ui=launch();ui.get('help-open').emit('click');
  assert.equal(ui.get('help-dialog').open,true);
  ui.get('help-close').emit('click');assert.equal(ui.get('help-dialog').open,false);
});
