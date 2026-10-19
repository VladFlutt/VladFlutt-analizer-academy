// Виртуальная передняя панель R&S FSL18: экран, программные клавиши, функциональные клавиши,
// цифровая клавиатура и вращающаяся ручка. Работает поверх модели из analyzer.js.

import { Analyzer, RBWS, VBWS, NPTS, FMAX, FMAX_ENTRY, nearestLog, fmtFreq, fmtMarkerFreq, fmtTime, DET_LABEL, MODE_LABEL } from './analyzer.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmtDb = (v, d = 2) => (v == null || !isFinite(v) ? '---' : (v >= 0 ? ' ' : '') + v.toFixed(d))

function step125(v, dir) {
  const e = Math.floor(Math.log10(v))
  const m = v / 10 ** e
  const seq = [1, 2, 5, 10]
  let i = seq.findIndex((x) => Math.abs(x - m) < 1e-6)
  if (i < 0) i = dir > 0 ? seq.findIndex((x) => x > m) - 1 : seq.findIndex((x) => x >= m)
  const ni = i + dir
  if (ni > 2) return 10 ** (e + 1)
  if (ni < 0) return 5 * 10 ** (e - 1)
  return seq[ni] * 10 ** e
}
const stepList = (list, v, dir) => {
  const i = list.indexOf(nearestLog(list, v))
  return list[clamp(i + dir, 0, list.length - 1)]
}

export function mountAnalyzer(root, opts = {}) {
  const a = opts.analyzer || new Analyzer()
  window.__fsl = a
  let menu = 'FREQ'
  let lastMenu = 'FREQ'
  let stack = []
  let entry = null
  let buf = ''
  let toastTimer = null
  let raf = 0
  let destroyed = false

  root.innerHTML = `
  <div class="fsl">
    <div class="fsl-front">
      <div class="fsl-brand"><b>ROHDE&amp;SCHWARZ</b><span>SPECTRUM ANALYZER · 9 kHz … 18 GHz</span><em>FSL 18</em></div>
      <div class="fsl-main">
        <div class="fsl-screen">
          <canvas width="640" height="480" aria-label="Экран анализатора спектра"></canvas>
          <div class="fsl-entry" hidden></div>
          <div class="fsl-toast" hidden></div>
        </div>
        <div class="fsl-soft">
          <div class="fsl-menu-title"></div>
          ${Array.from({ length: 8 }, (_, i) => `<button class="sk" data-sk="${i}"></button>`).join('')}
          <button class="sk sk-up" data-up="1" title="Предыдущее меню">⯅ меню</button>
        </div>
      </div>
    </div>
    <div class="fsl-keys">
      <div class="kgrp"><div class="kgrp-t">SYSTEM</div>
        <button class="hk hk-preset" data-k="PRESET">PRESET</button><button class="hk" data-k="FILE">FILE</button>
        <button class="hk" data-k="SETUP">SETUP</button><button class="hk" data-k="PRINT">PRINT</button>
        <button class="hk" data-k="MODE">MODE</button><button class="hk" data-k="HELP">HELP</button>
      </div>
      <div class="kgrp"><div class="kgrp-t">FUNCTION</div>
        <button class="hk" data-k="FREQ">FREQ</button><button class="hk" data-k="SPAN">SPAN</button><button class="hk" data-k="AMPT">AMPT</button>
        <button class="hk" data-k="MKR">MKR</button><button class="hk" data-k="BW">BW</button><button class="hk" data-k="SWEEP">SWEEP</button>
        <button class="hk" data-k="MKRTO">MKR→</button><button class="hk" data-k="TRACE">TRACE</button><button class="hk" data-k="TRIG">TRIG</button>
        <button class="hk" data-k="MEAS">MEAS</button><button class="hk" data-k="LINES">LINES</button><button class="hk" data-k="MENU">MENU</button>
      </div>
      <div class="kgrp kpad"><div class="kgrp-t">DATA ENTRY</div>
        ${['7', '8', '9'].map((d) => `<button class="hk num" data-d="${d}">${d}</button>`).join('')}<button class="hk unit" data-u="G">GHz<small>-dBm</small></button>
        ${['4', '5', '6'].map((d) => `<button class="hk num" data-d="${d}">${d}</button>`).join('')}<button class="hk unit" data-u="M">MHz<small>dBm</small></button>
        ${['1', '2', '3'].map((d) => `<button class="hk num" data-d="${d}">${d}</button>`).join('')}<button class="hk unit" data-u="k">kHz<small>dB</small></button>
        <button class="hk num" data-d="0">0</button><button class="hk num" data-d=".">.</button><button class="hk num" data-d="-">±</button><button class="hk unit" data-u="H">Hz<small>dB</small></button>
        <button class="hk" data-k="ESC">ESC</button><button class="hk" data-k="BS">⌫</button><button class="hk hk-enter" data-k="ENTER">ENTER</button>
      </div>
      <div class="kgrp knob-grp"><div class="kgrp-t">ROTARY KNOB</div>
        <button class="hk" data-knob="-1" title="Повернуть влево">◀</button>
        <div class="knob" title="Крутите колёсиком мыши"><span></span></div>
        <button class="hk" data-knob="1" title="Повернуть вправо">▶</button>
        <button class="hk" data-arrow="1" title="Шаг вверх">⯅</button><button class="hk" data-arrow="-1" title="Шаг вниз">⯆</button>
      </div>
    </div>
  </div>`

  const cv = root.querySelector('canvas')
  const ctx = cv.getContext('2d')
  const entryEl = root.querySelector('.fsl-entry')
  const toastEl = root.querySelector('.fsl-toast')
  const softEls = [...root.querySelectorAll('[data-sk]')]
  const titleEl = root.querySelector('.fsl-menu-title')
  const knobEl = root.querySelector('.knob span')
  let knobAngle = 0

  function toast(msg) {
    toastEl.textContent = msg
    toastEl.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastEl.hidden = true }, 2600)
  }

  // ---------- поля ввода ----------
  const s = () => a.s
  const E = {
    center: () => ({ label: 'Center Frequency', kind: 'freq', get: () => s().center, set: (v) => a.change((x) => { x.center = v }), step: (d, f) => s().center + d * (f ? s().cfStep / 10 : s().cfStep) }),
    start: () => ({ label: 'Start Frequency', kind: 'freq', get: () => a.start, set: (v) => setStartStop(v, a.stop), step: (d, f) => a.start + d * (f ? s().cfStep / 10 : s().cfStep) }),
    stop: () => ({ label: 'Stop Frequency', kind: 'freq', get: () => a.stop, set: (v) => setStartStop(a.start, v), step: (d, f) => a.stop + d * (f ? s().cfStep / 10 : s().cfStep) }),
    span: () => ({ label: 'Frequency Span', kind: 'freq', get: () => s().span, set: (v) => setSpan(v), step: (d) => step125(s().span || 10, d) }),
    cfManual: () => ({ label: 'CF Stepsize', kind: 'freq', get: () => s().cfStep, set: (v) => a.change((x) => { x.cfStepMode = 'manual'; x.cfStep = Math.max(1, v) }, true), step: (d) => step125(s().cfStep, d) }),
    ref: () => ({ label: 'Reference Level', kind: 'level', get: () => s().ref, set: (v) => a.change((x) => { x.ref = clamp(v, -80 + x.refOffset, 20 + x.refOffset) }), step: (d, f) => s().ref + d * (f ? 1 : 10) }),
    range: () => ({ label: 'Range Log', kind: 'db', get: () => s().range, set: (v) => a.change((x) => { x.range = clamp(Math.round(v / 10) * 10, 10, 100) }, true), step: (d) => s().range + d * 10 }),
    att: () => ({ label: 'RF Attenuation', kind: 'db', get: () => s().att, set: (v) => a.change((x) => { x.attAuto = false; x.att = clamp(Math.round(v / 5) * 5, 0, 40) }), step: (d) => s().att + d * 5 }),
    offset: () => ({ label: 'Ref Level Offset', kind: 'db', get: () => s().refOffset, set: (v) => a.change((x) => { const d = clamp(v, -200, 200) - x.refOffset; x.refOffset += d; x.ref += d }), step: (d, f) => s().refOffset + d * (f ? 0.1 : 1) }),
    rbw: () => ({ label: 'Res BW', kind: 'freq', get: () => s().rbw, set: (v) => a.change((x) => { x.rbwAuto = false; x.rbw = nearestLog(RBWS, Math.max(1, v)) }), step: (d) => stepList(RBWS, s().rbw, d) }),
    vbw: () => ({ label: 'Video BW', kind: 'freq', get: () => s().vbw, set: (v) => a.change((x) => { x.vbwAuto = false; x.vbw = nearestLog(VBWS, Math.max(1, v)) }), step: (d) => stepList(VBWS, s().vbw, d) }),
    swt: () => ({ label: 'Sweep Time', kind: 'time', get: () => s().swt, set: (v) => a.change((x) => { x.swtAuto = false; x.swt = clamp(v, x.span > 0 ? 0.0025 : 1e-6, 16000) }), step: (d) => s().swt * (d > 0 ? 1.25 : 0.8) }),
    count: () => ({ label: 'Sweep Count', kind: 'num', get: () => s().sweepCount, set: (v) => a.change((x) => { x.sweepCount = clamp(Math.round(v), 0, 32767) }), step: (d) => s().sweepCount + d }),
    marker: () => ({ label: 'Marker ' + (s().active + 1), kind: a.zeroSpan ? 'time' : 'freq', get: () => s().markers[s().active].x, set: (v) => moveMarker(v), step: (d, f) => s().markers[s().active].x + d * (a.zeroSpan ? s().swt : s().span) / (f ? NPTS - 1 : 10) }),
    ndb: () => ({ label: 'n dB down', kind: 'db', get: () => s().ndbValue, set: (v) => a.change((x) => { x.ndbValue = clamp(Math.abs(v), 0.1, 100) }, true), step: (d) => s().ndbValue + d }),
    chbw: () => ({ label: 'Channel Bandwidth', kind: 'freq', get: () => s().chBw, set: (v) => a.change((x) => { x.chBw = clamp(v, 100, 1e9) }, true), step: (d) => step125(s().chBw, d) }),
    chsp: () => ({ label: 'Channel Spacing', kind: 'freq', get: () => s().chSpacing, set: (v) => a.change((x) => { x.chSpacing = clamp(v, 100, 1e9) }, true), step: (d) => step125(s().chSpacing, d) }),
    obw: () => ({ label: '% Power Bandwidth', kind: 'num', get: () => s().obwPct, set: (v) => a.change((x) => { x.obwPct = clamp(v, 10, 99.9) }, true), step: (d) => s().obwPct + d * 0.1 }),
    dl1: () => ({ label: 'Display Line 1', kind: 'level', get: () => s().dl1 ?? s().ref - 20, set: (v) => a.change((x) => { x.dl1 = v }, true), step: (d, f) => (s().dl1 ?? s().ref - 20) + d * (f ? 0.1 : 1) }),
    dl2: () => ({ label: 'Display Line 2', kind: 'level', get: () => s().dl2 ?? s().ref - 40, set: (v) => a.change((x) => { x.dl2 = v }, true), step: (d, f) => (s().dl2 ?? s().ref - 40) + d * (f ? 0.1 : 1) }),
    limit: () => ({ label: 'Upper Limit Line', kind: 'level', get: () => s().limit ?? s().ref - 10, set: (v) => a.change((x) => { x.limit = v }, true), step: (d, f) => (s().limit ?? s().ref - 10) + d * (f ? 0.1 : 1) }),
    trig: () => ({ label: 'Trigger Level %', kind: 'num', get: () => s().trigLevel, set: (v) => a.change((x) => { x.trigLevel = clamp(v, 0, 100) }, true), step: (d) => s().trigLevel + d }),
  }

  function setSpan(v) {
    a.change((x) => {
      if (x.span !== v) x.lastSpan = x.span
      if (v <= 0) { x.span = 0; if (x.swtAuto) { x.swtAuto = false; x.swt = 0.001 } return }
      x.span = clamp(v, 10, FMAX_ENTRY)
      if (!x.swtAuto && x.swt < 0.0025) x.swtAuto = true
    })
  }
  function setStartStop(lo, hi) {
    lo = clamp(lo, 0, FMAX_ENTRY - 10); hi = clamp(hi, lo + 10, FMAX_ENTRY)
    a.change((x) => { x.lastSpan = x.span; x.span = hi - lo; x.center = (lo + hi) / 2; if (!x.swtAuto && x.swt < 0.0025) x.swtAuto = true })
  }
  function moveMarker(v) {
    const lo = a.zeroSpan ? 0 : a.start, hi = a.zeroSpan ? s().swt : a.stop
    s().markers[s().active].x = clamp(v, lo, hi)
    s().markers[s().active].on = true
    a.emit('marker')
  }

  function openEntry(name) {
    entry = E[name]()
    entry.name = name
    buf = ''
    renderEntry()
  }
  function closeEntry() { entry = null; buf = ''; renderEntry() }

  function fmtEntryValue(e, v) {
    if (e.kind === 'freq') return fmtFreq(v)
    if (e.kind === 'level') return v.toFixed(2) + ' dBm'
    if (e.kind === 'db') return v.toFixed(1) + ' dB'
    if (e.kind === 'time') return fmtTime(v)
    return String(+(+v).toFixed(2))
  }
  function renderEntry() {
    if (!entry) { entryEl.hidden = true; return }
    entryEl.hidden = false
    const hint = { freq: 'единицы: GHz · MHz · kHz · Hz', level: 'единицы: dBm или −dBm', db: 'единица: dB', time: 'GHz=s · MHz=ms · kHz=µs · Hz=ns', num: 'ENTER' }[entry.kind]
    entryEl.innerHTML = `<div class="fe-l">${esc(entry.label)}</div><div class="fe-v">${buf ? esc(buf) + '<i>▏</i>' : esc(fmtEntryValue(entry, entry.get()))}</div><div class="fe-h">${hint}</div>`
  }

  function commit(unit) {
    if (!entry) return
    if (!buf) { if (unit === 'ENTER') closeEntry(); return }
    let v = parseFloat(buf)
    if (!isFinite(v)) { buf = ''; renderEntry(); return }
    const k = entry.kind
    if (k === 'freq') v *= { G: 1e9, M: 1e6, k: 1e3, H: 1, ENTER: 1 }[unit]
    else if (k === 'level') v = unit === 'G' ? -Math.abs(v) : v
    else if (k === 'time') v *= { G: 1, M: 1e-3, k: 1e-6, H: 1e-9, ENTER: 1 }[unit]
    entry.set(v)
    buf = ''
    renderEntry()
    renderSoft()
  }

  function turn(dir, fine) {
    if (entry) { buf = ''; entry.set(entry.step(dir, fine)); renderEntry(); renderSoft(); return }
    const m = s().markers[s().active]
    if (m.on) { openEntry('marker'); entry.set(entry.step(dir, fine)); renderEntry(); return }
    toast('Нет активного поля ввода: нажмите функциональную клавишу')
  }

  // ---------- меню программных клавиш ----------
  const tog = (on) => ({ on })
  const M = {
    FREQ: () => ({ title: 'Frequency', keys: [
      { label: 'Center', act: () => openEntry('center'), ...tog(entry?.name === 'center') },
      { label: 'Start', act: () => openEntry('start'), ...tog(entry?.name === 'start') },
      { label: 'Stop', act: () => openEntry('stop'), ...tog(entry?.name === 'stop') },
      { label: 'CF Stepsize', sub: 'CFSTEP' },
    ] }),
    CFSTEP: () => ({ title: 'CF Stepsize', keys: [
      { label: a.zeroSpan ? '0.1*RBW' : '0.1*Span', act: () => a.change((x) => { x.cfStepMode = 'span'; x.cfStepFactor = 0.1 }, true), on: s().cfStepMode === 'span' && s().cfStepFactor === 0.1 },
      { label: a.zeroSpan ? '0.5*RBW' : '0.5*Span', act: () => a.change((x) => { x.cfStepMode = 'span'; x.cfStepFactor = 0.5 }, true), on: s().cfStepMode === 'span' && s().cfStepFactor === 0.5 },
      { label: '=Center', act: () => a.change((x) => { x.cfStepMode = 'center'; x.cfStep = x.center }, true), on: s().cfStepMode === 'center' },
      { label: '=Marker', act: () => { if (!s().markers[s().active].on) return toast('Сначала включите маркер (MKR)'); a.change((x) => { x.cfStepMode = 'marker'; x.cfStep = x.markers[x.active].x }, true) }, on: s().cfStepMode === 'marker' },
      { label: 'Manual', act: () => openEntry('cfManual'), on: s().cfStepMode === 'manual' },
    ] }),
    SPAN: () => ({ title: 'Span', keys: [
      { label: 'Span Manual', act: () => openEntry('span'), on: entry?.name === 'span' },
      { label: 'Sweeptime Manual', act: () => openEntry('swt'), on: entry?.name === 'swt' },
      { label: 'Start', act: () => openEntry('start') },
      { label: 'Stop', act: () => openEntry('stop') },
      { label: 'Full Span', act: () => { a.change((x) => { x.lastSpan = x.span; x.span = FMAX; x.center = FMAX / 2; if (!x.swtAuto && x.swt < 0.0025) x.swtAuto = true }); closeEntry() } },
      { label: 'Zero Span', act: () => { setSpan(0); closeEntry() }, on: a.zeroSpan },
      { label: 'Last Span', act: () => { setSpan(s().lastSpan); closeEntry() } },
    ] }),
    AMPT: () => ({ title: 'Amplitude', keys: [
      { label: 'Ref Level', act: () => openEntry('ref'), on: entry?.name === 'ref' },
      { label: 'Range Log', act: () => openEntry('range'), on: entry?.name === 'range' },
      { label: 'Preamp On/Off', act: () => a.change((x) => { x.preamp = !x.preamp }), on: s().preamp },
      { label: 'RF Atten Manual', act: () => openEntry('att'), on: !s().attAuto },
      { label: 'RF Atten Auto', act: () => { a.change((x) => { x.attAuto = true }); closeEntry() }, on: s().attAuto },
      { label: 'Ref Level Offset', act: () => openEntry('offset'), on: s().refOffset !== 0 },
    ] }),
    BW: () => ({ title: 'Bandwidth', keys: [
      { label: 'Res BW Manual', act: () => openEntry('rbw'), on: !s().rbwAuto },
      { label: 'Res BW Auto', act: () => { a.change((x) => { x.rbwAuto = true }); closeEntry() }, on: s().rbwAuto },
      { label: 'Video BW Manual', act: () => openEntry('vbw'), on: !s().vbwAuto },
      { label: 'Video BW Auto', act: () => { a.change((x) => { x.vbwAuto = true }); closeEntry() }, on: s().vbwAuto },
      { label: 'Sweeptime Manual', act: () => openEntry('swt'), on: !s().swtAuto },
      { label: 'Sweeptime Auto', act: () => { if (a.zeroSpan) return toast('В нулевом диапазоне время задаётся вручную'); a.change((x) => { x.swtAuto = true }); closeEntry() }, on: s().swtAuto },
    ] }),
    SWEEP: () => ({ title: 'Sweep', keys: [
      { label: 'Continuous Sweep', act: () => { a.change((x) => { x.cont = true }); a.running = true }, on: s().cont },
      { label: 'Single Sweep', act: () => { a.change((x) => { x.cont = false }); a.target = Math.max(1, s().sweepCount); a.running = true }, on: !s().cont },
      { label: 'Continue Single Sweep', act: () => { if (s().cont) return; a.target = a.sweeps + Math.max(1, s().sweepCount); a.running = true } },
      { label: 'Sweeptime Manual', act: () => openEntry('swt'), on: !s().swtAuto },
      { label: 'Sweeptime Auto', act: () => { if (a.zeroSpan) return toast('В нулевом диапазоне время задаётся вручную'); a.change((x) => { x.swtAuto = true }); closeEntry() }, on: s().swtAuto },
      { label: 'Sweep Count', act: () => openEntry('count'), on: entry?.name === 'count' },
    ] }),
    TRIG: () => ({ title: 'Trigger', keys: [
      { label: 'Free Run', act: () => a.change((x) => { x.trigger = 'free' }), on: s().trigger === 'free' },
      { label: 'Video', act: () => { a.change((x) => { x.trigger = 'video' }); openEntry('trig') }, on: s().trigger === 'video' },
    ] }),
    TRACE: () => ({ title: 'Trace 1', keys: [
      { label: 'Trace Mode', sub: 'TMODE' },
      { label: 'Detector Auto Select', act: () => a.change((x) => { x.detAuto = true }), on: s().detAuto },
      { label: 'Detector Manual Select', sub: 'DET', on: !s().detAuto },
      { label: 'Sweep Count', act: () => openEntry('count'), on: entry?.name === 'count' },
    ] }),
    TMODE: () => ({ title: 'Trace Mode', keys: [['clrw', 'Clear Write'], ['max', 'Max Hold'], ['min', 'Min Hold'], ['avg', 'Average'], ['view', 'View'], ['blank', 'Blank']].map(([k, l]) => ({ label: l, act: () => a.change((x) => { x.traceMode = k; if (k === 'view' || k === 'blank') a.running = false; else a.running = true }, k === 'view' || k === 'blank'), on: s().traceMode === k })) }),
    DET: () => ({ title: 'Detector', keys: [['apk', 'Detector Auto Peak'], ['pk', 'Detector Positive Peak'], ['mi', 'Detector Negative Peak'], ['sa', 'Detector Sample'], ['rms', 'Detector RMS'], ['av', 'Detector Average']].map(([k, l]) => ({ label: l, act: () => a.change((x) => { x.detAuto = false; x.detector = k }), on: !s().detAuto && s().detector === k })) }),
    MKR: () => ({ title: 'Marker', keys: [
      ...[0, 1, 2, 3].map((i) => ({ label: `Marker ${i + 1}`, act: () => markerKey(i), on: s().markers[i].on && s().active === i })),
      { label: 'Marker Norm/Delta', act: () => { const m = s().markers[s().active]; if (s().active === 0) return toast('Маркер 1 — всегда нормальный, опорный для дельта-маркеров'); m.delta = !m.delta; a.emit('marker') }, on: s().markers[s().active].delta && s().active > 0 },
      { label: 'Sig Count On/Off', act: () => { ensureM1(); a.change((x) => { x.sigCount = !x.sigCount }, true) }, on: s().sigCount },
      { label: 'Noise Meas On/Off', act: () => { ensureM1(); a.change((x) => { x.noiseMeas = !x.noiseMeas; if (x.noiseMeas && x.detAuto && x.traceMode === 'clrw') { x.detAuto = false; x.detector = 'sa' } }, true) }, on: s().noiseMeas },
      { label: 'More ▸', sub: 'MKR2' },
    ] }),
    MKR2: () => ({ title: 'Marker (2)', keys: [
      { label: 'Phase Noise/ Ref Fixed', sub: 'PHN' },
      { label: 'n dB down', act: () => { ensureM1(); a.change((x) => { x.ndb = !x.ndb }, true); if (s().ndb) openEntry('ndb') }, on: s().ndb },
      { label: 'All Marker Off', act: () => { a.change((x) => { x.markers.forEach((m) => { m.on = false }); x.active = 0; x.sigCount = false; x.noiseMeas = false; x.ndb = false; x.refFixed = null; x.phaseNoise = false }, true); closeEntry() } },
    ] }),
    PHN: () => ({ title: 'Phase Noise', keys: [
      { label: 'Phase Noise On/Off', act: () => { refFixed(true) }, on: !!s().refFixed && s().phaseNoise },
      { label: 'Ref Fixed', act: () => { refFixed(false) }, on: !!s().refFixed && !s().phaseNoise },
      { label: 'Peak Search', act: () => { a.markerPeak(0); s().refFixed = { x: s().markers[0].x, level: a.levelAt(s().markers[0].x) }; a.emit('marker') } },
      { label: 'Ref Point Off', act: () => { a.change((x) => { x.refFixed = null; x.phaseNoise = false }, true) } },
    ] }),
    MKRTO: () => ({ title: 'Marker →', keys: [
      { label: 'Peak', act: () => { a.markerPeak(); openEntry('marker') } },
      { label: 'Next Peak', act: () => { ensureActive(); a.markerNextPeak(); openEntry('marker') } },
      { label: 'Min', act: () => { a.markerMin(); openEntry('marker') } },
      { label: 'Center =Mkr Freq', act: () => { if (a.zeroSpan) return toast('Только при span > 0'); ensureActive(); const f = s().markers[s().active].x; a.change((x) => { x.center = f }) } },
      { label: 'Ref Lvl =Mkr Lvl', act: () => { ensureActive(); const l = a.levelAt(s().markers[s().active].x); a.change((x) => { x.ref = Math.ceil(l * 10) / 10 }) } },
    ] }),
    MEAS: () => ({ title: 'Measurement', keys: [
      { label: 'Channel Power (CP)', sub: 'CP', act: () => setMeas('cp'), on: s().meas === 'cp' },
      { label: 'Adjacent Chan (ACP)', sub: 'ACP', act: () => setMeas('acp'), on: s().meas === 'acp' },
      { label: 'OBW', sub: 'OBW', act: () => setMeas('obw'), on: s().meas === 'obw' },
      { label: 'TOI', act: () => setMeas('toi'), on: s().meas === 'toi' },
      { label: 'AM Mod Depth', act: () => setMeas('am'), on: s().meas === 'am' },
      { label: 'All Functions Off', act: () => setMeas(null) },
    ] }),
    CP: () => ({ title: 'Channel Power', keys: [
      { label: 'Channel Bandwidth', act: () => openEntry('chbw'), on: entry?.name === 'chbw' },
      { label: 'Adjust Settings', act: () => { a.adjustSettings(); toast('Span, RBW, VBW и детектор RMS настроены для канала') } },
      { label: 'Sweep Time', act: () => openEntry('swt') },
      { label: 'Adjust Ref Level', act: () => adjustRef() },
    ] }),
    ACP: () => ({ title: 'Adjacent Channel Power', keys: [
      { label: 'Channel Bandwidth', act: () => openEntry('chbw'), on: entry?.name === 'chbw' },
      { label: 'Channel Spacing', act: () => openEntry('chsp'), on: entry?.name === 'chsp' },
      { label: 'Adjust Settings', act: () => { a.adjustSettings(); toast('Span, RBW, VBW и детектор RMS настроены для ACP') } },
      { label: 'Sweep Time', act: () => openEntry('swt') },
      { label: 'Adjust Ref Level', act: () => adjustRef() },
    ] }),
    OBW: () => ({ title: 'Occupied Bandwidth', keys: [
      { label: '% Power Bandwidth', act: () => openEntry('obw'), on: entry?.name === 'obw' },
      { label: 'Channel Bandwidth', act: () => openEntry('chbw'), on: entry?.name === 'chbw' },
      { label: 'Adjust Settings', act: () => { a.adjustSettings(); toast('Span = 3 × полоса канала, RBW, VBW и RMS настроены') } },
    ] }),
    LINES: () => ({ title: 'Lines', keys: [
      { label: 'Display Line 1', act: () => lineKey('dl1', -20), on: s().dl1 != null },
      { label: 'Display Line 2', act: () => lineKey('dl2', -40), on: s().dl2 != null },
      { label: 'Upper Limit Line', act: () => lineKey('limit', -10), on: s().limit != null },
      { label: 'All Lines Off', act: () => { a.change((x) => { x.dl1 = x.dl2 = x.limit = null }, true); closeEntry() } },
    ] }),
    FILE: () => ({ title: 'File', keys: [
      { label: 'Save', sub: 'FSAVE' },
      { label: 'Recall', sub: 'FRECALL' },
      { label: 'Startup Recall On/Off', act: () => { if (!sets[0]) return toast('Сначала сохраните настройки в Set 1: FILE → Save → Set 1'); startup = !startup; storeSets(); toast(startup ? 'Startup Recall: при PRESET загружается Set 1' : 'Startup Recall выключен: PRESET даёт заводские настройки') }, on: startup },
    ] }),
    FSAVE: () => ({ title: 'Save', keys: [0, 1, 2, 3].map((i) => ({ label: `Set ${i + 1}${sets[i] ? ' ✓' : ''}`, act: () => { sets[i] = JSON.parse(JSON.stringify(s())); storeSets(); toast(`Настройки сохранены в Set ${i + 1} (без трасс)`) } })) }),
    FRECALL: () => ({ title: 'Recall', keys: [0, 1, 2, 3].map((i) => ({ label: `Set ${i + 1}${sets[i] ? '' : ' (пусто)'}`, act: () => recallSet(i) })) }),
    MODE: () => ({ title: 'Mode', keys: [
      { label: 'Spectrum Analyzer', act: () => toast('Режим анализатора спектра уже выбран'), on: true },
      { label: 'Другие режимы (K…)', act: () => toast('Режимы опций K7, K9, K30, K72, K91 в тренажёре не моделируются') },
    ] }),
    SETUP: () => ({ title: 'Setup', keys: [
      { label: 'Service', sub: 'SERVICE' },
      { label: 'Reference Int/Ext', act: () => toast('Опорный сигнал: внутренний OCXO (в тренажёре внешний не подключён)') },
    ] }),
    SERVICE: () => ({ title: 'Service', keys: [
      { label: `Input RF/Cal: ${s().input === 'cal' ? 'CAL' : 'RF'}`, act: () => a.change((x) => { x.input = x.input === 'cal' ? 'rf' : 'cal' }), on: s().input === 'cal' },
    ] }),
  }

  // ---------- линии и наборы настроек ----------
  function lineKey(k, off) {
    if (s()[k] != null && entry?.name === k) { a.change((x) => { x[k] = null }, true); closeEntry(); return }
    if (s()[k] == null) a.change((x) => { x[k] = x.ref + off }, true)
    openEntry(k)
  }
  const SETS_KEY = 'fsl18-sim-sets'
  let sets = [null, null, null, null], startup = false
  try { const v = JSON.parse(localStorage.getItem(SETS_KEY) || 'null'); if (v) { sets = v.sets || sets; startup = !!v.startup } } catch {}
  function storeSets() { try { localStorage.setItem(SETS_KEY, JSON.stringify({ sets, startup })) } catch {} }
  function recallSet(i) {
    if (!sets[i]) return toast(`Set ${i + 1} пуст: сначала FILE → Save`)
    const saved = JSON.parse(JSON.stringify(sets[i]))
    a.change((x) => { Object.assign(x, saved) })
    closeEntry()
    toast(`Загружены настройки Set ${i + 1}`)
  }
  function printScreen() {
    try {
      const link = document.createElement('a')
      link.download = 'FSL18_screen.png'
      link.href = cv.toDataURL('image/png')
      link.click()
      toast('PRINT: снимок экрана сохранён в FSL18_screen.png')
    } catch { toast('PRINT: браузер не разрешил сохранить снимок экрана') }
  }

  function ensureM1() { if (!s().markers[0].on) a.markerPeak(0) }
  function ensureActive() { if (!s().markers[s().active].on) a.markerPeak() }
  function markerKey(i) {
    const m = s().markers[i]
    if (m.on && s().active === i) { m.on = false; s().active = s().markers.findIndex((x) => x.on); if (s().active < 0) s().active = 0; closeEntry(); a.emit('marker'); return }
    s().active = i
    if (!m.on) {
      if (i > 0 && !s().markers[0].on) a.markerPeak(0)
      m.delta = i > 0
      if (i === 0) a.markerPeak(0)
      else {
        // дельта-маркер встаёт на самый высокий пик, кроме того, где стоит маркер 1
        const ci = a.xToIndex(s().markers[0].x)
        const p = a.peaks().find((q) => Math.abs(q.i - ci) > 2)
        m.on = true
        m.x = p ? a.indexToX(p.i) : s().markers[0].x
        a.emit('marker')
      }
    }
    openEntry('marker')
  }
  function refFixed(phn) {
    ensureM1()
    a.change((x) => {
      const same = x.refFixed && x.phaseNoise === phn
      if (same) { x.refFixed = null; x.phaseNoise = false; return }
      x.refFixed = { x: x.markers[0].x, level: a.levelAt(x.markers[0].x) }
      x.phaseNoise = phn
      x.markers[1].on = true
      x.markers[1].delta = true
      x.markers[1].x = x.markers[0].x
      x.active = 1
    }, true)
    if (s().refFixed) openEntry('marker')
  }
  function setMeas(kind) {
    a.change((x) => { x.meas = kind }, true)
    if (kind === 'toi' || kind === 'am') ensureM1()
  }
  function adjustRef() {
    let mx = -200
    for (const v of a.trace) if (!isNaN(v)) mx = Math.max(mx, v)
    a.change((x) => { x.ref = Math.ceil(mx + 3) })
  }

  function showMenu(name, push = false) {
    if (push && menu) stack.push(menu)
    else if (!push) stack = []
    menu = name
    if (name) lastMenu = name
    renderSoft()
  }

  function renderSoft() {
    if (!menu) { titleEl.textContent = ''; softEls.forEach((b) => { b.textContent = ''; b.disabled = true; b.className = 'sk' }); return }
    const m = M[menu]()
    titleEl.textContent = m.title
    softEls.forEach((b, i) => {
      const k = m.keys[i]
      b.className = 'sk' + (k?.on ? ' on' : '') + (k?.sub ? ' has-sub' : '')
      b.disabled = !k
      b.textContent = k ? k.label : ''
    })
  }

  function hardKey(k) {
    switch (k) {
      case 'PRESET':
        a.preset(); closeEntry(); showMenu(null)
        if (startup && sets[0]) { recallSet(0); toast('PRESET: загружен Set 1 (Startup Recall)') } else toast('PRESET: исходное состояние')
        return
      case 'FILE': showMenu('FILE'); closeEntry(); return
      case 'PRINT': printScreen(); return
      case 'MODE': showMenu('MODE'); closeEntry(); return
      case 'LINES': showMenu('LINES'); closeEntry(); return
      case 'MENU': showMenu(lastMenu || 'FREQ'); return
      case 'FREQ': showMenu('FREQ'); openEntry('center'); return
      case 'SPAN': showMenu('SPAN'); openEntry(a.zeroSpan ? 'swt' : 'span'); return
      case 'AMPT': showMenu('AMPT'); openEntry('ref'); return
      case 'BW': showMenu('BW'); closeEntry(); return
      case 'SWEEP': showMenu('SWEEP'); closeEntry(); return
      case 'TRIG': showMenu('TRIG'); closeEntry(); return
      case 'TRACE': showMenu('TRACE'); closeEntry(); return
      case 'MKR':
        showMenu('MKR')
        if (!s().markers.some((m) => m.on)) { s().active = 0; a.markerPeak(0) }
        openEntry('marker'); return
      case 'MKRTO': showMenu('MKRTO'); if (!s().markers.some((m) => m.on)) a.markerPeak(0); closeEntry(); return
      case 'MEAS': showMenu('MEAS'); closeEntry(); return
      case 'SETUP': showMenu('SETUP'); closeEntry(); return
      case 'ESC': if (buf) { buf = ''; renderEntry() } else closeEntry(); return
      case 'BS': buf = buf.slice(0, -1); renderEntry(); return
      case 'ENTER': commit('ENTER'); return
      case 'HELP': toast('Подсказка: функциональная клавиша открывает меню справа, значение вводится цифрами и клавишей единиц'); return
      default: toast(`Клавиша ${k} в тренажёре не задействована`)
    }
  }

  // ---------- события ----------
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button')
    if (!b || !root.contains(b)) return
    if (b.dataset.k) hardKey(b.dataset.k)
    else if (b.dataset.d) {
      if (!entry) return toast('Нет активного поля ввода')
      const d = b.dataset.d
      if (d === '-') buf = buf.startsWith('-') ? buf.slice(1) : '-' + buf
      else if (d === '.' && buf.includes('.')) return
      else buf += d
      renderEntry()
    } else if (b.dataset.u) commit(b.dataset.u)
    else if (b.dataset.knob) { knob(+b.dataset.knob) }
    else if (b.dataset.arrow) turn(+b.dataset.arrow, false)
    else if (b.dataset.up) { if (stack.length) { menu = stack.pop(); renderSoft() } }
    else if (b.dataset.sk) {
      const m = M[menu]?.()
      const k = m?.keys[+b.dataset.sk]
      if (!k) return
      if (k.act) k.act()
      if (k.sub) showMenu(k.sub, true)
      renderSoft()
    }
    opts.onAction?.()
  })
  function knob(d) {
    knobAngle += d * 18
    knobEl.style.transform = `rotate(${knobAngle}deg)`
    turn(d, true)
    opts.onAction?.()
  }
  const knobWrap = root.querySelector('.knob')
  knobWrap.addEventListener('wheel', (ev) => { ev.preventDefault(); knob(ev.deltaY < 0 ? 1 : -1) }, { passive: false })
  cv.addEventListener('click', (ev) => {
    const r = cv.getBoundingClientRect()
    const x = (ev.clientX - r.left) / r.width * 640
    if (x < G.x0 || x > G.x1) return
    const i = Math.round((x - G.x0) / (G.x1 - G.x0) * (NPTS - 1))
    if (!s().markers[s().active].on) { s().markers[s().active].on = true }
    s().markers[s().active].x = a.indexToX(i)
    openEntry('marker')
    if (!menu) showMenu('MKR')
    a.emit('marker')
  })
  const offChange = a.on(() => { renderSoft(); if (entry) renderEntry() })

  // ---------- развертка ----------
  let sweepStart = 0, dur = 0.1, prev = null, prog = 1
  a.target = 1
  function startSweep(now) {
    const data = a.computeSweep()
    prev = { t: Float64Array.from(a.trace), m: Float64Array.from(a.traceMin) }
    a.merge(data)
    sweepStart = now
    dur = clamp(a.s.swt, 0.06, 2.5)
    prog = 0
  }
  function tick(now) {
    if (destroyed) return
    now /= 1000
    const st = a.s
    const active = st.traceMode !== 'view' && st.traceMode !== 'blank'
    if (prog >= 1 && active && a.running) {
      if (!st.cont && a.sweeps >= Math.max(1, a.target || 1)) { a.running = false; a.emit('single-done') }
      else startSweep(now)
    } else if (prog < 1) {
      prog = Math.min(1, (now - sweepStart) / dur)
      if (prog >= 1) { prev = null; a.emit('sweep') }
    }
    draw()
    raf = requestAnimationFrame(tick)
  }
  const offPreset = a.on((k) => { if (k === 'preset' || k === 'change') { prog = 1; prev = null; a.target = Math.max(1, a.s.sweepCount) } })

  // ---------- отрисовка экрана ----------
  const G = { x0: 46, x1: 626, y0: 58, y1: 438 }
  function draw() {
    const st = a.s
    const W = 640, H = 480
    ctx.fillStyle = '#05080f'
    ctx.fillRect(0, 0, W, H)
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'
    ctx.textBaseline = 'top'
    // заголовок
    const star = (manual) => (manual ? '*' : ' ')
    ctx.fillStyle = '#d6e2f0'
    ctx.fillText(`Ref ${st.ref.toFixed(1)} dBm${st.refOffset ? '  Offset ' + st.refOffset.toFixed(1) + ' dB' : ''}`, 8, 6)
    ctx.fillText(`Att ${st.att} dB${star(!st.attAuto)}${st.preamp ? '  PA' : ''}`, 8, 22)
    const rx = 250
    ctx.fillText(`RBW ${fmtFreq(st.rbw)}`, rx, 6); if (!st.rbwAuto) { ctx.fillStyle = '#3fdc6a'; ctx.fillText('*', rx - 8, 6); ctx.fillStyle = '#d6e2f0' }
    ctx.fillText(`VBW ${fmtFreq(st.vbw)}`, rx, 22); if (!st.vbwAuto) { ctx.fillStyle = '#3fdc6a'; ctx.fillText('*', rx - 8, 22); ctx.fillStyle = '#d6e2f0' }
    ctx.fillText(`SWT ${fmtTime(st.swt)}`, rx, 38)
    if (!st.swtAuto || a.uncal) { ctx.fillStyle = a.uncal ? '#ff5252' : '#3fdc6a'; ctx.fillText('*', rx - 8, 38) }
    ctx.fillStyle = '#9fb3c8'
    ctx.fillText(`1 ${DET_LABEL[st.detector]} ${MODE_LABEL[st.traceMode]}`, 8, 40)
    if (st.input === 'cal') { ctx.fillStyle = '#ffb74d'; ctx.fillText('CAL 65 MHz', 120, 40) }
    // статусы
    const labels = a.status()
    ctx.textAlign = 'right'
    labels.forEach((l, i) => { ctx.fillStyle = '#ff5252'; ctx.fillText(l, W - 8, 6 + i * 16) })
    if (st.trigger === 'video') { ctx.fillStyle = '#9fb3c8'; ctx.fillText('VID', W - 8, 6 + labels.length * 16) }
    ctx.textAlign = 'left'

    // сетка
    const { x0, x1, y0, y1 } = G
    ctx.strokeStyle = '#2b3a4f'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= 10; i++) {
      const x = x0 + (x1 - x0) * i / 10 + 0.5, y = y0 + (y1 - y0) * i / 10 + 0.5
      ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.moveTo(x0, y); ctx.lineTo(x1, y)
    }
    ctx.stroke()
    ctx.fillStyle = '#7f93aa'
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 10; i += 1) {
      const v = st.ref - st.range * i / 10
      ctx.fillText(Math.round(v * 10) / 10 + '', x0 - 4, y0 + (y1 - y0) * i / 10 - 5)
    }
    ctx.textAlign = 'left'
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'
    const yOf = (v) => y0 + (st.ref - v) / st.range * (y1 - y0)
    const xOf = (i) => x0 + (x1 - x0) * i / (NPTS - 1)

    // линии измерений (каналы)
    const m = st.meas ? a.measure() : null
    const fx = (f) => x0 + (f - a.start) / st.span * (x1 - x0)
    if (st.span > 0 && (st.meas === 'cp' || st.meas === 'acp')) {
      const chans = st.meas === 'acp' ? [-1, 0, 1] : [0]
      for (const c of chans) {
        const fc = st.center + c * st.chSpacing
        ctx.fillStyle = c === 0 ? 'rgba(79,140,255,.16)' : 'rgba(255,183,77,.12)'
        const xa = clamp(fx(fc - st.chBw / 2), x0, x1), xb = clamp(fx(fc + st.chBw / 2), x0, x1)
        ctx.fillRect(xa, y0, xb - xa, y1 - y0)
      }
    }
    if (m?.type === 'obw' && st.span > 0) {
      ctx.strokeStyle = '#4f8cff'; ctx.setLineDash([4, 3]); ctx.beginPath()
      for (const f of [m.l, m.r]) { const x = fx(f) + 0.5; ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
      ctx.stroke(); ctx.setLineDash([])
    }
    if (st.refFixed && st.span > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([2, 3]); ctx.beginPath()
      const y = yOf(st.refFixed.level - 0) + 0.5, x = fx(st.refFixed.x) + 0.5
      ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([])
    }
    if (st.trigger === 'video' && a.zeroSpan) {
      ctx.strokeStyle = '#8bc34a'; ctx.setLineDash([6, 4]); ctx.beginPath()
      const y = y0 + (1 - st.trigLevel / 100) * (y1 - y0) + 0.5
      ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([])
    }

    // линии LINES
    const hline = (v, color, dash, label) => {
      if (v == null || v > st.ref || v < st.ref - st.range) return
      const y = Math.round(yOf(v)) + 0.5
      ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = color; ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'right'; ctx.fillText(label, x1 - 4, y + 3); ctx.textAlign = 'left'; ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'
    }
    hline(st.dl1, '#b388ff', [6, 4], 'D1')
    hline(st.dl2, '#b388ff', [2, 3], 'D2')
    hline(st.limit, '#ff5252', [], 'LIMIT')

    // трасса
    if (st.traceMode !== 'blank') {
      ctx.save()
      ctx.beginPath(); ctx.rect(x0, y0 - 1, x1 - x0, y1 - y0 + 2); ctx.clip()
      const cut = prev ? Math.floor(prog * (NPTS - 1)) : NPTS - 1
      const val = (i) => (prev && i > cut ? prev.t[i] : a.trace[i])
      const vmin = (i) => (prev && i > cut ? prev.m[i] : a.traceMin[i])
      if (st.detector === 'apk' && st.traceMode === 'clrw') {
        ctx.strokeStyle = 'rgba(245,217,10,.45)'
        ctx.beginPath()
        for (let i = 0; i < NPTS; i++) {
          const v = val(i), w = vmin(i)
          if (isNaN(v) || isNaN(w)) continue
          const x = xOf(i)
          ctx.moveTo(x, yOf(v)); ctx.lineTo(x, yOf(w))
        }
        ctx.stroke()
      }
      ctx.strokeStyle = '#f5d90a'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < NPTS; i++) {
        const v = val(i)
        if (isNaN(v)) { pen = false; continue }
        const y = Math.min(yOf(Math.max(v, st.ref - st.range - 20)), y1 + 2)
        if (!pen) { ctx.moveTo(xOf(i), y); pen = true } else ctx.lineTo(xOf(i), y)
      }
      ctx.stroke()
      if (prev && prog < 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.25)'
        ctx.beginPath(); ctx.moveTo(xOf(cut) + 0.5, y0); ctx.lineTo(xOf(cut) + 0.5, y1); ctx.stroke()
      }
      // маркеры
      const nd = st.ndb ? a.ndbDown() : null
      if (nd) {
        for (const x of [nd.l, nd.r]) {
          const i = a.xToIndex(x)
          drawMarker(xOf(i), yOf(st.markers[0].on ? a.levelAt(st.markers[0].x) - st.ndbValue : 0), 'T', '#80deea')
        }
      }
      st.markers.forEach((mk, k) => {
        if (!mk.on) return
        const i = a.xToIndex(mk.x)
        drawMarker(xOf(i), yOf(a.trace[i]), String(k + 1), k === st.active ? '#ffffff' : '#80deea', mk.delta && k > 0)
      })
      ctx.restore()
    }

    // поле маркеров
    const lines = []
    st.markers.forEach((mk, k) => {
      const r = a.readout(k)
      if (!r) return
      if (r.delta) {
        if (r.phn != null) lines.push([`PHN${k + 1} [1]`, `${fmtDb(r.phn)} dBc/Hz`, a.zeroSpan ? fmtTime(r.dx) : fmtMarkerFreq(r.dx)])
        else lines.push([`D${k + 1} [1]`, `${fmtDb(r.dl)} dB`, a.zeroSpan ? fmtTime(r.dx) : fmtMarkerFreq(r.dx)])
      } else if (r.noise != null) lines.push([`NOI${k + 1} [1]`, `${fmtDb(r.noise)} dBm/Hz`, a.zeroSpan ? fmtTime(r.x) : fmtMarkerFreq(r.x)])
      else if (st.sigCount && k === 0) lines.push([`CNT1 [1]`, `${fmtDb(r.level)} dBm`, r.count != null ? fmtMarkerFreq(r.count) : 'S/N < 25 dB'])
      else lines.push([`M${k + 1} [1]`, `${fmtDb(r.level)} dBm`, a.zeroSpan ? fmtTime(r.x) : fmtMarkerFreq(r.x)])
    })
    if (st.ndb) { const nd = a.ndbDown(); lines.push([`${st.ndbValue} dB down`, nd ? (a.zeroSpan ? fmtTime(nd.bw) : fmtFreq(nd.bw)) : '---', '']) }
    if (lines.length) {
      const bx = 380, by = y0 + 4, bh = lines.length * 30 + 4
      ctx.fillStyle = 'rgba(5,8,15,.82)'
      ctx.fillRect(bx - 6, by - 2, x1 - bx + 4, bh)
      lines.forEach((l, i) => {
        ctx.fillStyle = i === st.active ? '#ffffff' : '#bfe9f0'
        ctx.fillText(l[0], bx, by + i * 30)
        ctx.textAlign = 'right'
        ctx.fillText(l[1], x1 - 6, by + i * 30)
        ctx.fillText(l[2], x1 - 6, by + i * 30 + 14)
        ctx.textAlign = 'left'
      })
    }

    // результаты MEAS
    if (m) {
      const rows = []
      if (m.type === 'cp') rows.push(['Channel Power', `${fmtDb(m.power)} dBm`], ['Channel BW', fmtFreq(st.chBw)])
      if (m.type === 'acp') rows.push(['Tx Channel', `${fmtDb(m.power)} dBm`], ['Lower Adj', `${fmtDb(m.lower)} dBc`], ['Upper Adj', `${fmtDb(m.upper)} dBc`])
      if (m.type === 'obw') rows.push(['Occ BW ' + st.obwPct + '%', fmtFreq(m.bw)], ['Power', `${fmtDb(m.power)} dBm`])
      if (m.type === 'toi') rows.push(['TOI', m.toi != null ? `${fmtDb(m.toi)} dBm` : 'нужны два сигнала'])
      if (m.type === 'am') rows.push(['MDepth', m.depth != null ? m.depth.toFixed(1) + ' %' : 'нет боковых'])
      const bh = rows.length * 16 + 8
      ctx.fillStyle = 'rgba(14,24,42,.92)'
      ctx.fillRect(x0 + 4, y1 - bh - 4, 230, bh)
      rows.forEach((r, i) => {
        ctx.fillStyle = '#9fd0ff'; ctx.fillText(r[0], x0 + 10, y1 - bh + i * 16)
        ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; ctx.fillText(r[1], x0 + 228, y1 - bh + i * 16); ctx.textAlign = 'left'
      })
    }

    // проверка допуска
    if (st.limit != null && st.traceMode !== 'blank') {
      let fail = false
      for (const v of a.trace) if (!isNaN(v) && v > st.limit) { fail = true; break }
      ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace'
      ctx.fillStyle = fail ? '#ff5252' : '#3fdc6a'
      ctx.textAlign = 'right'; ctx.fillText(fail ? 'LIMIT CHECK: FAIL' : 'LIMIT CHECK: PASS', x1 - 6, y1 - 22); ctx.textAlign = 'left'
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'
    }

    // подпись снизу
    ctx.fillStyle = '#d6e2f0'
    const fy = 452
    if (st.span > 0) {
      ctx.fillText(`Center ${fmtFreq(st.center)}`, x0, fy)
      ctx.textAlign = 'center'; ctx.fillText(`${fmtFreq(st.span / 10)}/`, (x0 + x1) / 2, fy)
      ctx.textAlign = 'right'; ctx.fillText(`Span ${fmtFreq(st.span)}`, x1, fy)
    } else {
      ctx.fillText(`Center ${fmtFreq(st.center)}`, x0, fy)
      ctx.textAlign = 'center'; ctx.fillText(`${fmtTime(st.swt / 10)}/`, (x0 + x1) / 2, fy)
      ctx.textAlign = 'right'; ctx.fillText('Zero Span', x1, fy)
    }
    ctx.textAlign = 'left'
    if (!st.cont) { ctx.fillStyle = a.running ? '#9fb3c8' : '#ffb74d'; ctx.fillText(a.running ? `SGL ${a.sweeps}/${Math.max(1, a.target)}` : 'SGL', x0, 466) }
  }
  function drawMarker(x, y, label, color, delta) {
    y = clamp(y, G.y0 + 2, G.y1 - 2)
    ctx.fillStyle = color
    ctx.beginPath()
    if (delta) { ctx.moveTo(x, y - 2); ctx.lineTo(x - 5, y - 11); ctx.lineTo(x + 5, y - 11) }
    else { ctx.moveTo(x, y - 2); ctx.lineTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10) }
    ctx.closePath()
    if (delta) { ctx.strokeStyle = color; ctx.stroke() } else ctx.fill()
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(label, x, y - 24)
    ctx.textAlign = 'left'
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'
  }

  renderSoft()
  raf = requestAnimationFrame(tick)

  return {
    analyzer: a,
    destroy() { destroyed = true; cancelAnimationFrame(raf); offChange(); offPreset(); clearTimeout(toastTimer) },
    toast,
  }
}
