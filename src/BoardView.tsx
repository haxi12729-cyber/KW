import { pieceName, posKey, toSquare, type Board, type Pos } from './game'

const point = (row: number, col: number) => ({ x: 50 + col * 100, y: 50 + row * 100 })
const marks = [[2, 1], [2, 7], [7, 1], [7, 7], ...[3, 6].flatMap(row => [0, 2, 4, 6, 8].map(col => [row, col]))]

export default function BoardView({ board, selected = null, targets = [], onCell, disabled = false }: {
  board: Board; selected?: Pos | null; targets?: Pos[]; onCell?: (p: Pos) => void; disabled?: boolean
}) {
  const targetKeys = new Set(targets.map(posKey))
  return <div className="board" role="group" aria-label={onCell ? '中国象棋棋盘' : '中国象棋开局示意'}>
    <svg className="board-lines" viewBox="0 0 900 1000" aria-hidden="true">
      <rect className="river-fill" x="50" y="450" width="800" height="100" />
      <g className="grid-lines">
        {Array.from({ length: 10 }, (_, row) => <line key={'h' + row} x1="50" x2="850" y1={point(row, 0).y} y2={point(row, 0).y} />)}
        {[0, 8].map(col => <line key={col} x1={point(0, col).x} x2={point(0, col).x} y1="50" y2="950" />)}
        {Array.from({ length: 7 }, (_, i) => i + 1).map(col => <path key={'v' + col} d={`M ${point(0, col).x} 50 V 450 M ${point(0, col).x} 550 V 950`} />)}
        <path d="M350 50L550 250M550 50L350 250M350 750L550 950M550 750L350 950" />
      </g>
      <g className="river-boundaries"><path d="M50 450H850M50 550H850" /></g>
      <g className="position-marks">{marks.flatMap(([row, col]) => [-1, 1].flatMap(dx => [-1, 1].map(dy => {
        if ((col === 0 && dx === -1) || (col === 8 && dx === 1)) return null
        const { x, y } = point(row, col)
        return <path key={`${row}-${col}-${dx}-${dy}`} d={`M${x + dx * 26} ${y + dy * 10}H${x + dx * 10}V${y + dy * 26}`} />
      })))}</g>
      <g className="river-text"><text x="250" y="501">楚 河</text><text x="650" y="501">漢 界</text></g>
    </svg>
    {board.flatMap((row, r) => row.map((piece, c) => {
      const p = { row: r, col: c }; const { x, y } = point(r, c)
      const active = selected && posKey(selected) === posKey(p)
      const target = targetKeys.has(posKey(p))
      const content = piece ? <span className={`piece ${piece.color}`}>{pieceName(piece)}</span> : target ? <span className="target-dot" /> : null
      const style = { left: x / 9 + '%', top: y / 10 + '%' }
      return onCell ? <button key={posKey(p)} type="button" data-row={r} data-col={c}
        className={`intersection ${active ? 'selected' : ''} ${target && piece ? 'capture-target' : ''}`}
        style={style} disabled={disabled} aria-pressed={Boolean(active)}
        aria-label={toSquare(p) + (piece ? pieceName(piece) : '空位')} onClick={() => onCell(p)}>{content}</button>
        : piece ? <span key={posKey(p)} className="intersection" style={style} aria-hidden="true">{content}</span> : null
    }))}
  </div>
}
