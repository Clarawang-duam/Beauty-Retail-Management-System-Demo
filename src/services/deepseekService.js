const BUSINESS_REPORT_SYSTEM_PROMPT = `你是一位资深的美妆门店经营分析师，擅长从数据中快速发现洞察，并用简洁清晰的语言向门店老板汇报。

## 任务
根据以下提供的门店经营数据，生成一份专业的「周报/月报」，帮助老板在 3 分钟内掌握经营状况并做出决策。

## 输出格式要求
请严格按照以下 Markdown 结构输出，不要增删章节：

### 📊 核心结论
（用 2-3 句话总结本期最重要的发现，放在最前面，让老板一眼看完。格式：总体评价 + 最突出的 1-2 个亮点/问题。）

### 📈 经营概况
- 总销售额：¥{total_sales}，环比 {sales_change}%
- 总订单数：{total_orders} 单，环比 {orders_change}%
- 客单价：¥{avg_order_value}，环比 {avg_order_change}%
- 退款率：{refund_rate}%

（如果某项环比变化超过 ±15%，在后面加一句简短解读，例如："客单价环比下降 20%，建议排查是否近期折扣活动过多。"）

### 🏆 本期亮点
（从以下数据中提取 2-3 个正向表现，用数据说话，不要只说"表现良好"：
- 热销商品/项目 Top 3
- 员工销售/服务排行 Top 3
- 其他值得肯定的表现）

### ⚠️ 需要关注的问题
【重要】必须基于「异常数据」给出具体问题和行动建议，格式为：

1. **问题描述**：（具体是什么问题）
   **建议行动**：（可执行的下一步动作，不要只说"请注意"）

2. **问题描述**：
   **建议行动**：

（如果没有任何异常，此章节写：「✅ 本期无异常，所有指标均在正常范围内。」）

### 📋 下一步建议
（基于本期数据，给出 1-2 条面向下一期的运营建议，例如：建议针对某类会员做召回、某款商品做促销清库存等。）

## 约束条件
1. **严禁编造数据**：只能使用我提供的数据进行归纳和解读，不要添加任何你猜测的数字。
2. **语言风格**：专业、简洁、直接，不要使用"值得注意的是""我们可以看到"等废话开头，直接说结论。
3. **长度控制**：总字数控制在 300-500 字之间，老板没时间看长篇大论。
4. **异常数据优先**：如果输入数据中包含异常（如库存负数、异常低折扣、非营业时间操作），必须在「需要关注的问题」章节中重点呈现，不得遗漏。
5. **行动建议必须具体**：每条行动建议必须包含具体的操作对象和动作，例如"核查员工'王芳'经手的 3 笔低折扣订单"，而不是"核查低折扣订单"。`

function buildBusinessReportUserPrompt(reportData) {
  return `## 输入数据
\`\`\`json
${JSON.stringify(reportData, null, 2)}
\`\`\`

## 开始生成`
}

export async function callDeepSeek({ apiKey, systemPrompt, userPrompt, maxTokens = 800, temperature = 0.5 }) {
  if (!apiKey) return null

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepSeek 请求失败 (${res.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('DeepSeek 返回为空')
  return text
}

export function buildFallbackBusinessReport(data) {
  const fmt = (n) => `¥${Number(n).toLocaleString('zh-CN')}`
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`)

  let issues = ''
  if (data.all_normal || !data.anomalies?.length) {
    issues = '✅ 本期无异常，所有指标均在正常范围内。'
  } else {
    issues = data.anomalies.map((a, i) => {
      let action = '请结合系统记录核查并跟进。'
      if (a.dimension === 'inventory' && data.negative_inventory?.length) {
        const names = data.negative_inventory.map((p) => `「${p.name}」`).join('、')
        action = `优先盘点并补货 ${names}，核对销售与入库登记时间。`
      }
      if (a.dimension === 'refund') {
        const parts = []
        if (data.top_refund_product?.name) parts.push(`商品「${data.top_refund_product.name}」`)
        if (data.top_refund_staff?.name) parts.push(`员工「${data.top_refund_staff.name}」`)
        if (parts.length) action = `核查 ${parts.join('、')} 相关退款单据及原因。`
      }
      return `${i + 1}. **问题描述**：${a.message}\n   **建议行动**：${action}`
    }).join('\n\n')
  }

  const highlights = []
  if (data.top_products?.length) {
    highlights.push(`热销商品：${data.top_products.map((p) => `${p.name}（${fmt(p.amount)}）`).join('、')}`)
  }
  if (data.top_projects?.length) {
    highlights.push(`热门项目：${data.top_projects.map((p) => `${p.name}（${p.sessions}次）`).join('、')}`)
  }
  if (data.top_staff?.length) {
    highlights.push(`销售领先：${data.top_staff.map((s) => `${s.name}（${fmt(s.amount)}）`).join('、')}`)
  }

  const overviewNotes = []
  if (Math.abs(data.sales_change) > 15) {
    overviewNotes.push(`销售额环比${sign(data.sales_change)}%，需关注波动原因。`)
  }
  if (Math.abs(data.avg_order_change) > 15) {
    overviewNotes.push(`客单价环比${sign(data.avg_order_change)}%，建议排查折扣与产品结构。`)
  }

  const summary = data.insufficient_data
    ? '本期数据尚少，以下为已有数据的简要汇总。'
    : data.all_normal
      ? `${data.period_type}经营整体平稳，核心指标在正常范围内。`
      : `${data.period_type}存在需关注的问题，请优先处理异常项。`

  return `### 📊 核心结论
${summary}${data.top_staff?.[0] ? ` 员工${data.top_staff[0].name}销售额领先（${fmt(data.top_staff[0].amount)}）。` : ''}

### 📈 经营概况
- 总销售额：${fmt(data.total_sales)}，${data.comparison_label} ${sign(data.sales_change)}%
- 总订单数：${data.total_orders} 单，${data.comparison_label} ${sign(data.orders_change)}%
- 客单价：${fmt(data.avg_order_value)}，${data.comparison_label} ${sign(data.avg_order_change)}%
- 退款率：${data.refund_rate}%
${overviewNotes.length ? '\n' + overviewNotes.join('\n') : ''}

### 🏆 本期亮点
${highlights.length ? highlights.map((h) => `- ${h}`).join('\n') : '- 本期暂无足够数据提炼亮点'}

### ⚠️ 需要关注的问题
${issues}

### 📋 下一步建议
- 持续跟踪销售额与客单价${data.comparison_label}变化，结合热销品项优化陈列与话术。
${data.negative_inventory?.length ? `- 尽快处理负数库存商品，避免影响销售与会员体验。` : ''}`
}

export async function generateBusinessReportMarkdown(reportData, apiKey) {
  if (!apiKey) return buildFallbackBusinessReport(reportData)
  try {
    const text = await callDeepSeek({
      apiKey,
      systemPrompt: BUSINESS_REPORT_SYSTEM_PROMPT,
      userPrompt: buildBusinessReportUserPrompt(reportData),
      maxTokens: 1000,
      temperature: 0.5,
    })
    return text || buildFallbackBusinessReport(reportData)
  } catch (err) {
    console.error('经营报告 AI 生成失败，使用模板', err)
    return buildFallbackBusinessReport(reportData)
  }
}

// —— 召回话术（保持原有导出） ——

const RECALL_SYSTEM_PROMPT = `你是一个资深美容顾问。请为以下会员生成一条"召回话术"，
要求：① 亲切自然，像真人美容师说话 ② 包含剩余次数信息 ③ 包含一个具体的到店理由（新品体验/换季护理/专属优惠）
④ 字数不超过80字 ⑤ 不要提"沉睡""流失"等负面词

输出仅话术正文，不要加引号或前缀说明。`

function buildRecallUserPrompt(ctx) {
  const lines = [
    '输入会员信息：',
    `- 姓名：${ctx.member_name}`,
    `- 距上次到店：${ctx.dormant_days}天`,
    `- 剩余项目次数：${ctx.remaining_text}`,
  ]
  if (ctx.skin_type) lines.push(`- 肤质：${ctx.skin_type}`)
  if (ctx.preference_text) lines.push(`- 历史消费：${ctx.preference_text}`)
  lines.push('', '输出：')
  return lines.join('\n')
}

export function buildFallbackScript(ctx) {
  const remain = ctx.remaining_text || '项目'
  return `${ctx.member_name}，好久不见啦～您名下的${remain}还没体验完呢，最近我们新到了适合这个季节的护理，搭配效果更好！有空来店里坐坐，我帮您约个时间～`
}

export async function generateRecallScript(ctx, apiKey) {
  if (!apiKey) return buildFallbackScript(ctx)
  try {
    const text = await callDeepSeek({
      apiKey,
      systemPrompt: RECALL_SYSTEM_PROMPT,
      userPrompt: buildRecallUserPrompt(ctx),
      maxTokens: 200,
      temperature: 0.7,
    })
    return text?.replace(/^["「]|["」]$/g, '') || buildFallbackScript(ctx)
  } catch {
    return buildFallbackScript(ctx)
  }
}

// —— 员工异常文案润色（可选） ——

const STAFF_ANOMALY_POLISH_PROMPT = `你是门店经营督导。请将输入的「员工异常告警」列表润色为更专业、简洁的中文说明。

要求：
1. 严禁编造或修改任何数字、姓名、时间
2. 保持原意与建议动作不变
3. 每条输出一行，顺序与输入一致
4. 仅输出 JSON 数组，元素为润色后的 message 字符串，不要其他内容`

export async function polishStaffAnomalyMessages(anomalies, apiKey) {
  if (!apiKey || !anomalies?.length) return anomalies

  const originals = anomalies.map((a) => a.message)
  try {
    const text = await callDeepSeek({
      apiKey,
      systemPrompt: STAFF_ANOMALY_POLISH_PROMPT,
      userPrompt: JSON.stringify(originals, null, 2),
      maxTokens: 1200,
      temperature: 0.3,
    })
    if (!text) return anomalies

    const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, '').trim())
    if (!Array.isArray(parsed) || parsed.length !== anomalies.length) return anomalies

    return anomalies.map((a, i) => ({
      ...a,
      message: String(parsed[i] || a.message),
    }))
  } catch (err) {
    console.error('员工异常 AI 润色失败，使用规则模板', err)
    return anomalies
  }
}
