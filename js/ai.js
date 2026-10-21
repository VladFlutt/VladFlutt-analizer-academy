// ИИ-функции платформы: наставник (чат с контекстом страницы), разбор ошибок
// в заданиях и подробное объяснение ответов теста. Ответ приходит потоком
// от серверной функции /api/ai.

import { fmtFreq, fmtTime, DET_NAME, MODE_LABEL } from './analyzer.js'
import { renderMarkdown } from './md.js'
import { annotate } from './glossary.js'

const REMOTE = 'https://analizer-academy.vercel.app/api/ai'
const endpoint = () => window.AI_ENDPOINT || (/\.vercel\.app$/.test(location.hostname) ? '/api/ai' : REMOTE)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function askAI(payload, onText) {
  let res
  try {
    res = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    throw new Error('Нет связи с ИИ-наставником. Проверьте подключение к интернету.')
  }
  if (!res.ok) {
    let msg = 'ИИ-наставник временно недоступен.'
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += dec.decode(value, { stream: true })
    onText(text)
  }
  return text
}

// Сводка настроек виртуального прибора для ИИ.
export function analyzerSummary(a) {
  if (!a) return ''
  const s = a.s
  const lines = [
    `Вход: ${s.input === 'cal' ? 'внутренний калибратор 65 МГц' : 'RF'}`,
    s.span > 0 ? `Center ${fmtFreq(s.center)}, Span ${fmtFreq(s.span)} (${fmtFreq(a.start)} … ${fmtFreq(a.stop)})` : `Zero Span на ${fmtFreq(s.center)}`,
    `Ref Level ${s.ref} дБм${s.refOffset ? `, Ref Offset ${s.refOffset} дБ` : ''}, шкала ${s.range} дБ`,
    `Att ${s.att} дБ${s.attAuto ? ' (auto)' : ''}, предусилитель ${s.preamp ? 'вкл' : 'выкл'}`,
    `RBW ${fmtFreq(s.rbw)}${s.rbwAuto ? ' (auto)' : ''}, VBW ${fmtFreq(s.vbw)}${s.vbwAuto ? ' (auto)' : ''}, SWT ${fmtTime(s.swt)}${s.swtAuto ? ' (auto)' : ''}`,
    `Развертка: ${s.cont ? 'непрерывная' : 'однократная'}, триггер ${s.trigger}`,
    `Трасса: ${MODE_LABEL[s.traceMode]}, детектор ${DET_NAME[s.detector]}${s.detAuto ? ' (auto)' : ''}`,
  ]
  const st = a.status()
  if (st.length) lines.push(`Индикаторы на экране: ${st.join(', ')}`)
  s.markers.forEach((m, i) => {
    if (!m.on) return
    const r = a.readout(i)
    lines.push(r.delta ? `Маркер ${i + 1} (дельта): Δf ${fmtFreq(r.dx)}, ΔL ${r.dl.toFixed(1)} дБ` : `Маркер ${i + 1}: ${fmtFreq(r.x)}, ${r.level.toFixed(1)} дБм${r.count ? `, счётчик ${fmtFreq(r.count)}` : ''}`)
  })
  if (s.meas) {
    const m = a.measure()
    lines.push(`Измерение MEAS: ${s.meas.toUpperCase()}${m ? ' ' + JSON.stringify(m, (k, v) => typeof v === 'number' ? +v.toPrecision(5) : v) : ' (нет данных)'}`)
  }
  if (s.dl1 != null || s.dl2 != null || s.limit != null) lines.push(`Линии: ${[s.dl1 != null && `D1 ${s.dl1} дБм`, s.dl2 != null && `D2 ${s.dl2} дБм`, s.limit != null && `Limit ${s.limit} дБм`].filter(Boolean).join(', ')}`)
  return lines.join('\n')
}

function pageContext() {
  const parts = []
  const lesson = document.querySelector('.lesson')
  if (lesson) parts.push(`Студент читает урок «${lesson.querySelector('h1')?.textContent}»:\n${lesson.innerText.slice(0, 7000)}`)
  const tp = document.querySelector('.task-panel .tp-info')
  if (tp) {
    parts.push(`Студент выполняет задание «${tp.querySelector('h2')?.textContent}».\n${tp.querySelector('.cond')?.textContent || ''}\n${[...tp.querySelectorAll('p')].map((p) => p.textContent).join('\n')}`)
    const checks = document.querySelector('.task-panel .checks')
    if (checks?.innerText.trim()) parts.push(`Последняя проверка:\n${checks.innerText}`)
  }
  if (!tp && document.getElementById('src')) parts.push(`Студент в свободном тренажёре. Сигнал на входе: ${document.getElementById('src').selectedOptions[0]?.textContent}`)
  if (document.querySelector('.fsl') && window.__fsl) parts.push(`Настройки виртуального FSL18:\n${analyzerSummary(window.__fsl)}`)
  if (!parts.length) parts.push(`Страница: ${document.querySelector('h1')?.textContent || location.hash}`)
  return parts.join('\n\n')
}

function fillAnswer(el, text) {
  el.innerHTML = renderMarkdown(text)
  annotate(el)
}

// ---------- наставник ----------
const chat = { open: false, history: [], busy: false }

export function initTutor() {
  const btn = document.createElement('button')
  btn.className = 'ai-fab'
  btn.innerHTML = '<span aria-hidden="true">✦</span> ИИ-наставник'
  const box = document.createElement('section')
  box.className = 'ai-chat card'
  box.hidden = true
  box.setAttribute('aria-label', 'ИИ-наставник')
  box.innerHTML = `
    <header><b>✦ ИИ-наставник</b><span class="muted small">видит текущий урок, задание и настройки прибора</span><button class="ai-x" title="Закрыть">✕</button></header>
    <div class="ai-log"></div>
    <div class="ai-chips"></div>
    <form class="ai-form"><textarea rows="2" placeholder="Спросите про урок, задание или настройку прибора…" maxlength="2000"></textarea><button class="btn" type="submit">Спросить</button></form>`
  document.body.append(btn, box)
  const log = box.querySelector('.ai-log')
  const ta = box.querySelector('textarea')
  const chips = box.querySelector('.ai-chips')
  const sendBtn = box.querySelector('.ai-form button')

  const suggestions = () => document.querySelector('.task-panel') ? ['С чего начать это задание?', 'Почему на экране не видно сигнала?', 'Правильно ли настроен прибор?']
    : document.querySelector('.lesson') ? ['Объясни этот урок проще', 'Приведи пример на приборе', 'Какие тут частые ошибки?']
    : document.querySelector('.fsl') ? ['Что сейчас показывает экран?', 'Как измерить этот сигнал точнее?', 'Почему горит индикатор?']
    : ['Чем RBW отличается от VBW?', 'Как найти слабый сигнал?', 'Что такое DANL?']
  const renderChips = () => { chips.innerHTML = chat.history.length ? '' : suggestions().map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('') }
  const toggle = (on = !chat.open) => {
    chat.open = on
    box.hidden = !on
    btn.hidden = on
    if (on) { renderChips(); ta.focus() }
  }
  btn.addEventListener('click', () => toggle(true))
  box.querySelector('.ai-x').addEventListener('click', () => toggle(false))
  chips.addEventListener('click', (ev) => { if (ev.target.classList.contains('chip')) send(ev.target.textContent) })
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); box.querySelector('form').requestSubmit() } })
  box.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); send(ta.value) })
  chat.sync = () => {
    const inExam = !!document.querySelector('.exam-bar')
    if (inExam && chat.open) toggle(false)
    btn.hidden = chat.open || inExam
    if (chat.open) renderChips()
  }

  async function send(q) {
    q = q.trim()
    if (!q || chat.busy) return
    chat.busy = true
    sendBtn.disabled = true
    ta.value = ''
    chips.innerHTML = ''
    log.insertAdjacentHTML('beforeend', `<div class="ai-msg user">${esc(q)}</div>`)
    const out = document.createElement('div')
    out.className = 'ai-msg bot'
    out.innerHTML = '<span class="ai-dots">Думаю…</span>'
    log.append(out)
    log.scrollTop = log.scrollHeight
    const history = chat.history.slice()
    chat.history.push({ role: 'user', text: q })
    try {
      const text = await askAI({ mode: 'tutor', question: q, context: pageContext(), history }, (t) => { fillAnswer(out, t); log.scrollTop = log.scrollHeight })
      chat.history.push({ role: 'assistant', text })
    } catch (e) {
      chat.history.pop()
      out.classList.add('err')
      out.textContent = e.message
    }
    chat.busy = false
    sendBtn.disabled = false
  }
}

// Вызывается после каждой отрисовки страницы: во время экзамена наставник скрыт.
export function tutorSync() { chat.sync?.() }

// Кнопка под ответом: запускает запрос и показывает ответ в блоке рядом.
function aiButton(label, makePayload) {
  const wrap = document.createElement('div')
  wrap.className = 'ai-inline'
  wrap.innerHTML = `<button type="button" class="btn ghost small ai-btn">✦ ${esc(label)}</button><div class="ai-answer" hidden></div>`
  const b = wrap.querySelector('button')
  const out = wrap.querySelector('.ai-answer')
  b.addEventListener('click', async () => {
    b.disabled = true
    out.hidden = false
    out.classList.remove('err')
    out.innerHTML = '<span class="ai-dots">Разбираю…</span>'
    try {
      await askAI(makePayload(), (t) => fillAnswer(out, t))
      b.remove()
    } catch (e) {
      out.classList.add('err')
      out.textContent = e.message
      b.disabled = false
    }
  })
  return wrap
}

// Разбор ошибок задания: вызывается после неудачной проверки.
export function taskReview(container, t, items, ans, analyzer, cond) {
  container.querySelector('.ai-inline')?.remove()
  container.append(aiButton('Разобрать ошибки с ИИ', () => ({
    mode: 'task',
    question: 'Разбери, что я сделал не так и как исправить.',
    context: [
      `Задание: ${t.title}`, cond, `Цель: ${t.goal}`,
      `Результаты проверки:\n${items.map((x) => `${x.ok ? '✓' : '✗'} ${x.text}`).join('\n')}`,
      `Ответы студента: ${t.fields.map((f) => `${f.label} = ${isFinite(ans[f.key]) ? ans[f.key] : 'не введено'}`).join('; ')}`,
      `Настройки прибора в момент проверки:\n${analyzerSummary(analyzer)}`,
    ].join('\n\n'),
  })))
}

// Подробное объяснение вопроса теста.
export function quizExplain(fieldset, q, chosen) {
  fieldset.append(aiButton('Объяснить подробнее', () => ({
    mode: 'quiz',
    question: 'Объясни подробнее.',
    context: [
      `Вопрос: ${q.q}`,
      `Варианты:\n${q.o.map((o, k) => `${k + 1}) ${o}`).join('\n')}`,
      `Выбран: ${chosen == null ? 'ничего' : `${chosen + 1}) ${q.o[chosen]}`}`,
      `Правильный: ${q.a + 1}) ${q.o[q.a]}`,
      `Пояснение из курса: ${q.e}`,
    ].join('\n'),
  })))
}
