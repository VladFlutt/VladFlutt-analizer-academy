// Схемы для уроков. Цвета через currentColor и var(--accent), чтобы читались в светлой и тёмной теме.

const arrow = `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`

function box(x, y, w, h, t1, t2, hot) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${hot ? 'var(--accent)' : 'currentColor'}" stroke-width="${hot ? 2 : 1.3}"/>
  <text x="${x + w / 2}" y="${y + (t2 ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">${t1}</text>
  ${t2 ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">${t2}</text>` : ''}`
}
const line = (x1, y1, x2, y2, label, ly = -6) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.3" marker-end="url(#ar)"/>${label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + ly}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".75">${label}</text>` : ''}`

const block = `<svg viewBox="0 0 900 250" role="img" aria-label="Путь сигнала: вход, аттенюатор, смеситель с гетеродином, фильтр ПЧ (RBW), детектор и логарифмический усилитель, видеофильтр (VBW), детектор трассы, экран">${arrow}
  <text x="14" y="62" font-size="12" fill="currentColor">ВЧ-вход</text>
  ${line(14, 75, 64, 75)}
  ${box(66, 50, 100, 50, 'Аттенюатор', 'RF Att 0–40 дБ')}
  ${line(166, 75, 202, 75)}
  ${box(204, 50, 100, 50, 'Смеситель', 'макс. −10 дБм', true)}
  ${line(304, 75, 340, 75, 'ПЧ')}
  ${box(342, 50, 110, 50, 'Фильтр ПЧ', 'RBW', true)}
  ${line(452, 75, 488, 75)}
  ${box(490, 50, 120, 50, 'Детектор + log', 'огибающая, дБ')}
  ${line(610, 75, 646, 75)}
  ${box(648, 50, 100, 50, 'Видеофильтр', 'VBW', true)}
  ${line(748, 75, 784, 75)}
  ${box(786, 50, 100, 50, 'Детектор', 'AP · Sa · RMS')}
  ${box(204, 170, 100, 50, 'Гетеродин', 'LO, перестройка')}
  ${line(254, 170, 254, 102, 'f LO', 0)}
  ${box(520, 170, 160, 50, 'Генератор развертки', 'SWT')}
  <line x1="520" y1="195" x2="306" y2="195" stroke="currentColor" stroke-width="1.3" stroke-dasharray="5 4" marker-end="url(#ar)"/>
  <text x="413" y="188" text-anchor="middle" font-size="11" fill="currentColor" opacity=".75">управляет частотой LO</text>
  <line x1="836" y1="100" x2="836" y2="140" stroke="currentColor" stroke-width="1.3" marker-end="url(#ar)"/>
  <text x="836" y="158" text-anchor="middle" font-size="12" fill="currentColor">экран, 501 точка</text>
</svg><figcaption>Супергетеродинный тракт: аттенюатор защищает смеситель, гетеродин переносит нужную частоту на ПЧ, где фильтр RBW выбирает полосу. Синим выделены три параметра, которые вы настраиваете чаще всего.</figcaption>`

function rbwPlot() {
  // два сигнала с разносом 30 кГц, гауссов фильтр шириной RBW
  const W = 380, H = 170, x0 = 30, x1 = 360, y0 = 20, y1 = 140
  const curve = (rbw) => {
    const pts = []
    for (let i = 0; i <= 200; i++) {
      const f = -100 + i  // кГц
      const p = 10 ** (-0.3 * ((f + 15) / (rbw / 2)) ** 2) + 10 ** (-0.3 * ((f - 15) / (rbw / 2)) ** 2)
      const dbv = Math.max(-50, 10 * Math.log10(p + 1e-6))
      pts.push(`${(x0 + (x1 - x0) * i / 200).toFixed(1)},${(y0 + (y1 - y0) * (-dbv + 3) / 53).toFixed(1)}`)
    }
    return pts.join(' ')
  }
  const panel = (dx, rbw, hot, title) => `<g transform="translate(${dx},0)">
    <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="currentColor" opacity=".25"/>
    <polyline points="${curve(rbw)}" fill="none" stroke="${hot ? 'var(--accent)' : 'currentColor'}" stroke-width="2"/>
    <text x="${(x0 + x1) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="currentColor">${title}</text></g>`
  return `<svg viewBox="0 0 ${W * 2 + 20} ${H}" role="img" aria-label="Два сигнала с разносом 30 кГц: при RBW 100 кГц видны как один пик, при RBW 10 кГц как два отдельных">
    ${panel(0, 100, false, 'RBW 100 кГц: один «горб»')}
    ${panel(W + 20, 10, true, 'RBW 10 кГц: два пика')}
  </svg><figcaption>Два сигнала одинакового уровня с разносом 30 кГц. С широкой RBW они сливаются; когда RBW меньше разноса, между пиками появляется провал.</figcaption>`
}

const k = (x, y, t, w = 56, hot) => `<rect x="${x}" y="${y}" width="${w}" height="26" rx="5" fill="none" stroke="${hot ? 'var(--accent)' : 'currentColor'}" stroke-width="${hot ? 1.8 : 1}"/><text x="${x + w / 2}" y="${y + 17}" text-anchor="middle" font-size="11" fill="currentColor">${t}</text>`
const panel = `<svg viewBox="0 0 900 300" role="img" aria-label="Передняя панель: экран, программные клавиши справа от экрана, системные клавиши, функциональные клавиши, цифровая клавиатура и ручка">
  <rect x="10" y="10" width="880" height="280" rx="14" fill="none" stroke="currentColor" opacity=".5"/>
  <rect x="30" y="30" width="360" height="240" rx="6" fill="none" stroke="currentColor"/>
  <text x="210" y="150" text-anchor="middle" font-size="14" fill="currentColor">Экран 640 × 480</text>
  ${Array.from({ length: 8 }, (_, i) => `<rect x="400" y="${32 + i * 29}" width="70" height="23" rx="4" fill="none" stroke="var(--accent)"/>`).join('')}
  <text x="435" y="290" text-anchor="middle" font-size="11" fill="currentColor" opacity=".75">softkeys</text>
  <text x="510" y="42" font-size="11" fill="currentColor" opacity=".7">SYSTEM</text>
  ${k(510, 50, 'PRESET', 60, true)}${k(574, 50, 'FILE')}${k(634, 50, 'SETUP')}${k(694, 50, 'PRINT')}
  <text x="510" y="100" font-size="11" fill="currentColor" opacity=".7">FUNCTION</text>
  ${k(510, 108, 'FREQ', 56, true)}${k(570, 108, 'SPAN', 56, true)}${k(630, 108, 'AMPT', 56, true)}${k(690, 108, 'MKR')}
  ${k(510, 138, 'BW')}${k(570, 138, 'SWEEP')}${k(630, 138, 'TRACE')}${k(690, 138, 'MKR→')}
  ${k(510, 168, 'TRIG')}${k(570, 168, 'MEAS')}${k(630, 168, 'LINES')}${k(690, 168, 'MODE')}
  <text x="760" y="42" font-size="11" fill="currentColor" opacity=".7">DATA ENTRY</text>
  ${['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d, i) => k(760 + (i % 3) * 38, 50 + Math.floor(i / 3) * 30, d, 34)).join('')}
  ${k(760, 140, 'ENTER', 110)}
  <circle cx="815" cy="225" r="38" fill="none" stroke="currentColor"/><circle cx="815" cy="225" r="6" fill="currentColor"/>
  <text x="815" y="280" text-anchor="middle" font-size="11" fill="currentColor" opacity=".75">ручка</text>
  <text x="600" y="232" text-anchor="middle" font-size="12" fill="currentColor">Функциональная клавиша → меню softkeys</text>
  <text x="600" y="250" text-anchor="middle" font-size="12" fill="currentColor">→ значение: цифры + единица или ручка</text>
</svg><figcaption>Порядок работы почти всегда одинаков: функциональная клавиша открывает меню справа от экрана, значение вводится цифрами с клавишей единиц или ручкой.</figcaption>`

const screen = `<svg viewBox="0 0 640 330" role="img" aria-label="Экран: сверху Ref, Att, RBW, VBW, SWT и метки состояния, в центре сетка 10 на 10 с трассой и полем маркера, снизу Center и Span">
  <rect x="10" y="10" width="620" height="310" rx="8" fill="none" stroke="currentColor" opacity=".5"/>
  <text x="24" y="32" font-size="12" fill="currentColor">Ref −10.0 dBm</text><text x="24" y="48" font-size="12" fill="currentColor">Att 10 dB</text>
  <text x="230" y="32" font-size="12" fill="currentColor">RBW 3 MHz</text><text x="230" y="48" font-size="12" fill="currentColor">VBW 10 MHz   SWT 2.5 ms</text>
  <text x="616" y="32" text-anchor="end" font-size="12" fill="var(--bad, #c62828)">OVLD · IFOVL · UNCAL</text>
  <rect x="40" y="60" width="560" height="220" fill="none" stroke="currentColor" opacity=".35"/>
  ${Array.from({ length: 9 }, (_, i) => `<line x1="${40 + 56 * (i + 1)}" y1="60" x2="${40 + 56 * (i + 1)}" y2="280" stroke="currentColor" opacity=".12"/><line x1="40" y1="${60 + 22 * (i + 1)}" x2="600" y2="${60 + 22 * (i + 1)}" stroke="currentColor" opacity=".12"/>`).join('')}
  <polyline points="40,250 150,248 250,251 300,245 312,120 320,95 328,120 340,246 420,250 600,249" fill="none" stroke="var(--accent)" stroke-width="2"/>
  <polygon points="320,90 314,80 326,80" fill="currentColor"/><text x="320" y="74" text-anchor="middle" font-size="11" fill="currentColor">1</text>
  <rect x="440" y="66" width="154" height="36" fill="none" stroke="currentColor" opacity=".4"/>
  <text x="448" y="80" font-size="11" fill="currentColor">M1 [1]  −20.05 dBm</text><text x="448" y="96" font-size="11" fill="currentColor">1.000000000 GHz</text>
  <text x="46" y="76" font-size="11" fill="currentColor" opacity=".75">1 AP CLRW</text>
  <text x="40" y="304" font-size="12" fill="currentColor">Center 1 GHz</text><text x="320" y="304" text-anchor="middle" font-size="12" fill="currentColor">1 MHz/</text><text x="600" y="304" text-anchor="end" font-size="12" fill="currentColor">Span 10 MHz</text>
</svg><figcaption>Сверху настройки (Ref, Att, RBW, VBW, SWT) и метки состояния, в центре сетка 10 × 10 делений с трассой и полем маркера, снизу частотная ось.</figcaption>`

export const FIGURES = { block, rbw: rbwPlot(), panel, screen }
