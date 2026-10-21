import { MODULES, EXAM } from './data.js'
import { renderMarkdown, splitLessons } from './md.js'
import { TASKS, TASK_BY_ID } from './tasks.js'
import { Analyzer, fmtFreq } from './analyzer.js'
import { mountAnalyzer } from './panel.js'
import { initTutor, tutorSync, taskReview, quizExplain } from './ai.js'
import { GLOSSARY, annotate, initTooltips } from './glossary.js'

const root = document.getElementById('root')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ---------- прогресс ----------
const KEY = 'fsl18-academy-v1'
const store = {
  data: { lessons: {}, quiz: {}, tasks: {}, exams: [], theme: null },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch {} },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)) } catch {} },
}
store.load()

function applyTheme() {
  const t = store.data.theme
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}
applyTheme()

const lessonCache = {}
async function lessons(mod) {
  if (!lessonCache[mod.id]) {
    const r = await fetch('content/' + mod.file)
    if (!r.ok) throw new Error('load failed')
    lessonCache[mod.id] = splitLessons(await r.text())
  }
  return lessonCache[mod.id]
}

function moduleProgress(mod, count) {
  const done = Object.keys(store.data.lessons).filter((k) => k.startsWith(mod.id + ':')).length
  const q = store.data.quiz[mod.id] || 0
  const parts = [count ? done / count : 0, q >= 80 ? 1 : q / 80]
  if (mod.tasks.length) parts.push(mod.tasks.filter((t) => store.data.tasks[t]).length / mod.tasks.length)
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100)
}

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ---------- каркас ----------
let cleanup = []
function shell(active, inner) {
  const nav = [['#/', 'Курс', 'home'], ['#/tasks', 'Задания', 'tasks'], ['#/sim', 'Тренажёр', 'sim'], ['#/exam', 'Экзамен', 'exam'], ['#/glossary', 'Словарь', 'glossary'], ['#/results', 'Результаты', 'results']]
  return `
  <header class="top">
    <a href="#/" class="brand"><span class="logo">FSL</span><span>Анализатор <b>Academy</b></span></a>
    <nav>${nav.map(([h, t, k]) => `<a href="${h}" class="${active === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <button class="theme" id="theme" title="Тёмная тема" aria-label="Переключить тему">◐</button>
  </header>
  <main class="wrap">${inner}</main>
  <footer class="foot">Учебная платформа по работе с анализатором спектра R&amp;S FSL18. Материал основан на Operating Manual и Specifications R&amp;S FSL. Тренажёр упрощённо моделирует прибор и не заменяет работу с реальным анализатором. Не связано с Rohde &amp; Schwarz. Прогресс хранится только в этом браузере.</footer>`
}

// ---------- главная ----------
async function homePage() {
  const counts = await Promise.all(MODULES.map((m) => lessons(m).then((l) => l.length).catch(() => 0)))
  const total = counts.reduce((a, b) => a + b, 0)
  const done = Object.keys(store.data.lessons).length
  const tasksDone = TASKS.filter((t) => store.data.tasks[t.id]).length
  const best = Math.max(0, ...store.data.exams.map((e) => e.score))
  const cards = MODULES.map((m, i) => {
    const p = moduleProgress(m, counts[i])
    const q = store.data.quiz[m.id]
    return `<a class="mod" href="#/module/${m.id}">
      <div class="mod-top"><span class="num">${m.num}</span><span class="ico">${m.icon}</span></div>
      <h3>${esc(m.title)}</h3><p>${esc(m.summary)}</p>
      <div class="meta"><span>${counts[i]} уроков</span><span>${m.quiz.length} вопросов</span>${m.tasks.length ? `<span>${m.tasks.length} задан.</span>` : ''}${q != null ? `<span class="${q >= 80 ? 'good' : 'bad'}">тест ${q}%</span>` : ''}</div>
      <div class="prog" title="Прогресс модуля ${p}%"><div style="width:${p}%"></div></div>
    </a>`
  }).join('')
  return shell('home', `
  <section class="hero">
    <div>
      <h1>Анализатор спектра R&amp;S FSL18 на практике</h1>
      <p>Десять модулей теории по руководству к прибору, тест после каждого модуля, виртуальный FSL18 с передней панелью и 15 практических заданий, а в конце итоговый экзамен с теорией и задачами на тренажёре.</p>
      <div class="row wrap"><a class="btn" href="#/module/intro">Начать модуль 1</a><a class="btn ghost" href="#/sim">Открыть тренажёр</a></div>
    </div>
    <div class="stats">
      <div><b>${done}/${total}</b><span>уроков прочитано</span></div>
      <div><b>${tasksDone}/${TASKS.length}</b><span>заданий выполнено</span></div>
      <div><b>${best ? best + '%' : '–'}</b><span>лучший экзамен</span></div>
    </div>
  </section>
  <section class="sec"><h2>Модули курса</h2><div class="grid">${cards}</div></section>
  <section class="sec card how">
    <h2>Как проходить курс</h2>
    <ol>
      <li><b>Теория.</b> Читайте уроки модуля по порядку и отмечайте прочитанные.</li>
      <li><b>Тест.</b> В конце модуля 10 вопросов с разбором; для зачёта нужно 80 %.</li>
      <li><b>Практика.</b> Задания модуля выполняются на виртуальном FSL18: прибор проверяет и настройки, и ваш ответ.</li>
      <li><b>Экзамен.</b> ${EXAM.questions} вопросов из всех модулей и ${EXAM.tasks} практических задачи, ${EXAM.minutes} минут, проходной балл ${EXAM.pass} %.</li>
    </ol>
  </section>`)
}

// ---------- модуль и уроки ----------
async function modulePage(id, n) {
  const mod = MODULES.find((m) => m.id === id)
  if (!mod) return notFound()
  let ls
  try { ls = await lessons(mod) } catch { return shell('home', '<p class="bad">Не удалось загрузить урок. Запустите сайт через веб-сервер (см. README).</p>') }
  const i = Math.min(Math.max(0, (n | 0)), ls.length - 1)
  const l = ls[i]
  const key = mod.id + ':' + i
  const side = ls.map((x, k) => `<a href="#/module/${mod.id}/${k}" class="${k === i ? 'on' : ''}">${store.data.lessons[mod.id + ':' + k] ? '✓' : '○'} ${esc(x.title)}</a>`).join('')
  const tasks = mod.tasks.map((t) => TASK_BY_ID[t]).filter(Boolean)
  const next = i < ls.length - 1 ? `<a class="btn" href="#/module/${mod.id}/${i + 1}" data-read="${key}">Прочитано, дальше →</a>` : `<a class="btn" href="#/quiz/${mod.id}" data-read="${key}">Прочитано, к тесту →</a>`
  return shell('home', `
  <div class="crumbs"><a href="#/">Курс</a> / Модуль ${mod.num}</div>
  <div class="layout">
    <aside class="side card">
      <div class="side-t">${mod.icon} ${esc(mod.title)}</div>
      ${side}
      <a href="#/quiz/${mod.id}" class="quiz-link">📝 Тест модуля ${store.data.quiz[mod.id] != null ? `(${store.data.quiz[mod.id]}%)` : ''}</a>
      ${tasks.map((t) => `<a href="#/task/${t.id}" class="quiz-link">🛠 ${esc(t.title)} ${store.data.tasks[t.id] ? '✓' : ''}</a>`).join('')}
    </aside>
    <article class="lesson card">
      <div class="muted small">Урок ${i + 1} из ${ls.length}</div>
      <h1>${esc(l.title)}</h1>
      ${renderMarkdown(l.body)}
      <div class="row wrap lesson-nav">
        ${i > 0 ? `<a class="btn ghost" href="#/module/${mod.id}/${i - 1}">← Назад</a>` : ''}
        ${next}
      </div>
    </article>
  </div>`)
}

// ---------- тест модуля ----------
function quizPage(id) {
  const mod = MODULES.find((m) => m.id === id)
  if (!mod) return notFound()
  const qs = shuffle(mod.quiz.map((q, i) => ({ ...q, i }))).map((q) => {
    const order = shuffle(q.o.map((_, k) => k))
    return { ...q, order }
  })
  window.__quiz = { mod, qs }
  return shell('home', `
  <div class="crumbs"><a href="#/">Курс</a> / <a href="#/module/${mod.id}">Модуль ${mod.num}</a> / Тест</div>
  <h1>Тест: ${esc(mod.title)}</h1>
  <p class="lead">${qs.length} вопросов. Для зачёта нужно 80 %. Лучший результат: ${store.data.quiz[mod.id] != null ? store.data.quiz[mod.id] + '%' : 'ещё нет'}.</p>
  <form id="quiz">${qs.map((q, n) => questionHtml(q, n)).join('')}
    <div class="row"><button class="btn" type="submit">Проверить</button></div>
  </form>
  <div id="quiz-res"></div>`)
}

function questionHtml(q, n, name = 'q') {
  return `<fieldset class="card q" data-n="${n}"><legend>${n + 1}. ${esc(q.q)}</legend>
    ${q.order.map((k) => `<label class="opt"><input type="radio" name="${name}${n}" value="${k}"> <span>${esc(q.o[k])}</span></label>`).join('')}
    <div class="expl" hidden></div></fieldset>`
}

function gradeQuestions(form, qs, name = 'q') {
  let ok = 0
  qs.forEach((q, n) => {
    const v = form.querySelector(`input[name="${name}${n}"]:checked`)
    const fs = form.querySelector(`fieldset[data-n="${n}"]`)
    const right = v && +v.value === q.a
    if (right) ok++
    fs.classList.toggle('right', !!right)
    fs.classList.toggle('wrong', !right)
    const ex = fs.querySelector('.expl')
    ex.hidden = false
    ex.innerHTML = `${right ? '✓ Верно.' : `✗ Правильный ответ: <b>${esc(q.o[q.a])}</b>.`} ${esc(q.e)}`
    annotate(ex)
  })
  return ok
}

// ---------- задания ----------
function tasksPage() {
  const byMod = MODULES.filter((m) => m.tasks.length)
  const used = new Set()
  const rows = TASKS.map((t) => {
    const mod = MODULES.find((m) => m.id === t.module)
    used.add(t.id)
    return `<a class="task-row card" href="#/task/${t.id}"><span class="st ${store.data.tasks[t.id] ? 'good' : 'muted'}">${store.data.tasks[t.id] ? '✓ выполнено' : '○ не выполнено'}</span><b>${esc(t.title)}</b><span class="muted small">Модуль ${mod?.num}: ${esc(mod?.title)}</span></a>`
  }).join('')
  void byMod
  return shell('tasks', `
  <h1>Практические задания</h1>
  <p class="lead">Каждое задание запускает виртуальный FSL18 с подготовленным сигналом на входе. Параметры сигнала случайные, поэтому задание можно проходить несколько раз. Нажмите «Проверить», когда настроите прибор и запишете ответ.</p>
  <div class="task-list">${rows}</div>`)
}

function seedRnd(seed) {
  let x = seed >>> 0 || 7
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

function taskBlock(t, idx = '') {
  return `<div class="task-panel card" id="tp${idx}">
    <div class="tp-info">
      <h2>${esc(t.title)}</h2>
      <p class="cond"></p>
      <p><b>Цель:</b> ${esc(t.goal)}</p>
      <details><summary>Подсказка</summary><ol>${t.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ol></details>
    </div>
    <div class="tp-ans">
      <form class="answers">
        ${t.fields.map((f) => `<label class="field"><span>${esc(f.label)}</span><input name="${f.key}" inputmode="decimal" autocomplete="off" required></label>`).join('')}
        <div class="row wrap"><button class="btn" type="submit">Проверить</button><button class="btn ghost" type="button" data-new="1">Новый сигнал</button></div>
      </form>
      <ul class="checks"></ul>
    </div>
  </div>`
}

function bindTask(el, t, sim, { onResult, exam = false } = {}) {
  let setup
  const condEl = el.querySelector('.cond')
  const checksEl = el.querySelector('.checks')
  const newBtn = el.querySelector('[data-new]')
  if (exam) newBtn.remove()
  function fresh() {
    setup = t.setup(seedRnd(Date.now() ^ Math.floor(Math.random() * 1e9)))
    sim.analyzer.preset()
    sim.analyzer.setSignals(setup.signals)
    condEl.innerHTML = `<b>Условие:</b> ${esc(setup.text)}`
    checksEl.innerHTML = ''
    el.querySelector('.ai-inline')?.remove()
    el.querySelector('form').reset()
    if (!exam) annotate(el.querySelector('.tp-info'))
  }
  fresh()
  newBtn?.addEventListener('click', fresh)
  el.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.target)
    const ans = {}
    for (const f of t.fields) ans[f.key] = parseFloat(String(fd.get(f.key)).replace(',', '.').replace(/\s/g, ''))
    const items = t.check(sim.analyzer, ans, setup)
    const ok = items.every((x) => x.ok)
    checksEl.innerHTML = items.map((x) => `<li class="${x.ok ? 'good' : 'bad'}">${x.ok ? '✓' : '✗'} ${esc(x.text)}</li>`).join('') +
      `<li class="verdict ${ok ? 'good' : 'bad'}">${ok ? 'Задание выполнено!' : 'Пока не всё верно. Исправьте настройки или ответ и проверьте снова.'}</li>`
    if (!exam && !ok) taskReview(el.querySelector('.tp-ans'), t, items, ans, sim.analyzer, condEl.textContent)
    else el.querySelector('.ai-inline')?.remove()
    onResult?.(ok, items)
  })
}

function taskPage(id) {
  const t = TASK_BY_ID[id]
  if (!t) return notFound()
  const i = TASKS.indexOf(t)
  const prev = TASKS[i - 1], next = TASKS[i + 1]
  setTimeout(() => {
    const sim = mountAnalyzer(document.getElementById('sim'))
    cleanup.push(() => sim.destroy())
    bindTask(document.getElementById('tp'), t, sim, {
      onResult: (ok) => { if (ok) { store.data.tasks[t.id] = true; store.save() } },
    })
  })
  return shell('tasks', `
  <div class="crumbs"><a href="#/tasks">Задания</a> / ${i + 1} из ${TASKS.length}</div>
  <div class="sim-layout">
    ${taskBlock(t)}
    <div id="sim"></div>
  </div>
  <div class="row wrap">${prev ? `<a class="btn ghost" href="#/task/${prev.id}">← ${esc(prev.title)}</a>` : ''}${next ? `<a class="btn ghost" href="#/task/${next.id}">${esc(next.title)} →</a>` : ''}</div>`)
}

// ---------- свободный тренажёр ----------
const SOURCES = {
  off: { label: 'Нет сигнала (50 Ом)', signals: [] },
  cw: { label: 'Синусоида 1 ГГц, −20 дБм', signals: [{ kind: 'cw', f: 1e9, p: -20 }] },
  harm: { label: 'Генератор 128 МГц, −25 дБм, с гармониками', signals: [{ kind: 'cw', f: 128e6, p: -25 }, { kind: 'cw', f: 256e6, p: -75 }, { kind: 'cw', f: 384e6, p: -85 }] },
  two: { label: 'Два тона 1 ГГц и 1,0002 ГГц, −20 дБм', signals: [{ kind: 'cw', f: 1e9, p: -20 }, { kind: 'cw', f: 1.0002e9, p: -20 }] },
  am: { label: 'AM 100 МГц, fm 10 кГц, m = 50 %', signals: [{ kind: 'am', f: 100e6, p: -20, fm: 10e3, m: 0.5 }] },
  band: { label: 'Цифровой канал 900 МГц, 1,23 МГц, −20 дБм', signals: [{ kind: 'band', f: 900e6, bw: 1.23e6, p: -20, aclr: 45, spacing: 1.25e6 }] },
  hop: { label: 'Перестройка частоты 2,40–2,48 ГГц', signals: [{ kind: 'hop', freqs: [2.404e9, 2.426e9, 2.441e9, 2.466e9, 2.478e9], p: -30 }] },
  weak: { label: 'Слабый сигнал 2,4 ГГц, −105 дБм', signals: [{ kind: 'cw', f: 2.4e9, p: -105 }] },
  strong: { label: 'Мощный сигнал 700 МГц, +5 дБм', signals: [{ kind: 'cw', f: 700e6, p: 5 }] },
  burst: { label: 'Пакетный сигнал 1,8 ГГц (смотреть в Zero Span)', signals: [{ kind: 'burst', f: 1.8e9, p: -20, period: 4.6e-3, duty: 0.125 }, { kind: 'cw', f: 1.8e9, p: -200 }] },
}

function simPage() {
  setTimeout(() => {
    const sim = mountAnalyzer(document.getElementById('sim'))
    cleanup.push(() => sim.destroy())
    const sel = document.getElementById('src')
    const apply = () => { sim.analyzer.setSignals(SOURCES[sel.value].signals); renderInfo() }
    const renderInfo = () => {
      const s = SOURCES[sel.value].signals.filter((x) => x.p > -150)
      document.getElementById('src-info').textContent = s.length ? s.map((x) => `${x.kind === 'band' ? 'канал' : x.kind === 'hop' ? 'прыжки' : x.kind === 'am' ? 'AM' : x.kind === 'burst' ? 'пакеты' : 'CW'} ${x.f ? fmtFreq(x.f) : ''} ${x.p} дБм`).join(' · ') : 'Вход нагружен на 50 Ом.'
    }
    sel.addEventListener('change', apply)
    apply()
  })
  return shell('sim', `
  <h1>Тренажёр R&amp;S FSL18</h1>
  <p class="lead">Виртуальная передняя панель. Выберите сигнал генератора, подключённого ко входу, и пробуйте настройки свободно. Значения вводятся цифрами и клавишей единиц, ручка крутится колёсиком мыши, щелчок по экрану ставит маркер.</p>
  <div class="row wrap"><label>Сигнал на входе: <select id="src">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label><span class="muted small" id="src-info"></span></div>
  <div id="sim"></div>
  <div class="card cheat">
    <h3>Шпаргалка</h3>
    <div class="cheat-grid">
      <div><b>Найти сигнал</b><br>PRESET → MKR → MKR→ Center =Mkr Freq → SPAN</div>
      <div><b>Ввод значения</b><br>Цифры + GHz/MHz/kHz/Hz; уровень: dBm или −dBm</div>
      <div><b>Слабый сигнал</b><br>Меньше RBW, меньше Att, TRACE → Average</div>
      <div><b>Перегрузка</b><br>OVLD → больше Att; IFOVL → выше Ref Level</div>
      <div><b>Мощность канала</b><br>MEAS → CP → Channel Bandwidth → Adjust Settings</div>
      <div><b>Точная частота</b><br>MKR → Sig Count On</div>
    </div>
    <p class="muted small">В тренажёре установлены опции B7 (узкие RBW от 10 Гц) и B22 (предусилитель). Доступна трасса 1.</p>
  </div>`)
}

// ---------- экзамен ----------
let exam = null
function examPage() {
  if (!exam || exam.finished) {
    const last = store.data.exams[store.data.exams.length - 1]
    return shell('exam', `
    <h1>Итоговый экзамен</h1>
    <div class="card">
      <p>Экзамен состоит из <b>${EXAM.questions} вопросов</b> по всем модулям и <b>${EXAM.tasks} практических заданий</b> на тренажёре. Время: <b>${EXAM.minutes} минут</b>.</p>
      <ul>
        <li>Теория даёт 60 % оценки, практика 40 % (по 20 % за задание).</li>
        <li>В практических заданиях ответ фиксируется один раз: проверьте настройки перед отправкой.</li>
        <li>Проходной балл: <b>${EXAM.pass} %</b>.</li>
      </ul>
      ${exam?.finished ? examResultHtml(exam) : last ? `<p class="muted">Последняя попытка: ${last.score}% (${last.pass ? 'сдан' : 'не сдан'}), ${new Date(last.date).toLocaleString('ru-RU')}.</p>` : ''}
      <button class="btn" id="exam-start">${exam?.finished ? 'Пройти ещё раз' : 'Начать экзамен'}</button>
    </div>`)
  }
  return examRunHtml()
}

function startExam() {
  const pool = MODULES.flatMap((m) => m.quiz.map((q) => ({ ...q, mod: m.id })))
  const qs = shuffle(pool).slice(0, EXAM.questions).map((q) => ({ ...q, order: shuffle(q.o.map((_, k) => k)) }))
  const tasks = shuffle(TASKS.filter((t) => t.id !== 'cal')).slice(0, EXAM.tasks)
  exam = { qs, tasks, results: tasks.map(() => null), answers: {}, tab: 0, deadline: Date.now() + EXAM.minutes * 60e3, finished: false }
  location.hash = '#/exam'
  render()
}

function examRunHtml() {
  const tabs = ['Теория', ...exam.tasks.map((_, i) => `Практика ${i + 1}`)]
  const t = exam.tab
  setTimeout(() => {
    const timer = document.getElementById('timer')
    const iv = setInterval(() => {
      const left = exam.deadline - Date.now()
      if (left <= 0) { clearInterval(iv); finishExam(); return }
      if (timer) timer.textContent = `${Math.floor(left / 60e3)}:${String(Math.floor(left / 1e3) % 60).padStart(2, '0')}`
    }, 500)
    cleanup.push(() => clearInterval(iv))
    if (t === 0) {
      const form = document.getElementById('exam-q')
      for (const [k, v] of Object.entries(exam.answers)) { const inp = form.querySelector(`input[name="${k}"][value="${v}"]`); if (inp) inp.checked = true }
      form.addEventListener('change', (ev) => { exam.answers[ev.target.name] = ev.target.value })
    } else {
      const ti = t - 1
      const sim = mountAnalyzer(document.getElementById('sim'))
      cleanup.push(() => sim.destroy())
      const el = document.getElementById('tp' + ti)
      if (exam.results[ti]) {
        sim.analyzer.setSignals(exam.results[ti].signals)
        el.querySelector('form').innerHTML = `<p class="${exam.results[ti].ok ? 'good' : 'bad'}">Ответ зафиксирован: ${exam.results[ti].ok ? 'задание выполнено' : 'задание не выполнено'}.</p>`
        el.querySelector('.cond').innerHTML = `<b>Условие:</b> ${esc(exam.results[ti].text)}`
      } else {
        const origSetup = exam.tasks[ti].setup
        exam.setups = exam.setups || []
        const wrapped = { ...exam.tasks[ti], setup: (rnd) => (exam.setups[ti] = exam.setups[ti] || origSetup(rnd)) }
        bindTask(el, wrapped, sim, {
          exam: true,
          onResult: (ok) => {
            exam.results[ti] = { ok, signals: exam.setups[ti].signals, text: exam.setups[ti].text }
            el.querySelector('form').innerHTML = `<p class="muted">Ответ зафиксирован.</p>`
          },
        })
      }
    }
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { exam.tab = +b.dataset.tab; render() }))
    document.getElementById('exam-finish').addEventListener('click', () => {
      const missing = exam.qs.length - Object.keys(exam.answers).length + exam.results.filter((r) => !r).length
      if (missing && !confirm(`Осталось без ответа: ${missing}. Завершить экзамен?`)) return
      finishExam()
    })
  })
  const body = t === 0
    ? `<form id="exam-q">${exam.qs.map((q, n) => questionHtml(q, n, 'e')).join('')}</form>`
    : `<div class="sim-layout">${taskBlock(exam.tasks[t - 1], t - 1)}<div id="sim"></div></div>`
  return shell('exam', `
  <div class="exam-bar card">
    <div class="tabs">${tabs.map((x, i) => `<button class="tab ${i === t ? 'on' : ''}" data-tab="${i}">${x}${i > 0 && exam.results[i - 1] ? ' ✓' : ''}</button>`).join('')}</div>
    <div class="row"><span class="timer">⏱ <b id="timer">${EXAM.minutes}:00</b></span><button class="btn" id="exam-finish">Завершить</button></div>
  </div>
  ${t === 0 ? `<p class="muted">Ответов: ${Object.keys(exam.answers).length} из ${exam.qs.length}</p>` : ''}
  ${body}`)
}

function finishExam() {
  if (!exam || exam.finished) return
  let ok = 0
  const byMod = {}
  exam.qs.forEach((q, n) => {
    const right = +exam.answers['e' + n] === q.a && exam.answers['e' + n] != null
    if (right) ok++
    byMod[q.mod] = byMod[q.mod] || { ok: 0, n: 0 }
    byMod[q.mod].n++
    if (right) byMod[q.mod].ok++
  })
  const tasksOk = exam.results.filter((r) => r?.ok).length
  const score = Math.round(ok / exam.qs.length * 60 + tasksOk / exam.tasks.length * 40)
  exam.finished = true
  exam.summary = { ok, tasksOk, score, pass: score >= EXAM.pass, byMod }
  store.data.exams.push({ date: Date.now(), score, q: ok, qn: exam.qs.length, t: tasksOk, tn: exam.tasks.length, pass: score >= EXAM.pass, byMod })
  store.save()
  location.hash = '#/exam'
  render()
}

function examResultHtml(e) {
  const s = e.summary
  const weak = Object.entries(s.byMod).filter(([, v]) => v.ok < v.n).map(([k]) => MODULES.find((m) => m.id === k))
  return `<div class="exam-res ${s.pass ? 'pass' : 'fail'}">
    <div class="big">${s.score}%</div>
    <div><b>${s.pass ? 'Экзамен сдан' : 'Экзамен не сдан'}</b><br>Теория: ${s.ok} из ${e.qs.length}. Практика: ${s.tasksOk} из ${e.tasks.length}.</div>
  </div>
  ${weak.length ? `<p>Ошибки были в темах: ${weak.map((m) => `<a href="#/module/${m.id}">${esc(m.title)}</a>`).join(', ')}.</p>` : ''}
  <details><summary>Разбор вопросов</summary>${e.qs.map((q, n) => {
    const v = e.answers['e' + n]
    const right = v != null && +v === q.a
    return `<p class="${right ? 'good' : 'bad'}">${right ? '✓' : '✗'} ${n + 1}. ${esc(q.q)}<br><span class="muted">Правильно: ${esc(q.o[q.a])}. ${esc(q.e)}</span></p>`
  }).join('')}</details>`
}

// ---------- результаты ----------
async function resultsPage() {
  const counts = await Promise.all(MODULES.map((m) => lessons(m).then((l) => l.length).catch(() => 0)))
  const rows = MODULES.map((m, i) => {
    const q = store.data.quiz[m.id]
    const p = moduleProgress(m, counts[i])
    return `<div class="bar-row" title="${esc(m.title)}: тест ${q != null ? q + '%' : 'не пройден'}, прогресс ${p}%">
      <span class="bar-l">${m.num}. ${esc(m.title)}</span>
      <span class="bar-t"><span class="bar-f" style="width:${q || 0}%"></span><span class="bar-th"></span></span>
      <span class="bar-v">${q != null ? q + '%' : '—'}${q != null && q < 80 ? ' <span class="tag">ниже 80 %</span>' : ''}</span>
    </div>`
  }).join('')
  const weak = MODULES.filter((m) => store.data.quiz[m.id] == null || store.data.quiz[m.id] < 80)
  const tasksDone = TASKS.filter((t) => store.data.tasks[t.id])
  const ex = store.data.exams.slice().reverse()
  return shell('results', `
  <h1>Мои результаты</h1>
  <div class="stats wide">
    <div><b>${Object.keys(store.data.lessons).length}/${counts.reduce((a, b) => a + b, 0)}</b><span>уроков прочитано</span></div>
    <div><b>${MODULES.filter((m) => (store.data.quiz[m.id] || 0) >= 80).length}/${MODULES.length}</b><span>тестов сдано</span></div>
    <div><b>${tasksDone.length}/${TASKS.length}</b><span>заданий выполнено</span></div>
    <div><b>${ex.length ? Math.max(...ex.map((e) => e.score)) + '%' : '–'}</b><span>лучший экзамен</span></div>
  </div>
  <section class="card sec">
    <h2>Лучший результат теста по модулям</h2>
    <p class="muted small">Вертикальная линия — порог зачёта 80 %.</p>
    <div class="bars">${rows}</div>
  </section>
  ${weak.length ? `<section class="card sec"><h2>Что повторить</h2><ul>${weak.map((m) => `<li><a href="#/module/${m.id}">${esc(m.title)}</a> — ${store.data.quiz[m.id] == null ? 'тест не пройден' : `тест ${store.data.quiz[m.id]}%`}</li>`).join('')}</ul></section>` : ''}
  <section class="card sec">
    <h2>Практические задания</h2>
    <ul class="cols">${TASKS.map((t) => `<li class="${store.data.tasks[t.id] ? 'good' : 'muted'}">${store.data.tasks[t.id] ? '✓' : '○'} <a href="#/task/${t.id}">${esc(t.title)}</a></li>`).join('')}</ul>
  </section>
  <section class="card sec">
    <h2>Попытки экзамена</h2>
    ${ex.length ? `<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Балл</th><th>Теория</th><th>Практика</th><th>Итог</th></tr></thead><tbody>${ex.map((e) => `<tr><td>${new Date(e.date).toLocaleString('ru-RU')}</td><td><b>${e.score}%</b></td><td>${e.q}/${e.qn}</td><td>${e.t}/${e.tn}</td><td class="${e.pass ? 'good' : 'bad'}">${e.pass ? 'сдан' : 'не сдан'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Экзамен ещё не сдавался.</p>'}
  </section>
  <div class="row"><button class="btn ghost" id="reset">Сбросить весь прогресс</button></div>`)
}

// ---------- словарь ----------
function glossaryPage(id) {
  const latin = (s) => /^[A-Za-z]/.test(s)
  const items = GLOSSARY.slice().sort((a, b) => (latin(a.t) === latin(b.t) ? a.t.localeCompare(b.t, 'ru', { sensitivity: 'base' }) : latin(a.t) ? -1 : 1))
  let letter = ''
  const rows = items.map((g) => {
    const L = g.t[0].toUpperCase()
    const head = L !== letter ? `<h2 class="g-letter">${(letter = L)}</h2>` : ''
    return `${head}<div class="g-item card${g.id === id ? ' hl' : ''}" id="g-${g.id}" data-s="${esc((g.t + ' ' + (g.full || '') + ' ' + g.d).toLowerCase())}">
      <div class="g-term">${esc(g.t)}${g.full ? ` <span class="muted">— ${esc(g.full)}</span>` : ''}</div>
      <div>${esc(g.d)}</div></div>`
  }).join('')
  return shell('glossary', `
  <h1>Словарь терминов</h1>
  <p class="lead">${GLOSSARY.length} терминов и сокращений, которые встречаются в курсе. В уроках, тестах и заданиях термины подчёркнуты пунктиром: наведите на них мышь или нажмите, чтобы увидеть объяснение.</p>
  <input type="search" id="g-search" class="g-search" placeholder="Поиск: RBW, детектор, дБм…" aria-label="Поиск по словарю">
  <div id="g-list">${rows}</div>
  <p id="g-empty" class="muted" hidden>Ничего не найдено.</p>`)
}

function notFound() { return shell('', '<h1>Страница не найдена</h1><p><a href="#/">На главную</a></p>') }

// ---------- маршрутизация ----------
async function render() {
  cleanup.forEach((f) => f())
  cleanup = []
  const h = location.hash.replace(/^#\/?/, '')
  const [page, a, b] = h.split('/')
  let html
  if (!page) html = await homePage()
  else if (page === 'module') html = await modulePage(a, b)
  else if (page === 'quiz') html = quizPage(a)
  else if (page === 'tasks') html = tasksPage()
  else if (page === 'task') html = taskPage(a)
  else if (page === 'sim') html = simPage()
  else if (page === 'exam') html = examPage()
  else if (page === 'results') html = await resultsPage()
  else if (page === 'glossary') html = glossaryPage(a)
  else html = notFound()
  root.innerHTML = html
  if (!(page === 'exam' && exam && !exam.finished)) window.scrollTo(0, 0)
  if (page === 'glossary' && a) document.getElementById('g-' + a)?.scrollIntoView({ block: 'center' })
  bind(page)
  tutorSync()
}

function bind(page) {
  document.getElementById('theme')?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    store.data.theme = dark ? 'light' : 'dark'
    store.save()
    applyTheme()
  })
  document.querySelectorAll('[data-read]').forEach((el) => el.addEventListener('click', () => { store.data.lessons[el.dataset.read] = true; store.save() }))
  document.querySelectorAll('pre .copy').forEach((b) => b.addEventListener('click', () => { navigator.clipboard?.writeText(b.parentElement.querySelector('code').textContent); b.textContent = 'Скопировано' }))
  if (page === 'module') annotate(document.querySelector('.lesson'))
  if (page === 'quiz') { const seen = new Set(); document.querySelectorAll('#quiz legend').forEach((l) => annotate(l, seen)) }
  if (page === 'glossary') {
    const inp = document.getElementById('g-search')
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase()
      let n = 0
      document.querySelectorAll('.g-item').forEach((el) => { const on = !q || el.dataset.s.includes(q); el.hidden = !on; n += on })
      document.querySelectorAll('.g-letter').forEach((h) => { h.hidden = !!q })
      document.getElementById('g-empty').hidden = n > 0
    })
  }
  if (page === 'quiz') {
    const form = document.getElementById('quiz')
    form.addEventListener('submit', (ev) => {
      ev.preventDefault()
      const { mod, qs } = window.__quiz
      const ok = gradeQuestions(form, qs)
      form.querySelectorAll('.ai-inline').forEach((x) => x.remove())
      qs.forEach((q, n) => {
        const v = form.querySelector(`input[name="q${n}"]:checked`)
        if (!v || +v.value !== q.a) quizExplain(form.querySelector(`fieldset[data-n="${n}"]`), q, v ? +v.value : null)
      })
      const pct = Math.round(ok / qs.length * 100)
      store.data.quiz[mod.id] = Math.max(store.data.quiz[mod.id] || 0, pct)
      store.save()
      const idx = MODULES.indexOf(mod)
      const next = MODULES[idx + 1]
      document.getElementById('quiz-res').innerHTML = `<div class="card exam-res ${pct >= 80 ? 'pass' : 'fail'}"><div class="big">${pct}%</div><div><b>${pct >= 80 ? 'Тест сдан' : 'Нужно 80 % — повторите модуль и попробуйте снова'}</b><br>${ok} из ${qs.length} верно.
        <div class="row wrap"><a class="btn ghost" href="#/quiz/${mod.id}" onclick="setTimeout(()=>dispatchEvent(new HashChangeEvent('hashchange')))">Пройти ещё раз</a>${mod.tasks.length ? `<a class="btn ghost" href="#/task/${mod.tasks[0]}">К практике</a>` : ''}${next ? `<a class="btn" href="#/module/${next.id}">Модуль ${next.num} →</a>` : '<a class="btn" href="#/exam">К экзамену →</a>'}</div></div></div>`
      document.getElementById('quiz-res').scrollIntoView({ behavior: 'smooth' })
    })
  }
  if (page === 'exam') document.getElementById('exam-start')?.addEventListener('click', startExam)
  if (page === 'results') document.getElementById('reset')?.addEventListener('click', () => {
    if (!confirm('Удалить весь прогресс в этом браузере?')) return
    store.data = { lessons: {}, quiz: {}, tasks: {}, exams: [], theme: store.data.theme }
    store.save()
    render()
  })
}

addEventListener('hashchange', render)
initTooltips()
initTutor()
render()

// для отладки в консоли
window.FSL = { Analyzer }
