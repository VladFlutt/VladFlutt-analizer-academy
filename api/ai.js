// ИИ-наставник: серверная функция Vercel. Принимает вопрос и учебный контекст
// со страницы, отвечает потоком текста. Ключ API берётся из ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-opus-5-5'
const LIMITS = { question: 2000, context: 12000, history: 10, historyItem: 4000 }

const BASE = `Ты — ИИ-наставник учебной платформы «Анализатор Academy» по анализатору спектра Rohde & Schwarz FSL18 (9 кГц – 18 ГГц).
Студенты изучают теорию, проходят тесты и выполняют задания на виртуальной передней панели прибора.
Отвечай по-русски, коротко и по делу: обычно 3–8 предложений или короткий список. Используй названия клавиш и меню прибора так, как они подписаны на панели (FREQ, SPAN, AMPT, BW, TRACE, MKR, MKR→, MEAS, SETUP, PRESET и т. п.).
Формат: простой Markdown (абзацы, списки, **жирный**). Без заголовков и таблиц.
Тренажёр — упрощённая модель; если вопрос выходит за её пределы, скажи, как это устроено на реальном приборе.
Если вопрос не касается анализа спектра, радиоизмерений или курса, вежливо верни разговор к учёбе.`

const MODES = {
  tutor: `${BASE}
Ниже дан контекст страницы, на которой находится студент (урок, задание или состояние тренажёра). Опирайся на него.
Если студент выполняет задание, не называй готовые числа ответа: объясняй, как их получить на приборе.`,
  task: `${BASE}
Студент выполнил проверку практического задания, и часть пунктов не прошла. Тебе даны условие, цель, результаты проверки, введённые ответы и текущие настройки прибора.
Разбери ошибки: для каждого непройденного пункта назови вероятную причину, опираясь на настройки прибора, и конкретные действия на панели, чтобы исправить.
Не называй правильные числовые ответы — студент должен измерить их сам.`,
  quiz: `${BASE}
Студент ответил на вопрос теста. Тебе даны вопрос, варианты, выбранный и правильный ответы и краткое пояснение из курса.
Объясни, почему правильный ответ верен и в чём ошибка выбранного варианта (если он неверен). Приведи физический смысл или пример с прибором.`,
}

const cut = (s, n) => String(s ?? '').slice(0, n)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method === 'GET') return res.status(200).json({ ok: true, configured: !!process.env.ANTHROPIC_API_KEY })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ИИ-наставник не настроен: на сервере не задан ключ API.' })

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {}
  const mode = MODES[body.mode] ? body.mode : 'tutor'
  const question = cut(body.question, LIMITS.question).trim()
  const context = cut(body.context, LIMITS.context).trim()
  if (!question && !context) return res.status(400).json({ error: 'Пустой запрос' })

  const messages = []
  const history = Array.isArray(body.history) ? body.history.slice(-LIMITS.history) : []
  for (const h of history) {
    if ((h?.role === 'user' || h?.role === 'assistant') && h.text) messages.push({ role: h.role, content: cut(h.text, LIMITS.historyItem) })
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()
  const turn = [context && `<контекст>\n${context}\n</контекст>`, question].filter(Boolean).join('\n\n')
  if (messages.length && messages[messages.length - 1].role === 'user') messages.pop()
  messages.push({ role: 'user', content: turn })

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  try {
    const client = new Anthropic()
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: MODES[mode],
      messages,
    })
    stream.on('text', (t) => res.write(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') res.write('\n\nНа этот вопрос я ответить не могу. Попробуйте переформулировать его.')
    else if (final.stop_reason === 'max_tokens') res.write('…')
    res.end()
  } catch (err) {
    console.error('ai error', err?.status, err?.message)
    const msg = err instanceof Anthropic.RateLimitError ? 'Наставник сейчас перегружен, попробуйте через минуту.'
      : err instanceof Anthropic.APIError ? 'Наставник временно недоступен.'
      : 'Не удалось получить ответ.'
    if (!res.headersSent) return res.status(502).json({ error: msg })
    res.end(`\n\n${msg}`)
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return {} } }
