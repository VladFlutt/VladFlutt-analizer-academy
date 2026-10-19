// Модель анализатора спектра R&S FSL18: настройки, расчёт трассы, маркеры и измерения.
// Модель упрощённая, но поведение основных параметров соответствует руководству:
// шум ~ RBW и ослаблению, время развертки ~ span/RBW², детекторы, OVLD/IFOVL/UNCAL,
// собственные гармоники (SHI +40 дБм) и интермодуляция (TOI +13 дБм) смесителя.

export const FMIN = 9e3
export const FMAX = 18e9
export const FMAX_ENTRY = 20e9
export const NPTS = 501
export const RBWS = [10, 30, 100, 300, 1e3, 3e3, 10e3, 30e3, 100e3, 300e3, 1e6, 3e6, 10e6]
export const VBWS = [1, 3, 10, 30, 100, 300, 1e3, 3e3, 10e3, 30e3, 100e3, 300e3, 1e6, 3e6, 10e6]
export const SHI = 40
export const TOI_MIX = 13
export const CAL_LEVEL = -30
export const CAL_FREQ = 65e6

const LN10 = Math.log(10)
const lin = (db) => Math.exp(db * LN10 / 10)
const db = (p) => (p > 0 ? 10 * Math.log10(p) : -300)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function nearestLog(list, v) {
  let best = list[0]
  for (const x of list) if (Math.abs(Math.log(x / v)) < Math.abs(Math.log(best / v))) best = x
  return best
}

function gauss(rnd) {
  const u = Math.max(1e-12, rnd()), v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Собственный шум (DANL) R&S FSL18 при 0 дБ ослабления, дБм/Гц (по спецификации с небольшим запасом).
export function danl(f) {
  if (f < 1e6) return -112
  if (f < 10e6) return -125
  if (f < 50e6) return -135
  if (f < 3e9) return -143
  if (f < 12e9) return -139
  if (f < 18e9) return -133
  return -126
}

// Собственный фазовый шум гетеродина, дБн/Гц на отстройке dx.
function phaseNoise(dx) {
  if (dx < 100) return -70
  return Math.max(-63 - 10 * Math.log10(dx), dx > 1e6 ? -135 : -125)
}

export function defaultState() {
  return {
    center: FMAX / 2, span: FMAX, lastSpan: FMAX,
    ref: -10, range: 100, refOffset: 0,
    att: 10, attAuto: true, preamp: false,
    rbw: 3e6, rbwAuto: true, vbw: 10e6, vbwAuto: true, swt: 0.0025, swtAuto: true,
    cfStepMode: 'span', cfStepFactor: 0.1, cfStep: 0.1 * (FMAX / 2),
    cont: true, sweepCount: 0, trigger: 'free', trigLevel: 50,
    traceMode: 'clrw', detAuto: true, detector: 'apk',
    markers: [0, 1, 2, 3].map((i) => ({ on: false, x: 0, delta: i > 0 })),
    active: 0,
    sigCount: false, noiseMeas: false, ndb: false, ndbValue: 3,
    refFixed: null, phaseNoise: false,
    meas: null, chBw: 1.23e6, chSpacing: 1.25e6, obwPct: 99,
    input: 'rf',
  }
}

export class Analyzer {
  constructor(seed = Date.now()) {
    this.s = defaultState()
    this.signals = []
    this.trace = new Float64Array(NPTS).fill(-200)
    this.traceMin = new Float64Array(NPTS).fill(-200)
    this.sweeps = 0
    this.running = true
    this.listeners = new Set()
    let x = seed >>> 0 || 1
    this.rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
    this.hopIndex = 0
    this.couple()
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(kind) { for (const fn of this.listeners) fn(kind) }

  setSignals(list) { this.signals = list || []; this.resetTrace() }

  preset() {
    this.s = defaultState()
    this.couple()
    this.resetTrace()
    this.running = true
    this.emit('preset')
  }

  // ---------- связи параметров ----------
  get start() { return this.s.span > 0 ? this.s.center - this.s.span / 2 : this.s.center }
  get stop() { return this.s.span > 0 ? this.s.center + this.s.span / 2 : this.s.center }
  get zeroSpan() { return this.s.span === 0 }

  swtNeeded() {
    const s = this.s
    if (s.span === 0) return 1e-6
    return Math.max(0.0025, 2.5 * s.span / (s.rbw * Math.min(s.rbw, s.vbw)))
  }

  couple() {
    const s = this.s
    if (s.span > 0 && s.rbwAuto) s.rbw = Math.min(3e6, nearestLog(RBWS, s.span / 50))
    if (s.vbwAuto) s.vbw = Math.min(10e6, nearestLog(VBWS, s.rbw * 3))
    if (s.attAuto) s.att = clamp(Math.ceil((s.ref - s.refOffset + 20) / 5) * 5, 0, 40)
    if (s.swtAuto) s.swt = s.span > 0 ? this.swtNeeded() : (s.swt || 0.001)
    if (s.cfStepMode === 'span') s.cfStep = s.span > 0 ? s.cfStepFactor * s.span : s.cfStepFactor * s.rbw
    if (s.detAuto) s.detector = { clrw: 'apk', max: 'pk', min: 'mi', avg: 'sa', view: s.detector, blank: s.detector }[s.traceMode]
  }

  change(fn, keepTrace = false) {
    const before = { center: this.s.center, span: this.s.span }
    fn(this.s)
    const s = this.s
    s.center = clamp(s.center, 0, FMAX_ENTRY)
    if (s.span > 0) {
      s.span = Math.min(s.span, FMAX_ENTRY)
      const fits = () => s.center - s.span / 2 >= 0 && s.center + s.span / 2 <= FMAX_ENTRY
      if (!fits()) {
        // как в приборе: при смене центра сужается span, при смене span сдвигается центр
        if (s.center !== before.center && s.span === before.span) s.span = Math.max(10, 2 * Math.min(s.center, FMAX_ENTRY - s.center))
        else s.center = clamp(s.center, s.span / 2, FMAX_ENTRY - s.span / 2)
      }
    }
    this.couple()
    if (!keepTrace) this.resetTrace()
    this.emit('change')
  }

  resetTrace() {
    this.trace.fill(NaN)
    this.traceMin.fill(NaN)
    this.sweeps = 0
    this.avgN = 0
    this.progress = 0
    this.pending = null
    if (!this.s.cont) this.running = true
  }

  get uncal() { const s = this.s; return s.span > 0 && !s.swtAuto && s.swt < this.swtNeeded() * 0.98 }

  // ---------- состав сигнала на входе ----------
  components() {
    const s = this.s
    const cw = [], band = []
    const src = s.input === 'cal' ? [{ kind: 'cw', f: CAL_FREQ, p: CAL_LEVEL }] : this.signals
    for (const g of src) {
      if (g.kind === 'cw') cw.push({ f: g.f, p: g.p, input: true })
      else if (g.kind === 'am') {
        cw.push({ f: g.f, p: g.p, input: true, am: g })
        const sb = g.p + 20 * Math.log10(g.m / 2)
        cw.push({ f: g.f - g.fm, p: sb, input: true, side: true }, { f: g.f + g.fm, p: sb, input: true, side: true })
      } else if (g.kind === 'hop') {
        cw.push({ f: g.freqs[this.hopIndex % g.freqs.length], p: g.p, input: true })
      } else if (g.kind === 'band') band.push(g)
    }
    // уровни на смесителе и собственные искажения анализатора
    const products = []
    const gain = (f) => (s.preamp && f < 6e9 ? 20 : 0)
    const pm = (c) => c.p - s.att + gain(c.f)
    let mixerTotal = 0
    for (const c of cw) mixerTotal += lin(pm(c))
    for (const b of band) mixerTotal += lin(b.p - s.att + gain(b.f))
    const mains = cw.filter((c) => !c.side)
    for (const c of mains) {
      const m = pm(c)
      products.push({ f: 2 * c.f, p: 2 * m - SHI + s.att - gain(2 * c.f), internal: 'h2' })
      products.push({ f: 3 * c.f, p: 3 * m - 60 + s.att - gain(3 * c.f), internal: 'h3' })
    }
    for (let i = 0; i < mains.length; i++) for (let j = 0; j < mains.length; j++) {
      if (i === j) continue
      const a = mains[i], b = mains[j]
      if (Math.abs(a.f - b.f) > 200e6) continue
      const f = 2 * a.f - b.f
      if (f <= 0) continue
      products.push({ f, p: 2 * pm(a) + pm(b) - 2 * TOI_MIX + s.att - gain(f), internal: 'im3' })
    }
    // компрессия смесителя выше –5 дБм
    const total = db(mixerTotal)
    const comp = total > -5 ? 0.25 * (total + 5) : 0
    const all = cw.concat(products.filter((p) => p.p > -220)).map((c) => ({ ...c, p: c.p - (c.internal ? 0 : comp) }))
    return { cw: all, band, mixer: total, comp }
  }

  // ---------- расчёт одной развертки ----------
  computeSweep() {
    const s = this.s
    const rnd = this.rnd
    const { cw, band, mixer } = this.components()
    const out = new Float64Array(NPTS), outMin = new Float64Array(NPTS)
    const rbwN = 1.065 * s.rbw
    const rbwDb = db(rbwN)
    const det = s.detector
    const K = Math.max(1, s.rbw / s.vbw)
    const M = clamp(s.swt * s.rbw / NPTS, 1, 1e5)
    const uncalLoss = this.uncal ? Math.min(25, 10 * Math.log10(1 + 2 * (this.swtNeeded() / s.swt - 1))) : 0
    const df = s.span / (NPTS - 1)
    const pre = (f) => (s.preamp && f < 6e9 ? -12 : 0)
    const floor = (f) => lin(danl(f) + s.att + pre(f) + rbwDb)
    const phase = rnd() * 2 * Math.PI

    // среднее M экспоненциально распределённых выборок мощности (среднее = 1)
    const powerAvg = () => {
      if (M < 8) { let acc = 0; const n = Math.max(1, Math.round(M)); for (let k = 0; k < n; k++) acc += -Math.log(Math.max(1e-12, rnd())); return acc / n }
      return Math.max(0.05, 1 + gauss(rnd) / Math.sqrt(M))
    }
    const noiseFactor = () => {
      const g = gauss(rnd)
      switch (det) {
        case 'sa': return -2.51 + g * 5.57 / Math.sqrt(K)
        case 'rms': return db(powerAvg())
        case 'av': return -1.05 + db(powerAvg())
        case 'mi': {
          const n = Math.max(M / K, 1)
          return K > 1 ? -2.51 - 5.57 / Math.sqrt(K) * Math.sqrt(2 * Math.log(n) + 0.1) + g * 0.8 : Math.max(-30, -10 * Math.log10(n) - 2.51 + g * 1.5)
        }
        default: {
          const n = Math.max(M / K, 8)
          return K > 1 ? -2.51 + 5.57 / Math.sqrt(K) * Math.sqrt(2 * Math.log(n) + 0.1) + g * 0.6 : db(Math.log(n) + 0.577) + g * 1.0
        }
      }
    }
    const minFactor = () => {
      const n = Math.max(M / K, 8)
      return K > 1 ? -2.51 - 5.57 / Math.sqrt(K) * Math.sqrt(2 * Math.log(n) + 0.1) : Math.max(-30, -10 * Math.log10(n) - 2.51 + gauss(rnd))
    }
    const resp = (dx) => -3 * (dx / (s.rbw / 2)) ** 2

    const bandPsd = (f) => {
      let p = 0
      for (const b of band) {
        const d = Math.abs(f - b.f)
        const psd = b.p - db(b.bw)
        if (d <= b.bw / 2) p += lin(psd)
        else if (b.aclr && d <= b.bw / 2 + 2.2 * (b.spacing || b.bw)) p += lin(psd - b.aclr - 3 * (d - b.bw / 2) / (b.spacing || b.bw))
        else if (b.aclr) p += lin(psd - b.aclr - 30)
        else p += lin(psd - 60)
      }
      return p
    }
    const bandAt = (f) => {
      if (!band.length) return 0
      let acc = 0
      const taps = [-1.2, -0.6, 0, 0.6, 1.2]
      const w = [0.07, 0.24, 0.38, 0.24, 0.07]
      for (let k = 0; k < 5; k++) acc += w[k] * bandPsd(f + taps[k] * s.rbw / 2)
      return acc * rbwN
    }

    for (let i = 0; i < NPTS; i++) {
      let cwp = 0, nz = 0
      if (s.span > 0) {
        const fc = this.start + i * df
        const lo = fc - df / 2, hi = fc + df / 2
        for (const c of cw) {
          const dd = Math.abs(c.f - fc)
          if (dd > 50 * s.rbw && dd > 2 * df) {
            if (c.p > -120) nz += lin(c.p + phaseNoise(dd) + rbwDb)
            continue
          }
          let dx
          if (det === 'sa') dx = Math.abs(c.f - (lo + rnd() * df))
          else if (det === 'rms' || det === 'av') dx = Math.abs(c.f - fc)
          else dx = c.f < lo ? lo - c.f : c.f > hi ? c.f - hi : 0
          let p = c.p - uncalLoss + resp(dx)
          if ((det === 'rms' || det === 'av') && df > s.rbw) {
            const inBin = Math.abs(c.f - fc) <= df / 2
            p = inBin ? c.p - uncalLoss + db(1.066 * s.rbw / df) : p
          }
          if (p > -250) cwp += lin(p)
          if (dd > s.rbw && c.p > -120) nz += lin(c.p + phaseNoise(dd) + rbwDb)
        }
        nz += floor(fc) + bandAt(fc)
      } else {
        const t = i / (NPTS - 1) * s.swt
        for (const c of cw) {
          const dx = Math.abs(c.f - s.center)
          let p = c.p + resp(dx)
          if (p < -250) continue
          let pl = lin(p)
          if (c.am) pl *= (1 + c.am.m * Math.cos(2 * Math.PI * c.am.fm * t + phase)) ** 2
          if (c.side) continue
          cwp += pl
        }
        for (const g of this.signals) {
          if (g.kind !== 'burst' || s.input === 'cal') continue
          const dx = Math.abs(g.f - s.center)
          const p = g.p + resp(dx)
          const ph = s.trigger === 'video' ? 0.15 : phase / (2 * Math.PI)
          const on = ((t / g.period + 1 - ph) % 1) < g.duty
          if (on && p > -250) cwp += lin(p)
        }
        nz += floor(s.center) + bandAt(s.center)
      }
      out[i] = db(cwp + nz * lin(noiseFactor())) + s.refOffset
      outMin[i] = db(cwp * 0.999 + nz * lin(minFactor())) + s.refOffset
    }
    this.lastMixer = mixer
    this.hopIndex++
    return { y: out, ymin: outMin }
  }

  // объединение развертки с памятью трассы по режиму
  merge({ y, ymin }) {
    const s = this.s
    const t = this.trace, tm = this.traceMin
    const n = ++this.sweeps
    const c = s.sweepCount || 10
    for (let i = 0; i < NPTS; i++) {
      if (s.traceMode === 'clrw' || isNaN(t[i])) { t[i] = y[i]; tm[i] = ymin[i]; continue }
      if (s.traceMode === 'max') { t[i] = Math.max(t[i], y[i]); tm[i] = Math.max(tm[i], ymin[i]) }
      else if (s.traceMode === 'min') { t[i] = Math.min(t[i], y[i]); tm[i] = Math.min(tm[i], ymin[i]) }
      else if (s.traceMode === 'avg') {
        const k = Math.min(n, c)
        t[i] = t[i] + (y[i] - t[i]) / k
        tm[i] = t[i]
      }
    }
  }

  // готовы ли данные развертки (single sweep завершён)
  get done() { return !this.s.cont && !this.running }

  // ---------- статусы ----------
  status() {
    const s = this.s
    const labels = []
    const mixer = this.components().mixer
    if (mixer > -10 + 0.3) labels.push('OVLD')
    let mx = -300
    for (let i = 0; i < NPTS; i++) if (!isNaN(this.trace[i])) mx = Math.max(mx, this.trace[i])
    if (mx > s.ref + 0.5) labels.push('IFOVL')
    if (this.uncal) labels.push('UNCAL')
    return labels
  }

  // ---------- маркеры ----------
  xToIndex(x) {
    if (this.s.span > 0) return clamp(Math.round((x - this.start) / (this.s.span / (NPTS - 1))), 0, NPTS - 1)
    return clamp(Math.round(x / this.s.swt * (NPTS - 1)), 0, NPTS - 1)
  }
  indexToX(i) { return this.s.span > 0 ? this.start + i * this.s.span / (NPTS - 1) : i / (NPTS - 1) * this.s.swt }
  levelAt(x) { const v = this.trace[this.xToIndex(x)]; return isNaN(v) ? -200 : v }

  peaks(excursion = 6) {
    const t = this.trace
    const res = []
    for (let i = 1; i < NPTS - 1; i++) {
      if (isNaN(t[i])) continue
      if (t[i] >= t[i - 1] && t[i] > t[i + 1]) {
        let l = i, lmin = t[i]
        while (l > 0 && t[l - 1] <= t[i]) { l--; lmin = Math.min(lmin, t[l]) }
        let r = i, rmin = t[i]
        while (r < NPTS - 1 && t[r + 1] <= t[i]) { r++; rmin = Math.min(rmin, t[r]) }
        const prom = t[i] - Math.max(l === 0 ? lmin : lmin, r === NPTS - 1 ? rmin : rmin)
        if (prom >= excursion || l === 0 || r === NPTS - 1) res.push({ i, v: t[i] })
      }
    }
    if (!res.length) {
      let bi = 0
      for (let i = 0; i < NPTS; i++) if (!isNaN(t[i]) && (isNaN(t[bi]) || t[i] > t[bi])) bi = i
      res.push({ i: bi, v: t[bi] })
    }
    return res.sort((a, b) => b.v - a.v)
  }

  markerPeak(m = this.s.active) {
    const p = this.peaks()[0]
    this.s.markers[m].on = true
    this.s.markers[m].x = this.indexToX(p.i)
    this.emit('marker')
  }

  markerNextPeak(m = this.s.active) {
    const cur = this.s.markers[m]
    const lvl = this.levelAt(cur.x)
    const ci = this.xToIndex(cur.x)
    const list = this.peaks().filter((p) => p.v < lvl - 0.01 || (p.v <= lvl && p.i !== ci))
    const next = list.find((p) => p.i !== ci && p.v <= lvl)
    if (next) { cur.x = this.indexToX(next.i); this.emit('marker') }
  }

  markerMin(m = this.s.active) {
    let bi = 0
    for (let i = 0; i < NPTS; i++) if (this.trace[i] < this.trace[bi]) bi = i
    this.s.markers[m].on = true
    this.s.markers[m].x = this.indexToX(bi)
    this.emit('marker')
  }

  // показания маркеров
  readout(m) {
    const s = this.s
    const mk = s.markers[m]
    if (!mk.on) return null
    const lvl = this.levelAt(mk.x)
    const res = { m, x: mk.x, level: lvl, delta: mk.delta && m > 0 }
    if (res.delta) {
      const ref = s.refFixed || (s.markers[0].on ? { x: s.markers[0].x, level: this.levelAt(s.markers[0].x) } : null)
      if (ref) {
        res.dx = mk.x - ref.x
        res.dl = lvl - ref.level
        if (s.refFixed && s.phaseNoise) res.phn = res.dl - db(1.065 * s.rbw) + (s.detector === 'sa' || s.traceMode === 'avg' ? 2.51 : 0)
      } else res.delta = false
    }
    if (m === 0 && s.noiseMeas) res.noise = this.noiseDensity(mk.x)
    if (m === 0 && s.sigCount) res.count = this.counter(mk.x)
    return res
  }

  noiseDensity(x) {
    const s = this.s
    const c = this.xToIndex(x)
    let acc = 0, n = 0
    for (let i = c - 8; i <= c + 8; i++) {
      if (i < 0 || i >= NPTS || isNaN(this.trace[i])) continue
      acc += this.trace[i]; n++
    }
    const avg = n ? acc / n : -200
    const corr = { sa: 2.51, apk: 2.51, pk: 2.51, mi: 2.51, av: 1.05, rms: 0 }[s.detector] ?? 0
    return avg + corr - db(1.065 * s.rbw)
  }

  counter(x) {
    const s = this.s
    const { cw } = this.components()
    const lvl = this.levelAt(x)
    const floorDisp = danl(x) + s.att + db(1.065 * s.rbw) + s.refOffset
    if (lvl - floorDisp < 25) return null
    let best = null
    const win = Math.max(s.rbw, s.span / (NPTS - 1)) * 1.5
    for (const c of cw) {
      const d = Math.abs(c.f - (s.span > 0 ? x : s.center))
      if (d <= win && (!best || c.p > best.p)) best = c
    }
    return best ? Math.round(best.f) : null
  }

  ndbDown() {
    const s = this.s
    if (!s.markers[0].on) return null
    const c = this.xToIndex(s.markers[0].x)
    const target = this.trace[c] - s.ndbValue
    let l = c, r = c
    while (l > 0 && this.trace[l] > target) l--
    while (r < NPTS - 1 && this.trace[r] > target) r++
    if (l === 0 || r === NPTS - 1) return null
    const interp = (a, b) => a + (target - this.trace[a]) / (this.trace[b] - this.trace[a]) * (b - a)
    const li = interp(l, l + 1), ri = interp(r - 1, r)
    const step = s.span > 0 ? s.span / (NPTS - 1) : s.swt / (NPTS - 1)
    return { bw: (ri - li) * step, l: this.indexToX(0) + li * step, r: this.indexToX(0) + ri * step }
  }

  // ---------- измерения MEAS ----------
  measure() {
    const s = this.s
    if (!s.meas || s.span === 0 && s.meas !== 'tdp') return null
    const t = this.trace
    if (isNaN(t[0])) return null
    const step = s.span / (NPTS - 1)
    const chanPower = (fc, bw) => {
      let acc = 0, n = 0
      for (let i = 0; i < NPTS; i++) {
        const f = this.start + i * step
        if (Math.abs(f - fc) <= bw / 2) { acc += lin(t[i]); n++ }
      }
      return n ? db(acc / n * bw / (1.065 * s.rbw)) : null
    }
    if (s.meas === 'cp') return { type: 'cp', power: chanPower(s.center, s.chBw) }
    if (s.meas === 'acp') {
      const tx = chanPower(s.center, s.chBw)
      const lo = chanPower(s.center - s.chSpacing, s.chBw)
      const hi = chanPower(s.center + s.chSpacing, s.chBw)
      return { type: 'acp', power: tx, lower: lo != null ? lo - tx : null, upper: hi != null ? hi - tx : null }
    }
    if (s.meas === 'obw') {
      const p = Array.from(t, lin)
      const total = p.reduce((a, b) => a + b, 0)
      const lim = total * (1 - s.obwPct / 100) / 2
      let acc = 0, l = 0
      while (l < NPTS - 1 && acc + p[l] < lim) acc += p[l++]
      acc = 0
      let r = NPTS - 1
      while (r > 0 && acc + p[r] < lim) acc += p[r--]
      return { type: 'obw', bw: (r - l) * step, l: this.start + l * step, r: this.start + r * step, power: chanPower(s.center, s.span) }
    }
    if (s.meas === 'toi') {
      const pk = this.peaks(6).slice(0, 2).sort((a, b) => a.i - b.i)
      if (pk.length < 2) return { type: 'toi', toi: null }
      const [a, b] = pk
      const fa = this.indexToX(a.i), fb = this.indexToX(b.i)
      const imL = this.levelAt(2 * fa - fb), imH = this.levelAt(2 * fb - fa)
      const pu = (a.v + b.v) / 2
      const ad3 = pu - Math.max(imL, imH)
      return { type: 'toi', toi: pu + ad3 / 2, f1: fa, f2: fb, imL: 2 * fa - fb, imH: 2 * fb - fa }
    }
    if (s.meas === 'am') {
      const pk = this.peaks(6)
      const c = pk[0]
      const fc = this.indexToX(c.i)
      const side = pk.slice(1).find((p) => {
        const f = this.indexToX(p.i)
        const mirror = this.levelAt(2 * fc - f)
        return Math.abs(mirror - p.v) < 6
      })
      if (!side) return { type: 'am', depth: null }
      const fs = this.indexToX(side.i)
      const sb = (side.v + this.levelAt(2 * fc - fs)) / 2
      return { type: 'am', depth: 200 * Math.pow(10, (sb - c.v) / 20), fm: Math.abs(fs - fc) }
    }
    return null
  }

  // Adjust Settings для CP/ACP/OBW
  adjustSettings() {
    this.change((s) => {
      if (s.meas === 'acp') s.span = 2 * (s.chSpacing + s.chBw) * 1.1
      else if (s.meas === 'obw') s.span = 3 * s.chBw
      else s.span = 2 * s.chBw * 1.1
      s.rbwAuto = false
      s.rbw = RBWS.filter((r) => r <= s.chBw / 40).pop() || RBWS[0]
      s.vbwAuto = false
      s.vbw = VBWS.find((v) => v >= 3 * s.rbw) || 10e6
      s.detAuto = false
      s.detector = 'rms'
      s.swtAuto = true
    })
  }

  // ожидаемый уровень шума на экране (без флуктуаций), для заданий
  displayedNoise(f) {
    const s = this.s
    const pre = s.preamp && f < 6e9 ? -12 : 0
    return danl(f) + s.att + pre + db(1.065 * s.rbw) + s.refOffset
  }
}

// ---------- форматирование ----------
export function fmtFreq(hz, digits) {
  const a = Math.abs(hz)
  const trim = (v, d) => (digits === undefined ? String(+v.toFixed(d)) : v.toFixed(digits))
  if (a >= 1e9) return trim(hz / 1e9, 9) + ' GHz'
  if (a >= 1e6) return trim(hz / 1e6, 6) + ' MHz'
  if (a >= 1e3) return trim(hz / 1e3, 3) + ' kHz'
  return trim(hz, 1) + ' Hz'
}

export function fmtMarkerFreq(hz) {
  const a = Math.abs(hz)
  if (a >= 1e9) return (hz / 1e9).toFixed(9) + ' GHz'
  if (a >= 1e6) return (hz / 1e6).toFixed(6) + ' MHz'
  if (a >= 1e3) return (hz / 1e3).toFixed(3) + ' kHz'
  return hz.toFixed(0) + ' Hz'
}

export function fmtTime(s) {
  const a = Math.abs(s)
  if (a >= 1) return +s.toFixed(3) + ' s'
  if (a >= 1e-3) return +(s * 1e3).toFixed(3) + ' ms'
  if (a >= 1e-6) return +(s * 1e6).toFixed(3) + ' µs'
  return +(s * 1e9).toFixed(1) + ' ns'
}

export const DET_LABEL = { apk: 'AP', pk: 'PK', mi: 'MI', sa: 'SA', rms: 'RM', av: 'AV' }
export const DET_NAME = { apk: 'Auto Peak', pk: 'Positive Peak', mi: 'Negative Peak', sa: 'Sample', rms: 'RMS', av: 'Average' }
export const MODE_LABEL = { clrw: 'CLRW', max: 'MAXH', min: 'MINH', avg: 'AVG', view: 'VIEW', blank: 'BLANK' }
