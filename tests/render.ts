// A rough text drawing of a mounted pane for tests: column boxes stack, row boxes join, paddingLeft indents,
// marginBottom adds a blank line. Wrapping is not drawn.
type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }

function inline(n: Node | string): string {
  if (typeof n === 'string') return n
  if (!n.children?.length && typeof n.props?.label === 'string') return n.props.label
  return (n.children ?? []).map(inline).join('')
}

export function draw(n: Node | string): string[] {
  if (typeof n === 'string') return [n]
  const p = n.props ?? {}
  let out: string[]
  if (n.type === 'Box' && p.flexDirection === 'column') out = (n.children ?? []).flatMap(draw)
  else if (n.type === 'Box') {
    const kids = n.children ?? []
    const anyCol = kids.some(k => typeof k !== 'string' && k.type === 'Box' && k.props?.flexDirection === 'column')
    out = anyCol ? kids.flatMap(draw) : [kids.map(inline).join('')]
  } else out = [inline(n)]
  const pad = typeof p.paddingLeft === 'number' ? ' '.repeat(p.paddingLeft) : ''
  out = out.map(l => pad + l)
  if (typeof p.marginBottom === 'number' && p.marginBottom > 0) out.push('')
  return out
}
