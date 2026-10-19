// Практические задания на тренажёре. У каждого задания своя «установка» (сигналы на входе),
// поля ответа и проверка: и настроек прибора, и введённых значений.

import { danl, fmtFreq } from './analyzer.js'

const r = (rnd, a, b) => a + (b - a) * rnd()
const ri = (rnd, a, b) => Math.round(r(rnd, a, b))
const near = (v, t, tol) => isFinite(v) && Math.abs(v - t) <= tol
const anyMarkerNear = (a, f, tol) => a.s.markers.some((m) => m.on && Math.abs(m.x - f) <= tol)
const item = (ok, text) => ({ ok: !!ok, text })

export const TASKS = [
  {
    id: 'find', title: 'Найти сигнал и измерить его частоту и уровень', module: 'freq',
    setup(rnd) {
      const f = Math.round(r(rnd, 500, 5000) * 10) / 10 * 1e6
      const p = ri(rnd, -40, -20)
      return { signals: [{ kind: 'cw', f, p }], f, p, text: 'На вход подан синусоидальный сигнал неизвестной частоты в диапазоне 500 МГц – 5 ГГц.' }
    },
    goal: 'Найдите сигнал, сузьте полосу обзора до 10 МГц или меньше и измерьте его частоту и уровень маркером.',
    hints: ['PRESET, затем MKR: маркер встанет на пик.', 'MKR→ → Center =Mkr Freq, затем SPAN → 100 MHz. На полном span одна точка трассы шириной 36 МГц, поэтому приближайтесь в несколько шагов.', 'MKR→ → Peak, Center =Mkr Freq, SPAN → 10 MHz, снова Peak. Прочитайте показания в поле маркера.'],
    fields: [{ key: 'f', label: 'Частота, МГц' }, { key: 'p', label: 'Уровень, дБм' }],
    check(a, ans, x) {
      return [
        item(a.s.span > 0 && a.s.span <= 10e6, 'Span не больше 10 МГц'),
        item(anyMarkerNear(a, x.f, 100e3), 'Маркер стоит на сигнале'),
        item(near(ans.f * 1e6, x.f, 50e3), 'Частота верна (±50 кГц)'),
        item(near(ans.p, x.p, 1.5), 'Уровень верен (±1,5 дБ)'),
      ]
    },
  },
  {
    id: 'cal', title: 'Внутренний калибровочный сигнал 65 МГц', module: 'panel',
    setup() { return { signals: [], text: 'К ВЧ-входу ничего не подключено. Используйте внутренний опорный генератор прибора.' } },
    goal: 'Включите внутренний сигнал 65 МГц, установите Center 65 МГц и Span 1 МГц и измерьте его уровень маркером.',
    hints: ['SETUP → Service → Input RF/Cal.', 'FREQ → 65 MHz, SPAN → 1 MHz.', 'MKR: маркер на пике.'],
    fields: [{ key: 'p', label: 'Уровень, дБм' }],
    check(a, ans) {
      return [
        item(a.s.input === 'cal', 'Включён вход Cal'),
        item(near(a.s.center, 65e6, 1e6) && a.s.span > 0 && a.s.span <= 1e6, 'Center 65 МГц, span ≤ 1 МГц'),
        item(anyMarkerNear(a, 65e6, 20e3), 'Маркер на сигнале'),
        item(near(ans.p, -30, 1.5), 'Уровень верен (±1,5 дБ)'),
      ]
    },
  },
  {
    id: 'counter', title: 'Точное измерение частоты частотомером', module: 'markers',
    setup(rnd) {
      const f = 1e9 + ri(rnd, 2000, 90000)
      return { signals: [{ kind: 'cw', f: Math.round(f), p: -25 }], f: Math.round(f), text: 'Генератор настроен примерно на 1 ГГц, но его частота немного отличается от номинала.' }
    },
    goal: 'Измерьте частоту сигнала с точностью до 1 Гц.',
    hints: ['FREQ → 1 GHz, SPAN → 1 MHz.', 'MKR → маркер на пике.', 'MKR → Sig Count On: в поле маркера появится CNT с точной частотой.'],
    fields: [{ key: 'f', label: 'Частота, Гц (например 1000012345)' }],
    check(a, ans, x) {
      return [
        item(a.s.sigCount, 'Включён частотомер Sig Count'),
        item(near(ans.f, x.f, 2), 'Частота верна (±2 Гц)'),
      ]
    },
  },
  {
    id: 'rbw', title: 'Разделение близких сигналов полосой RBW', module: 'bw',
    setup(rnd) {
      const f = Math.round(r(rnd, 1500, 2500)) * 1e6
      const d = [20e3, 30e3, 50e3][ri(rnd, 0, 2)]
      return { signals: [{ kind: 'cw', f, p: -30 }, { kind: 'cw', f: f + d, p: -30 }], f, d, text: `Около ${fmtFreq(f)} на входе два сигнала одинакового уровня, очень близко друг к другу.` }
    },
    goal: 'Подберите RBW так, чтобы на экране было видно два отдельных пика, и измерьте разнос частот дельта-маркером.',
    hints: ['FREQ → частота из условия, SPAN → 500 kHz.', 'BW → Res BW Manual: уменьшайте RBW, пока пики не разделятся.', 'MKR: маркер 1 на один пик, Marker 2 (дельта) на второй: Δf в поле маркера.'],
    fields: [{ key: 'd', label: 'Разнос частот, кГц' }],
    check(a, ans, x) {
      const m2 = a.s.markers.slice(1).some((m) => m.on && m.delta)
      return [
        item(a.s.rbw < x.d, 'RBW меньше разноса частот'),
        item(m2, 'Включён дельта-маркер'),
        item(near(Math.abs(ans.d) * 1e3, x.d, 2e3), 'Разнос верен (±2 кГц)'),
      ]
    },
  },
  {
    id: 'offset', title: 'Учёт внешнего аттенюатора', module: 'freq',
    setup(rnd) {
      const tx = ri(rnd, 10, 17)
      const f = 1.8e9
      return { signals: [{ kind: 'cw', f, p: tx - 20 }], tx, f, text: 'Передатчик 1,8 ГГц подключён к анализатору через внешний аттенюатор 20 дБ.' }
    },
    goal: 'Настройте анализатор так, чтобы он сразу показывал мощность на выходе передатчика, без перегрузки, и измерьте её.',
    hints: ['AMPT → Ref Level Offset = 20 dB.', 'Опорный уровень сдвинется вместе с поправкой. Если появится IFOVL, поднимите Ref Level выше уровня сигнала.', 'FREQ → 1.8 GHz, SPAN → 1 MHz, MKR.'],
    fields: [{ key: 'p', label: 'Мощность передатчика, дБм' }],
    check(a, ans, x) {
      const st = a.status()
      return [
        item(near(a.s.refOffset, 20, 0.05), 'Ref Level Offset = 20 дБ'),
        item(!st.includes('IFOVL') && !st.includes('OVLD'), 'Нет перегрузки (OVLD, IFOVL)'),
        item(near(ans.p, x.tx, 1), 'Мощность верна (±1 дБ)'),
      ]
    },
  },
  {
    id: 'overload', title: 'Устранение перегрузки', module: 'freq',
    setup(rnd) {
      const f = Math.round(r(rnd, 500, 900)) * 1e6
      const p = ri(rnd, 3, 6)
      return { signals: [{ kind: 'cw', f, p }], f, p, text: `На вход подан мощный сигнал около ${fmtFreq(f)}. После PRESET прибор показывает перегрузку.` }
    },
    goal: 'Уберите метки OVLD и IFOVL правильной настройкой уровня и измерьте мощность сигнала.',
    hints: ['Найдите сигнал: FREQ, SPAN 1 MHz, MKR.', 'AMPT → Ref Level: поставьте опорный уровень выше уровня сигнала (например +10 дБм).', 'При RF Atten Auto ослабление увеличится само.'],
    fields: [{ key: 'p', label: 'Уровень, дБм' }],
    check(a, ans, x) {
      const st = a.status()
      return [
        item(!st.includes('OVLD'), 'Нет OVLD'),
        item(!st.includes('IFOVL'), 'Нет IFOVL'),
        item(anyMarkerNear(a, x.f, 200e3), 'Маркер на сигнале'),
        item(near(ans.p, x.p, 1), 'Уровень верен (±1 дБ)'),
      ]
    },
  },
  {
    id: 'weak', title: 'Слабый сигнал рядом с шумом', module: 'bw',
    setup(rnd) {
      const f = 2.4e9 + Math.round(r(rnd, -500, 500)) * 1e3
      const p = ri(rnd, -104, -100)
      return { signals: [{ kind: 'cw', f, p }], f, p, text: 'Около 2400 МГц (в пределах ±1 МГц) есть очень слабый сигнал. После PRESET его не видно под шумом.' }
    },
    goal: 'Сделайте сигнал видимым (минимум на 6 дБ выше шума) и измерьте его частоту и уровень.',
    hints: ['FREQ → 2.4 GHz, SPAN → 2 MHz.', 'BW → Res BW Manual → 1 kHz: шум опускается на 10 дБ при каждом уменьшении RBW в 10 раз. AMPT → RF Atten Manual → 0 dB.', 'Детектор Auto Peak покажет пик над шумом: MKR → Peak, затем MKR→ → Center =Mkr Freq и SPAN → 50 kHz.', 'Для стабильного уровня: TRACE → Trace Mode → Average, затем MKR→ → Peak.'],
    fields: [{ key: 'f', label: 'Частота, МГц' }, { key: 'p', label: 'Уровень, дБм' }],
    check(a, ans, x) {
      const m = a.s.markers.find((k) => k.on && Math.abs(k.x - x.f) <= Math.max(3 * a.s.rbw, a.s.span / 250))
      const snr = m ? a.levelAt(m.x) - a.displayedNoise(x.f) : -99
      return [
        item(!!m, 'Маркер стоит на сигнале'),
        item(snr >= 6, 'Сигнал выше шума не менее чем на 6 дБ'),
        item(near(ans.f * 1e6, x.f, 10e3), 'Частота верна (±10 кГц)'),
        item(near(ans.p, x.p, 2.5), 'Уровень верен (±2,5 дБ)'),
      ]
    },
  },
  {
    id: 'maxhold', title: 'Сигнал с перестройкой частоты', module: 'traces',
    setup(rnd) {
      const n = ri(rnd, 3, 6)
      const set = new Set()
      while (set.size < n) set.add(2402e6 + ri(rnd, 0, 38) * 2e6)
      return { signals: [{ kind: 'hop', freqs: [...set], p: -30 }], n, text: 'В диапазоне 2,40 – 2,48 ГГц работает передатчик, который каждый раз перескакивает на другую частоту из своего списка.' }
    },
    goal: 'Определите, сколько разных частот использует передатчик.',
    hints: ['FREQ → Start 2.4 GHz, Stop 2.48 GHz.', 'TRACE → Trace Mode → Max Hold.', 'Подождите, пока трасса перестанет меняться, и посчитайте пики.'],
    fields: [{ key: 'n', label: 'Число частот' }],
    check(a, ans, x) {
      return [
        item(a.s.traceMode === 'max', 'Трасса в режиме Max Hold'),
        item(Math.round(ans.n) === x.n, 'Число частот верно'),
      ]
    },
  },
  {
    id: 'harm', title: 'Измерение 2-й гармоники', module: 'advanced',
    setup(rnd) {
      const f = Math.round(r(rnd, 100, 300)) * 1e6
      const h = ri(rnd, -60, -45)
      return { signals: [{ kind: 'cw', f, p: -25 }, { kind: 'cw', f: 2 * f, p: -25 + h }], f, h, text: `Генератор выдаёт ${fmtFreq(f)}, –25 дБм. Нужно узнать, насколько подавлена его 2-я гармоника.` }
    },
    goal: 'Измерьте уровень 2-й гармоники относительно основного сигнала (в дБн).',
    hints: ['FREQ → частота сигнала, SPAN → 100 kHz, MKR.', 'MKR → More → Phase Noise/Ref Fixed → Ref Fixed: опорная точка на основном сигнале.', 'FREQ → CF Stepsize → =Marker, затем FREQ и ⯅: центр на 2-й гармонике.', 'MKR→ → Peak: дельта-маркер покажет уровень гармоники в дБ.'],
    fields: [{ key: 'h', label: 'Уровень 2-й гармоники, дБн' }],
    check(a, ans, x) {
      return [
        item(anyMarkerNear(a, 2 * x.f, 1e6), 'Маркер стоит на 2-й гармонике'),
        item(near(ans.h, x.h, 2), 'Уровень верен (±2 дБ)'),
      ]
    },
  },
  {
    id: 'noise', title: 'Плотность собственного шума', module: 'markers',
    setup() { return { signals: [], text: 'Вход анализатора нагружен на 50 Ом, сигнала нет.' } },
    goal: 'Измерьте плотность мощности собственного шума прибора на частоте 1,234 ГГц в дБм/Гц со стабильным результатом.',
    hints: ['FREQ → 1.234 GHz, SPAN → 1 MHz.', 'MKR → введите 1.234 GHz, затем Noise Meas On.', 'TRACE → Trace Mode → Average для стабильного результата.'],
    fields: [{ key: 'n', label: 'Плотность шума, дБм/Гц' }],
    check(a, ans) {
      const m = a.s.markers[0]
      const exp = danl(1.234e9) + a.s.att + (a.s.preamp ? -12 : 0) + a.s.refOffset
      return [
        item(a.s.noiseMeas, 'Включён Noise Meas'),
        item(m.on && Math.abs(m.x - 1.234e9) <= 1e6, 'Маркер на 1,234 ГГц'),
        item(a.s.traceMode === 'avg' || a.s.detector === 'rms', 'Результат стабилизирован (Average или RMS)'),
        item(near(ans.n, exp, 1.5), `Плотность шума верна (±1,5 дБ)`),
      ]
    },
  },
  {
    id: 'cp', title: 'Мощность в канале', module: 'meas',
    setup(rnd) {
      const f = Math.round(r(rnd, 900, 950)) * 1e6
      const p = ri(rnd, -25, -15)
      return { signals: [{ kind: 'band', f, bw: 1.23e6, p }], f, p, text: `На частоте ${fmtFreq(f)} работает цифровой передатчик с полосой канала 1,23 МГц.` }
    },
    goal: 'Измерьте мощность в канале функцией CP с правильной полосой канала.',
    hints: ['FREQ → частота канала.', 'MEAS → Channel Power (CP) → Channel Bandwidth = 1.23 MHz.', 'Adjust Settings: прибор сам выберет span, RBW, VBW и детектор RMS.'],
    fields: [{ key: 'p', label: 'Мощность в канале, дБм' }],
    check(a, ans, x) {
      return [
        item(a.s.meas === 'cp', 'Включено измерение CP'),
        item(near(a.s.chBw, 1.23e6, 0.03e6), 'Полоса канала 1,23 МГц'),
        item(near(a.s.center, x.f, 50e3), 'Центр на частоте канала'),
        item(a.s.detector === 'rms', 'Детектор RMS'),
        item(near(ans.p, x.p, 1), 'Мощность верна (±1 дБ)'),
      ]
    },
  },
  {
    id: 'acp', title: 'Мощность в соседних каналах (ACP)', module: 'meas',
    setup(rnd) {
      const f = Math.round(r(rnd, 1800, 1900)) * 1e6
      const p = ri(rnd, -15, -10)
      const aclr = ri(rnd, 40, 50)
      const exp = -(aclr + 3 * (1.25e6 - 1.23e6 / 2) / 1.25e6)
      return { signals: [{ kind: 'band', f, bw: 1.23e6, p, aclr, spacing: 1.25e6 }], f, exp, text: `Передатчик ${fmtFreq(f)}, полоса канала 1,23 МГц, разнос каналов 1,25 МГц. Нужно проверить излучение в соседние каналы.` }
    },
    goal: 'Измерьте мощность в нижнем соседнем канале относительно основного (дБн).',
    hints: ['FREQ → частота канала.', 'MEAS → Adjacent Chan (ACP): Channel Bandwidth 1.23 MHz, Channel Spacing 1.25 MHz.', 'Adjust Settings, затем при необходимости Adjust Ref Level.'],
    fields: [{ key: 'l', label: 'Нижний соседний канал, дБн' }],
    check(a, ans, x) {
      return [
        item(a.s.meas === 'acp', 'Включено измерение ACP'),
        item(near(a.s.chBw, 1.23e6, 0.03e6) && near(a.s.chSpacing, 1.25e6, 0.03e6), 'Полоса 1,23 МГц и разнос 1,25 МГц'),
        item(a.s.detector === 'rms', 'Детектор RMS'),
        item(near(-Math.abs(ans.l), x.exp, 2.5), 'Результат верен (±2,5 дБ)'),
      ]
    },
  },
  {
    id: 'obw', title: 'Занимаемая полоса 99 %', module: 'meas',
    setup(rnd) {
      const f = Math.round(r(rnd, 1500, 2500)) * 1e6
      const bw = Math.round(r(rnd, 2, 5) * 10) / 10 * 1e6
      return { signals: [{ kind: 'band', f, bw, p: -15 }], f, bw, text: `На частоте ${fmtFreq(f)} работает передатчик с неизвестной шириной спектра (несколько мегагерц).` }
    },
    goal: 'Измерьте занимаемую полосу (99 % мощности) функцией OBW.',
    hints: ['FREQ → частота сигнала, SPAN → 15 MHz.', 'MEAS → OBW. Полоса канала задаёт span для Adjust Settings: введите примерно ширину сигнала (например 5 MHz) и нажмите Adjust Settings.', 'Прочитайте Occ BW в таблице результатов.'],
    fields: [{ key: 'bw', label: 'Занимаемая полоса, МГц' }],
    check(a, ans, x) {
      return [
        item(a.s.meas === 'obw', 'Включено измерение OBW'),
        item(a.s.detector === 'rms', 'Детектор RMS'),
        item(near(ans.bw * 1e6, x.bw * 0.99, x.bw * 0.04), 'Полоса верна (±4 %)'),
      ]
    },
  },
  {
    id: 'am', title: 'Глубина амплитудной модуляции', module: 'meas',
    setup(rnd) {
      const f = Math.round(r(rnd, 50, 200)) * 1e6
      const m = ri(rnd, 20, 80) / 100
      return { signals: [{ kind: 'am', f, p: -20, fm: 10e3, m }], f, m, text: `Генератор ${fmtFreq(f)} выдаёт AM-сигнал с модулирующей частотой 10 кГц.` }
    },
    goal: 'Измерьте глубину модуляции в процентах.',
    hints: ['FREQ → частота несущей, SPAN → 50 kHz.', 'Боковые составляющие должны быть видны отдельно: RBW ≤ 3 kHz.', 'MEAS → AM Mod Depth или вычислите по дельта-маркеру: m = 2·10^(ΔдБ/20).'],
    fields: [{ key: 'm', label: 'Глубина модуляции, %' }],
    check(a, ans, x) {
      return [
        item(a.s.rbw <= 3e3, 'RBW разрешает боковые (≤ 3 кГц)'),
        item(near(ans.m, x.m * 100, 3), 'Глубина модуляции верна (±3 %)'),
      ]
    },
  },
  {
    id: 'toi', title: 'Собственная интермодуляция анализатора', module: 'advanced',
    setup(rnd) {
      const d = Math.round(r(rnd, 1, 5)) * 100e3
      return { signals: [{ kind: 'cw', f: 1e9, p: -20 }, { kind: 'cw', f: 1e9 + d, p: -20 }], d, text: `На вход поданы два чистых сигнала по –20 дБм: 1 ГГц и ${fmtFreq(1e9 + d)}. Генераторы сами интермодуляции не создают.` }
    },
    goal: 'При ослаблении 0 дБ и RBW 10 кГц измерьте TOI прибора функцией MEAS → TOI. Затем увеличьте ослабление так, чтобы продукты интермодуляции ушли под шум.',
    hints: ['FREQ → 1 GHz + половина разноса, SPAN → 5 × разнос.', 'AMPT → Ref Level −10 dBm, RF Atten Manual → 0 dB. BW → Res BW 10 kHz.', 'MEAS → TOI: запишите значение.', 'AMPT → RF Atten Manual: увеличьте ослабление (продукты 3-го порядка падают на 20 дБ на каждые 10 дБ ослабления).'],
    fields: [{ key: 't', label: 'TOI, дБм' }],
    check(a, ans) {
      const att = a.s.att
      const im = 3 * (-20 - att) - 26 + att
      const noise = a.displayedNoise(1e9)
      return [
        item(near(ans.t, 13, 2.5), 'TOI верна (±2,5 дБ)'),
        item(im < noise - 3, 'Собственные продукты интермодуляции ниже шума'),
        item(!a.status().includes('OVLD'), 'Нет перегрузки'),
      ]
    },
  },
]

export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]))
