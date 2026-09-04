import {
  previewBudget,
  formatTokens,
  pctOf,
} from './preview.js';

const ICON_INFO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;

const state = {
  data: null,
  band: 'compact',
  draft: null,
  previewWindow: 35_000,
  helpField: null,
  helpKind: null,
};

const $ = (sel) => document.querySelector(sel);

function showStatus(message, isError = false) {
  const el = $('#status');
  el.hidden = !message;
  if (!message) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
}

function effectiveValue(kind, bandId, key, base) {
  const overlay = state.draft[kind][bandId]?.[key];
  if (typeof overlay === 'number') return overlay;
  return base[key];
}

function isOverridden(kind, bandId, key) {
  return Object.prototype.hasOwnProperty.call(
    state.draft[kind][bandId] ?? {},
    key,
  );
}

function setOverride(kind, bandId, key, value, base) {
  if (!state.draft[kind][bandId]) state.draft[kind][bandId] = {};
  if (base[key] === value) delete state.draft[kind][bandId][key];
  else state.draft[kind][bandId][key] = value;
}

function clearOverride(kind, bandId, key) {
  if (state.draft[kind][bandId]) delete state.draft[kind][bandId][key];
}

function currentPreview() {
  return previewBudget(
    state.previewWindow,
    state.data.baseWindow,
    state.draft.window[state.band],
  );
}

function oneLineWhy(field) {
  const w = field.plain ?? '';
  const dot = w.indexOf('.');
  return dot > 0 && dot < 160 ? w.slice(0, dot + 1) : w.slice(0, 140);
}

function tileTokenStats(field, preview) {
  if (field.budgetRole) {
    const map = {
      output: {
        tokens: preview.maximumOutputTokens,
        of: preview.contextWindowTokens,
        ofLabel: 'preview window',
      },
      tools: {
        tokens: preview.toolSchemaTokens,
        of: preview.contextWindowTokens,
        ofLabel: 'preview window',
      },
      repository: {
        tokens: preview.repositoryTokens,
        of: preview.usableInputTokens,
        ofLabel: 'usable input',
      },
      conversation: {
        tokens: preview.conversationTokens,
        of: preview.usableInputTokens,
        ofLabel: 'usable input',
      },
      plan: {
        tokens: preview.planTokens,
        of: preview.usableInputTokens,
        ofLabel: 'usable input',
      },
      skills: {
        tokens: preview.skillsTokens,
        of: preview.usableInputTokens,
        ofLabel: 'usable input',
      },
    };
    return map[field.budgetRole] ?? null;
  }
  if (field.countRole === 'verify') {
    return { count: preview.maxVerificationChecks, unit: 'checks' };
  }
  if (field.countRole === 'files') {
    return { count: preview.maxUniqueFilesPerCall, unit: 'files / patch' };
  }
  if (field.countRole === 'skills') {
    return { count: preview.maxSkills, unit: 'skills packed' };
  }
  return null;
}

function formatPctWhole(ratio) {
  return `${Math.round((Number.isFinite(ratio) ? ratio : 0) * 100)}%`;
}

function ratioToPct(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

function pctToRatio(pct) {
  return Math.round(pct) / 100;
}

function effectChips(field) {
  return `<span class="effect up">↑ ${field.whenHigher}</span><span class="effect down">↓ ${field.whenLower}</span>`;
}

function countRoleLabel(field) {
  const role = typeof field === 'string' ? field : field?.countRole;
  const key = typeof field === 'object' && field ? field.key : '';
  if (role === 'verify') {
    if (key === 'verificationChecksBase') {
      return { setting: 'Floor (start)', live: 'Live now', unitShort: 'checks' };
    }
    return { setting: 'Ceiling (max)', live: 'Live now', unitShort: 'checks' };
  }
  if (role === 'files') return { setting: 'Cap (max)', live: 'Live now', unitShort: 'files' };
  if (role === 'skills') {
    if (key === 'maxSkillsBase') {
      return { setting: 'Floor (start)', live: 'Live now', unitShort: 'skills' };
    }
    return { setting: 'Cap (max)', live: 'Live now', unitShort: 'skills' };
  }
  return { setting: 'Your setting', live: 'Live now', unitShort: '' };
}

/**
 * Share tiles: setting vs live. Count knobs (verify/files/skills) get a split box
 * so the input ceiling is never confused with the derived live count.
 */
function renderPreviewBlock(field, preview, uiValue, isRatio) {
  const stats = tileTokenStats(field, preview);
  const forLabel = field.forLabel ?? field.label.toLowerCase();
  const W = preview.contextWindowTokens;

  if (stats && typeof stats.tokens === 'number') {
    const shareOfUsable = field.shareOf === 'usable';
    const knobPct = isRatio ? `${uiValue}%` : formatPctWhole(pctOf(stats.tokens, stats.of));
    const windowPct = formatPctWhole(pctOf(stats.tokens, W));
    const mathLine = shareOfUsable
      ? `${knobPct} × ${formatTokens(stats.of)} usable = <strong>${formatTokens(stats.tokens)}</strong> tokens`
      : `${knobPct} of ${formatTokens(W)} window ≈ <strong>${formatTokens(stats.tokens)}</strong> tokens`;

    return `<div class="field-preview">
      <div class="field-preview__main">
        <span class="field-preview__pct">${knobPct}</span>
        <span class="field-preview__eq">→</span>
        <span class="field-preview__tokens"><strong>${formatTokens(stats.tokens)}</strong> tokens</span>
      </div>
      <p class="field-preview__for">for <strong>${forLabel}</strong></p>
      <p class="field-preview__math">${mathLine}</p>
      <p class="field-preview__of">${
        shareOfUsable
          ? `That’s ${windowPct} of the full preview window (${formatTokens(W)}). Shares are of usable input, not the whole window.`
          : `Preview window ${formatTokens(W)} · after this, remaining goes to tools/usable.`
      }</p>
    </div>`;
  }

  if (stats && typeof stats.count === 'number') {
    const labels = countRoleLabel(field);
    const settingNum = Number(uiValue);
    const isFloor = labels.setting.toLowerCase().includes('floor');
    let note;
    if (isFloor) {
      note =
        stats.count > settingNum
          ? `Floor is <strong>${settingNum}</strong>; live rose to <strong>${stats.count}</strong> with usable input.`
          : `Live is at the floor for ${formatTokens(W)}.`;
    } else if (stats.count < settingNum) {
      note = `At ${formatTokens(W)} you get <strong>${stats.count}</strong> — the slider is only the ceiling until the window is large enough.`;
    } else {
      note = `At ${formatTokens(W)} the live count matches your ceiling.`;
    }

    return `<div class="field-split">
      <div class="field-box field-box--setting">
        <span class="field-box__tag">${labels.setting}</span>
        <div class="field-box__main">
          <span class="field-box__value">${uiValue}</span>
          <span class="field-box__unit">${labels.unitShort}</span>
        </div>
        <p class="field-box__note">What you edit in the slider below</p>
      </div>
      <div class="field-box field-box--live">
        <span class="field-box__tag">${labels.live}</span>
        <div class="field-box__main">
          <span class="field-box__value">${stats.count}</span>
          <span class="field-box__unit">${stats.unit}</span>
        </div>
        <p class="field-box__note">${note}</p>
      </div>
    </div>`;
  }

  return `<div class="field-preview field-preview--plain">
    <div class="field-preview__main">
      <span class="field-preview__pct">${isRatio ? `${uiValue}%` : uiValue}</span>
    </div>
    <p class="field-preview__of">Your setting · preview window ${formatTokens(W)}</p>
  </div>`;
}

function renderFreeTile(preview) {
  const el = $('#free-tile');
  if (!el) return;
  const W = preview.contextWindowTokens;
  el.innerHTML = `
    <div class="field-row">
      <label>Free (unallocated)</label>
      <span class="chip">read-only · live</span>
    </div>
    <div class="field-preview">
      <div class="field-preview__main">
        <span class="field-preview__pct">${formatPctWhole(pctOf(preview.freeTokens, preview.usableInputTokens))}</span>
        <span class="field-preview__eq">→</span>
        <span class="field-preview__tokens"><strong>${formatTokens(preview.freeTokens)}</strong> tokens</span>
      </div>
      <p class="field-preview__for">leftover <strong>usable input</strong> not claimed by repo / conversation / plan / skills</p>
      <p class="field-preview__math">${formatPctWhole(preview.freeUsableShare)} of usable · ${formatPctWhole(pctOf(preview.freeTokens, W))} of window ${formatTokens(W)}</p>
      <p class="field-preview__of">Lower any module share to grow Free. Not a slider — it is whatever is left.</p>
    </div>
  `;
}

function renderDerivedPanel(preview) {
  const el = $('#derived-panel');
  if (!el) return;
  const W = preview.contextWindowTokens;
  el.innerHTML = `
    <p class="derived-panel__title">Derived at ${formatTokens(W)}</p>
    <div class="derived-grid">
      <div class="derived-pill">
        <span class="derived-pill__label">Verify checks</span>
        <span class="derived-pill__value">${preview.maxVerificationChecks}</span>
        <span class="derived-pill__hint">live · not the max slider</span>
      </div>
      <div class="derived-pill">
        <span class="derived-pill__label">Files / patch</span>
        <span class="derived-pill__value">${preview.maxUniqueFilesPerCall}</span>
        <span class="derived-pill__hint">after effort cap</span>
      </div>
      <div class="derived-pill">
        <span class="derived-pill__label">Skills packed</span>
        <span class="derived-pill__value">${preview.maxSkills}</span>
        <span class="derived-pill__hint">live count</span>
      </div>
      <div class="derived-pill">
        <span class="derived-pill__label">Usable input</span>
        <span class="derived-pill__value">${formatTokens(preview.usableInputTokens)}</span>
        <span class="derived-pill__hint">${formatPctWhole(pctOf(preview.usableInputTokens, W))} of window</span>
      </div>
    </div>
  `;
}

function renderTabs() {
  const nav = $('#band-tabs');
  nav.innerHTML = '';
  for (const band of state.data.bands) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `${band.label}<span class="sub">${band.rangeLabel}</span>`;
    btn.classList.toggle('active', band.id === state.band);
    btn.addEventListener('click', () => {
      state.band = band.id;
      state.previewWindow = band.defaultPreviewWindow ?? band.exampleWindows[1];
      $('#preview-window').value = String(state.previewWindow);
      renderTabs();
      renderAll(false);
    });
    nav.appendChild(btn);
  }
}

function legendSharePct(sliceId, preview) {
  const overlay = state.draft.window[state.band] ?? {};
  const base = state.data.baseWindow;
  const pick = (key) =>
    typeof overlay[key] === 'number' ? overlay[key] : base[key];

  if (sliceId === 'repository') return pick('repositoryShare');
  if (sliceId === 'conversation') return pick('conversationShare');
  if (sliceId === 'plan') return pick('planShare');
  if (sliceId === 'skills') return pick('skillsShare');
  if (sliceId === 'output') {
    return preview.maximumOutputTokens / Math.max(1, preview.contextWindowTokens);
  }
  if (sliceId === 'tools') {
    return preview.toolSchemaTokens / Math.max(1, preview.contextWindowTokens);
  }
  if (sliceId === 'free') {
    return preview.freeUsableShare;
  }
  return null;
}

function renderBudget() {
  const preview = currentPreview();
  const W = preview.contextWindowTokens;

  $('#budget-bar').innerHTML = preview.slices
    .filter((s) => s.tokens > 0)
    .map((s) => {
      const pct = Math.max(0.5, pctOf(s.tokens, W) * 100);
      return `<span title="${s.label}" style="width:${pct}%;background:${s.color}"></span>`;
    })
    .join('');

  $('#budget-legend').innerHTML = preview.slices
    .map((s) => {
      const cls = s.id === 'free' ? ' class="is-free"' : '';
      const share = legendSharePct(s.id, preview);
      const isModule = ['repository', 'conversation', 'plan', 'skills', 'free'].includes(s.id);
      const primaryPct = isModule && share != null
        ? formatPctWhole(share)
        : formatPctWhole(pctOf(s.tokens, W));
      const note = isModule
        ? `${primaryPct} of usable`
        : `${primaryPct} of window`;
      return `<li${cls} data-slice="${s.id}">
        <span class="swatch" style="background:${s.color}"></span>
        <span class="name">${s.label}</span>
        <span class="pct">${note}</span>
        <span class="tok">${formatTokens(s.tokens)} tok</span>
      </li>`;
    })
    .join('');

  // Scroll to matching field when clicking legend
  for (const li of $('#budget-legend').querySelectorAll('li[data-slice]')) {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      const id = li.getAttribute('data-slice');
      const keyMap = {
        output: 'outputRatio',
        tools: 'toolSchemaFallbackWindowRatio',
        repository: 'repositoryShare',
        conversation: 'conversationShare',
        plan: 'planShare',
        skills: 'skillsShare',
        free: null,
      };
      const key = keyMap[id];
      if (!key) {
        document.getElementById('free-tile')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const el = document.querySelector(`[data-key="${key}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 900);
    });
  }

  $('#budget-meta').innerHTML = [
    `<div class="meta-row"><span>Window</span><span>${formatTokens(W)}</span></div>`,
    `<div class="meta-row"><span>Usable</span><span>${formatTokens(preview.usableInputTokens)} · ${formatPctWhole(pctOf(preview.usableInputTokens, W))}</span></div>`,
    `<div class="meta-row"><span>Free</span><span>${formatPctWhole(preview.freeUsableShare)} · ${formatTokens(preview.freeTokens)}</span></div>`,
    `<div class="meta-row"><span>Output reserve</span><span>${formatTokens(preview.maximumOutputTokens)}</span></div>`,
  ].join('');

  renderDerivedPanel(preview);
  renderFreeTile(preview);
}

function helpLiveBlock(field, kind, preview) {
  const bandId = state.band;
  const base = kind === 'window' ? state.data.baseWindow : state.data.baseLoop;
  const value = effectiveValue(kind, bandId, field.key, base);
  const isRatio = field.kind === 'ratio';
  const uiValue = isRatio ? ratioToPct(value) : value;
  const stats = tileTokenStats(field, preview);
  const forLabel = field.forLabel ?? field.label.toLowerCase();
  const W = preview.contextWindowTokens;

  if (stats && typeof stats.tokens === 'number') {
    const shareOfUsable = field.shareOf === 'usable';
    return `<div class="help-live">
      <strong>On preview ${formatTokens(W)} tokens</strong>
      <p>${isRatio ? `${uiValue}%` : '—'} → <strong>${formatTokens(stats.tokens)} tokens</strong> for ${forLabel}</p>
      <p class="help-live__sub">${
        shareOfUsable
          ? `${uiValue}% × ${formatTokens(stats.of)} usable = ${formatTokens(stats.tokens)} tok (that’s ${formatPctWhole(pctOf(stats.tokens, W))} of the full window). Free usable ${formatPctWhole(preview.freeUsableShare)}.`
          : `Taken from the full window before usable input is computed.`
      }</p>
    </div>`;
  }

  if (stats && typeof stats.count === 'number') {
    const labels = countRoleLabel(field);
    return `<div class="help-live">
      <strong>Setting vs live at ${formatTokens(W)}</strong>
      <p>${labels.setting}: <strong>${uiValue}</strong> · ${labels.live}: <strong>${stats.count} ${stats.unit}</strong></p>
      <p class="help-live__sub">The slider is a ceiling. Live count scales with usable input and may stay lower on small windows.</p>
    </div>`;
  }

  return `<div class="help-live"><strong>${state.band}</strong><p>${isRatio ? `${uiValue}%` : uiValue}</p></div>`;
}

function openHelp(field, kind) {
  state.helpField = field;
  state.helpKind = kind;
  const preview = currentPreview();
  const story = (field.story ?? '').replace(/\n/g, '<br/>');

  $('#help-group').textContent = field.group;
  $('#help-title').textContent = field.label;
  $('#help-body').innerHTML = `
    ${helpLiveBlock(field, kind, preview)}
    <div class="help-block">
      <h3>In plain English</h3>
      <p>${field.plain ?? '—'}</p>
    </div>
    <div class="help-grid">
      <div class="effect-box up"><strong>If you raise it</strong>${field.whenHigher}</div>
      <div class="effect-box down"><strong>If you lower it</strong>${field.whenLower}</div>
    </div>
    <div class="help-block">
      <h3>Story (prompt → when → what → tip)</h3>
      <p>${story || field.example || '—'}</p>
    </div>
    <div class="help-block">
      <h3>Try this prompt</h3>
      <div class="help-prompt">${field.examplePrompt ?? '—'}</div>
    </div>
  `;

  $('#help-backdrop').classList.add('open');
  $('#help-drawer').classList.add('open');
  $('#help-backdrop').setAttribute('aria-hidden', 'false');
  $('#help-drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
}

function closeHelp() {
  state.helpField = null;
  state.helpKind = null;
  $('#help-backdrop').classList.remove('open');
  $('#help-drawer').classList.remove('open');
  $('#help-backdrop').setAttribute('aria-hidden', 'true');
  $('#help-drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}

function renderField(field, kind, base, root) {
  const bandId = state.band;
  const preview = currentPreview();
  const value = effectiveValue(kind, bandId, field.key, base);
  const overridden = isOverridden(kind, bandId, field.key);
  const baseVal = base[field.key];
  const isRatio = field.kind === 'ratio';

  const uiValue = isRatio ? ratioToPct(value) : value;
  const uiMin = isRatio ? ratioToPct(field.min) : field.min;
  const uiMax = isRatio ? ratioToPct(field.max) : field.max;
  const uiStep = isRatio ? Math.max(1, ratioToPct(field.step)) : field.step;
  const baseChip = isRatio
    ? `base ${ratioToPct(baseVal)}%`
    : `base ${baseVal ?? '—'}`;

  const wrap = document.createElement('div');
  wrap.className = `field${overridden ? ' overridden' : ''}`;
  wrap.dataset.key = field.key;

  const controlsLabel = field.countRole
    ? countRoleLabel(field).setting
    : isRatio
      ? 'Share'
      : 'Setting';

  wrap.innerHTML = `
    <div class="field-row">
      <label for="${kind}-${field.key}">${field.label}</label>
      <button type="button" class="icon-btn help-trigger" aria-label="Explain ${field.label}">${ICON_INFO}</button>
    </div>
    ${renderPreviewBlock(field, preview, uiValue, isRatio)}
    <p class="field-oneline">${oneLineWhy(field)}</p>
    <div class="field-controls">
      <span class="field-controls__label">${controlsLabel}</span>
      ${isRatio || field.kind === 'int' ? `<input type="range" min="${uiMin}" max="${uiMax ?? 100}" step="${uiStep}" value="${uiValue}" />` : ''}
      <input id="${kind}-${field.key}" type="number" min="${uiMin}" max="${uiMax ?? ''}" step="${uiStep}" value="${uiValue}" />
      ${isRatio ? '<span class="unit">%</span>' : ''}
      <span class="chip${overridden ? ' custom' : ''}">${overridden ? 'custom' : baseChip}</span>
      ${overridden ? `<button type="button" class="reset">reset</button>` : ''}
    </div>
    <div class="field-effects">${effectChips(field)}</div>
  `;

  const applyUiValue = (raw) => {
    if (!Number.isFinite(raw)) return;
    const stored = isRatio
      ? pctToRatio(raw)
      : field.kind === 'int'
        ? Math.round(raw)
        : Math.round(raw * 1000) / 1000;
    setOverride(kind, bandId, field.key, stored, base);
    const wasHelp = state.helpField?.key === field.key && state.helpKind === kind;
    renderAll(false);
    if (wasHelp) openHelp(field, kind);
  };

  wrap.querySelector('input[type="number"]').addEventListener('input', (e) => {
    applyUiValue(Number(e.target.value));
  });
  const range = wrap.querySelector('input[type="range"]');
  if (range) {
    range.addEventListener('input', (e) => applyUiValue(Number(e.target.value)));
  }
  const reset = wrap.querySelector('.reset');
  if (reset) {
    reset.addEventListener('click', () => {
      clearOverride(kind, bandId, field.key);
      renderAll(false);
    });
  }
  wrap.querySelector('.help-trigger').addEventListener('click', () => openHelp(field, kind));
  root.appendChild(wrap);
}

function renderFieldList(containerId, fields, kind, base) {
  const root = $(containerId);
  root.innerHTML = '';
  for (const field of fields) renderField(field, kind, base, root);
}

function renderAll(clearStatus = true) {
  renderBudget();
  const windowPrimary = state.data.windowFields.filter((f) => f.primary);
  const loopPrimary = state.data.loopFields.filter((f) => f.primary);
  const advanced = [
    ...state.data.windowFields.filter((f) => !f.primary).map((f) => ({ ...f, _kind: 'window' })),
    ...state.data.loopFields.filter((f) => !f.primary).map((f) => ({ ...f, _kind: 'loop' })),
  ];

  renderFieldList('#window-fields', windowPrimary, 'window', state.data.baseWindow);
  renderFieldList('#loop-fields', loopPrimary, 'loop', state.data.baseLoop);

  const advRoot = $('#advanced-fields');
  advRoot.innerHTML = '';
  for (const field of advanced) {
    const kind = field._kind;
    const { _kind, ...clean } = field;
    renderField(
      clean,
      kind,
      kind === 'window' ? state.data.baseWindow : state.data.baseLoop,
      advRoot,
    );
  }

  if (clearStatus) showStatus('');
}

async function load() {
  showStatus('Loading…');
  const res = await fetch('/api/state');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load');
  state.data = data;
  state.draft = structuredClone(data.tables);
  const band = data.bands.find((b) => b.id === state.band) ?? data.bands[0];
  state.band = band.id;
  state.previewWindow = band.defaultPreviewWindow ?? band.exampleWindows[1];
  $('#preview-window').value = String(state.previewWindow);
  $('#path-loop').textContent = data.paths.loop;
  $('#path-window').textContent = data.paths.window;
  renderTabs();
  renderAll(false);
  showStatus('');
}

$('#reload').addEventListener('click', () => load().catch((e) => showStatus(e.message, true)));

$('#preview-window').addEventListener('input', (e) => {
  const n = Number(e.target.value);
  if (Number.isFinite(n) && n >= 8000) {
    state.previewWindow = Math.floor(n);
    const f = state.helpField;
    const k = state.helpKind;
    renderAll(false);
    if (f && k) openHelp(f, k);
  }
});

$('#save').addEventListener('click', async () => {
  try {
    showStatus('Saving…');
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables: state.draft }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    state.draft = structuredClone(body.tables);
    showStatus('Saved. Rebuild: pnpm --filter @mitii/v8 build');
  } catch (err) {
    showStatus(err.message, true);
  }
});

$('#help-close').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeHelp();
});
$('#help-backdrop').addEventListener('click', closeHelp);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.helpField) closeHelp();
});

load().catch((err) => showStatus(err.message, true));
