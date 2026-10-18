'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { currentRate: 80, targetBags: 4, elapsedHours: 4, overrides: {} };
  const integer = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 });
  const cards = new Map();
  const handoverCards = new Map();
  let result;
  let announcementTimer;
  let returnFocus;
  let pendingWorker;

  function announce(text) {
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => { $('announcement').textContent = text; }, 150);
  }
  function paintRange(input) {
    const fill = 100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty('--fill', `${fill}%`);
  }
  function setNotice(id, text, urgent = false) {
    const node = $(id);
    node.hidden = !text;
    node.textContent = text;
    node.classList.toggle('urgent', urgent);
  }
  function clearDraft(card) {
    const plan = result.plans.find(plan => plan.id === card.dataset.shift);
    card.querySelector('.rate-input').value = String(plan.rate);
    card.querySelector('.rate-actions').hidden = true;
    card.querySelector('.rate-error').hidden = true;
  }
  function applyRate(card) {
    const id = card.dataset.shift;
    const plan = result.plans.find(plan => plan.id === id);
    if (!plan.enabled) return;
    const input = card.querySelector('.rate-input');
    const value = NSFlow.parseRate(input.value);
    if (value === null) {
      const error = card.querySelector('.rate-error');
      error.textContent = '請輸入有效的非負數字，例如 80 或 80.5。';
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    state.overrides[id] = Math.round(value);
    card.querySelector('.rate-actions').hidden = true;
    input.removeAttribute('aria-invalid');
    render(true);
    announce(`${plan.title}固定為 ${integer.format(Math.round(value))} mL/hr，其他自動班別已重新分配。`);
  }

  for (const shift of NSFlow.shifts) {
    const card = $('shift-template').content.firstElementChild.cloneNode(true);
    card.dataset.shift = shift.id;
    card.id = `shift-${shift.id}`;
    card.querySelector('.shift-name').textContent = shift.title;
    card.querySelector('.shift-interval').textContent = shift.interval;
    const input = card.querySelector('.rate-input');
    const slider = card.querySelector('.rate-slider');
    input.id = `rate-${shift.id}`;
    input.setAttribute('aria-label', `${shift.title}剩餘流速，mL/hr`);
    input.setAttribute('aria-describedby', `error-${shift.id}`);
    card.querySelector('.rate-label').htmlFor = input.id;
    const error = card.querySelector('.rate-error');
    error.id = `error-${shift.id}`;
    slider.setAttribute('aria-label', `${shift.title}剩餘流速滑桿，mL/hr`);
    card.querySelector('.apply-rate').setAttribute('aria-label', `套用${shift.title}流速`);
    card.querySelector('.auto-rate').setAttribute('aria-label', `${shift.title}恢復自動分配`);
    input.addEventListener('input', () => {
      card.querySelector('.rate-actions').hidden = false;
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    function caretToEnd() {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    input.addEventListener('focus', () => setTimeout(caretToEnd, 0));
    input.addEventListener('click', caretToEnd);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); applyRate(card); input.blur(); }
      if (event.key === 'Escape') { clearDraft(card); input.blur(); }
    });
    card.querySelector('.apply-rate').addEventListener('click', () => { applyRate(card); });
    card.querySelector('.cancel-rate').addEventListener('click', () => { clearDraft(card); input.removeAttribute('aria-invalid'); });
    slider.addEventListener('input', () => {
      state.overrides[shift.id] = Number(slider.value);
      render(true);
    });
    slider.addEventListener('change', () => { announce(`${shift.title}流速已固定，其他自動班別已重新分配。`); });
    card.querySelector('.auto-rate').addEventListener('click', () => {
      delete state.overrides[shift.id];
      render(true);
      announce(`${shift.title}已恢復自動分配。`);
    });
    cards.set(shift.id, card);
    $('shift-cards').append(card);
    if (shift.id !== 'night') {
      const handover = $('handover-template').content.firstElementChild.cloneNode(true);
      handoverCards.set(shift.id, handover);
      $('shift-cards').append(handover);
    }
  }

  function render(clearDrafts = false) {
    try { result = NSFlow.calculate(state); }
    catch (error) { setNotice('calculation-notice', '輸入值無效，請重新整理並重新設定。', true); return; }
    $('current-rate-value').textContent = integer.format(state.currentRate);
    $('current-rate').setAttribute('aria-valuetext', `${state.currentRate} mL/hr`);
    $('target-bags-value').textContent = decimal.format(state.targetBags);
    $('target-bags').setAttribute('aria-valuetext', `${state.targetBags} bag/day`);
    $('target-volume').textContent = integer.format(result.targetVolume);
    $('change-time-value').textContent = NSFlow.timeLabel(state.elapsedHours);
    $('change-time').setAttribute('aria-valuetext', NSFlow.timeLabel(state.elapsedHours));
    $('time-remaining').textContent = `已經過 ${state.elapsedHours} 小時 · 尚餘 ${result.remainingHours} 小時`;
    $('time-marker').style.left = `calc(${state.elapsedHours / 24 * 100}% - ${state.elapsedHours === 24 ? 3 : 0}px)`;
    ['current-rate', 'target-bags', 'change-time'].forEach(id => paintRange($(id)));
    $('previous-bags').textContent = decimal.format(result.previousBags);
    $('infused-volume').textContent = integer.format(result.infusedVolume);
    $('remaining-volume').textContent = integer.format(result.remainingVolume);
    const progress = Math.max(0, Math.min(100, result.infusedVolume / result.targetVolume * 100));
    $('infusion-progress').setAttribute('aria-valuenow', String(Math.round(progress)));
    $('infusion-progress').setAttribute('aria-valuetext', `已輸入 ${result.infusedVolume} mL，目標 ${result.targetVolume} mL`);
    $('infusion-progress-fill').style.width = `${progress}%`;
    $('progress-description').textContent = `已輸入 ${integer.format(result.infusedVolume)} / ${integer.format(result.targetVolume)} mL`;
    let notice = '';
    let urgent = false;
    if (result.remainingVolume < 0) {
      notice = `已輸入量超過新目標 ${integer.format(-result.remainingVolume)} mL，後續流速無法抵銷已輸入量。請核對醫囑。`;
      urgent = true;
    } else if (result.remainingHours === 0 && result.remainingVolume > 0) {
      notice = `已到隔日 08:00，剩餘時間為 0；本計算日尚差 ${integer.format(result.remainingVolume)} mL。`;
      urgent = true;
    } else if (result.remainingVolume === 0) notice = '已達新目標，沒有剩餘量可供分配。';
    setNotice('calculation-notice', notice, urgent);

    for (const plan of result.plans) {
      const card = cards.get(plan.id);
      const input = card.querySelector('.rate-input');
      const slider = card.querySelector('.rate-slider');
      card.classList.toggle('manual', plan.isManual);
      card.classList.toggle('ended', plan.hours === 0);
      card.querySelector('.shift-badge').textContent = plan.hours === 0 ? '已結束' : !plan.enabled ? '無可分配量' : plan.isManual ? '手動固定' : '自動';
      const keepDraft = !clearDrafts && !card.querySelector('.rate-actions').hidden && plan.enabled;
      if (!keepDraft) {
        input.value = String(plan.rate);
        card.querySelector('.rate-actions').hidden = true;
        card.querySelector('.rate-error').hidden = true;
        input.removeAttribute('aria-invalid');
      }
      input.disabled = !plan.enabled;
      slider.disabled = !plan.enabled;
      // Align the range's grid with the actual integer rate (e.g. 84 -> 89),
      // so native range controls do not silently sanitize 84 into 85.
      const offset = plan.rate % 5;
      const upper = Math.max(500, plan.rate, Math.ceil(Math.max(0, result.remainingVolume) / Math.max(1, plan.hours)));
      slider.min = String(offset);
      slider.step = '5';
      slider.max = String(offset + Math.ceil((upper - offset) / 5) * 5);
      slider.value = String(plan.rate);
      slider.setAttribute('aria-valuetext', `${plan.rate} mL/hr`);
      paintRange(slider);
      card.querySelector('.shift-allocation').textContent = `剩餘 ${plan.hours} 小時 · 分配 ${integer.format(plan.volume)} mL`;
      card.querySelector('.auto-rate').hidden = !plan.isManual;
      const schedule = card.querySelector('.replacement-times');
      const scheduleNote = card.querySelector('.replacement-note');
      if (plan.hours === 0) {
        schedule.textContent = '本班已結束';
        scheduleNote.textContent = '不列回推的換袋紀錄。';
      } else if (!plan.enabled) {
        schedule.textContent = '無剩餘需輸入量，未排定換袋';
        scheduleNote.textContent = '請核對目前醫囑與實際餘量。';
      } else if (plan.rate === 0) {
        schedule.textContent = '本班流速為 0，未排定換袋';
        scheduleNote.textContent = '之後恢復輸入時重新推算。';
      } else if (plan.replacementTimes.length === 0) {
        schedule.textContent = '本班剩餘時段預計不需換袋';
        scheduleNote.textContent = '交接時點的換袋會列於下一班。';
      } else {
        schedule.textContent = plan.replacementTimes.map(time => '約 ' + NSFlow.replacementTimeLabel(time)).join('、');
        scheduleNote.textContent = plan.omittedReplacementCount > 0
          ? `另有 ${integer.format(plan.omittedReplacementCount)} 個時點未展開，請核對輸入流速。`
          : '每袋 500 mL，依目前規劃推算；實際請核對現場餘量。';
      }
    }
    for (const handover of result.handovers) {
      const card = handoverCards.get(handover.id);
      card.querySelector('.handover-title').textContent = `交給${handover.nextTitle}`;
      card.querySelector('.handover-time').textContent = `${handover.time} 交班`;
      card.querySelector('.handover-bags').textContent = decimal.format(handover.bags);
      card.querySelector('.handover-volume').textContent = integer.format(handover.bagVolume);
      card.querySelector('.handover-note').textContent = [
        handover.isPast ? '已交班，依變更前流速回推。' : '依目前流速規劃試算。',
        handover.needsNewBag ? '這袋剛好輸完，需換新袋。' : '每天 08:00 從 500 mL 滿袋起算。'
      ].join(' ');
    }
    $('reset-rates').hidden = Object.keys(state.overrides).length === 0;
    if (result.overAllocatedManualVolume > 0) {
      setNotice('allocation-notice', `手動固定量超出剩餘目標 ${integer.format(result.overAllocatedManualVolume)} mL。其餘自動班別顯示 0，請調低手動設定。`, true);
    } else if (result.allActiveShiftsManual && result.difference !== 0) {
      setNotice('allocation-notice', '剩餘班別均為手動固定，無法自動平衡。請調整流速或恢復某班為自動。');
    } else setNotice('allocation-notice', '');
    $('required-volume').textContent = integer.format(result.remainingVolume);
    $('planned-volume').textContent = integer.format(result.plannedVolume);
    $('difference-label').textContent = result.difference > 0 ? '與目標劑量多了' : result.difference < 0 ? '與目標劑量少了' : '與目標劑量一樣';
    $('difference').textContent = integer.format(Math.abs(result.difference)) + ' mL';
    $('difference-description').textContent = result.difference === 0
      ? '分配量與剩餘目標一致。'
      : result.difference > 0
        ? `預計比每日目標多輸入 ${integer.format(result.difference)} mL。`
        : `預計比每日目標少輸入 ${integer.format(-result.difference)} mL。`;
    $('daily-projection').textContent = `預計每日總輸入量 ${integer.format(result.projectedDailyVolume)} / ${integer.format(result.targetVolume)} mL`;
    document.querySelector('.total-card').classList.toggle('has-difference', result.difference !== 0);
    document.querySelector('.total-icon').innerHTML = result.difference === 0
      ? '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 7v7m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg>';
  }

  for (const [id, key] of [['current-rate', 'currentRate'], ['target-bags', 'targetBags'], ['change-time', 'elapsedHours']]) {
    $(id).addEventListener('input', event => {
      state[key] = Number(event.target.value);
      state.overrides = {};
      render(true);
    });
    $(id).addEventListener('change', () => announce('主要輸入已更新，各班手動設定已清除並重新分配。'));
  }
  $('reset-rates').addEventListener('click', () => { state.overrides = {}; render(true); announce('所有班別已恢復自動分配。'); });
  function openHelp(event) {
    returnFocus = event.currentTarget;
    $('help-dialog').showModal();
  }
  $('help-open').addEventListener('click', openHelp);
  $('install-help').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('close', () => returnFocus?.focus());
  $('help-dialog').addEventListener('click', event => {
    if (event.target !== $('help-dialog')) return;
    const bounds = $('help-dialog').getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('help-dialog').close();
  });
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-card').hidden = true;
  render(true);

  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      $('offline-status').textContent = '離線支援需 HTTPS 網址';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      function offerUpdate() {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        pendingWorker = registration.waiting;
        $('update-app').hidden = false;
      }
      offerUpdate();
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', offerUpdate);
      });
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'OFFLINE_READY') $('offline-status').textContent = '已可離線使用';
        if (event.data?.type === 'OFFLINE_UNAVAILABLE') $('offline-status').textContent = '離線快取未完成，請保持連線';
      });
      let timeout;
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Offline cache timeout')), 20000); })
        ]);
      } finally { clearTimeout(timeout); }
      const active = registration.active;
      if (active) active.postMessage({ type: 'CHECK_OFFLINE' });
    } catch {
      $('offline-status').textContent = '離線快取未完成，請保持連線';
    }
  }
  let refreshing = false;
  $('update-app').addEventListener('click', () => {
    if (!pendingWorker) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
  });
  setupOffline();
})();
