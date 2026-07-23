/** 轻量 Markdown 渲染（经营报告专用，无外部依赖） */
export default function MarkdownReport({ text }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let numberedItems = []

  const flushList = () => {
    if (listItems.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-5 space-y-1 my-1">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(item)}</li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  const flushNumbered = () => {
    if (numberedItems.length) {
      elements.push(
        <ol key={`ol-${elements.length}`} className="list-decimal pl-5 space-y-2 my-2">
          {numberedItems.map((item, i) => (
            <li key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{renderInline(item)}</li>
          ))}
        </ol>
      )
      numberedItems = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trimEnd()

    if (trimmed.startsWith('### ')) {
      flushList()
      flushNumbered()
      elements.push(
        <h4 key={`h-${elements.length}`} className="font-semibold text-gray-800 mt-4 mb-2 first:mt-0 text-sm">
          {trimmed.slice(4)}
        </h4>
      )
      continue
    }

    if (/^\d+\.\s/.test(trimmed)) {
      flushList()
      numberedItems.push(trimmed.replace(/^\d+\.\s*/, ''))
      continue
    }

    if (trimmed.startsWith('- ')) {
      flushNumbered()
      listItems.push(trimmed.slice(2))
      continue
    }

    if (trimmed === '') {
      flushList()
      flushNumbered()
      continue
    }

    flushList()
    flushNumbered()
    elements.push(
      <p key={`p-${elements.length}`} className="text-sm text-gray-700 leading-relaxed my-1 whitespace-pre-wrap">
        {renderInline(trimmed)}
      </p>
    )
  }

  flushList()
  flushNumbered()

  return <div className="space-y-0.5">{elements}</div>
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-800">{part.slice(2, -2)}</strong>
    }
    return part
  })
}
