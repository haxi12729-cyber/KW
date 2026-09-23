import { useEffect, useMemo, useRef, useState } from 'react'
import BoardView from './BoardView'
import ResultDialog from './ResultDialog'
import ActionDialog from './ActionDialog'
import { firebaseReady, createRoom, getPlayer, joinRoom, restartRoom, roleFor, setPresence, submitMove, subscribeRoom, submitAction, serverNow, type Room } from './firebase'
import { canMove, initialBoard, legalMoves, posKey, type Color, type GameStatus, type Move, type Pos } from './game'
import { actMatch, activeRequest, moveMatch, other, REQUEST_MS, type Match, type MatchAction } from './match'

type Mode = 'home' | 'local' | 'online'
type Snapshot = Match
const fresh = (): Snapshot => ({ board: initialBoard(), turn: 'red', status: 'playing', moves: [], history: [], version: 0, gameId: 0 })
const colorText = (color: Color) => color === 'red' ? '红方' : '黑方'
function savedRoom() { try { return firebaseReady ? sessionStorage.getItem('xiangqi-room') : null } catch { return null } }
const statusText = (status: GameStatus, turn: Color) => status === 'draw' ? '双方和棋' : status === 'waiting' ? '等待对手加入' : status === 'red-won' ? '红方胜' : status === 'black-won' ? '黑方胜' : status === 'check' ? '将军！' + colorText(turn) + '应将' : '轮到' + colorText(turn)

function MoveList({ moves }: { moves: Move[] }) {
  return <section className="move-section"><div className="section-heading"><h2>棋谱</h2><span>{moves.length} 手</span></div>
    <div className="move-scroll">{moves.length ? <table><thead><tr><th>回合</th><th>红方</th><th>黑方</th></tr></thead>
      <tbody>{Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => <tr key={i}><td>{i + 1}</td><td>{moves[i * 2].label}</td><td>{moves[i * 2 + 1]?.label || '—'}</td></tr>)}</tbody></table>
      : <div className="empty-moves"><span aria-hidden="true">弈</span><p>落下第一子，棋谱从这里开始。</p></div>}</div>
  </section>
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => savedRoom() ? 'online' : 'home')
  const [roomCode, setRoomCode] = useState('')
  const [activeCode, setActiveCode] = useState<string | null>(savedRoom)
  const [uid, setUid] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [local, setLocal] = useState<Snapshot>(fresh)
  const [clock, setClock] = useState(serverNow)
  const [resigning, setResigning] = useState<{ color: Color; gameId: number } | null>(null)
  const expiryAttempt = useRef({ id: '', at: 0 })
  const [selected, setSelected] = useState<Pos | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const busy = useRef(false)
  const preview = useMemo(initialBoard, [])

  async function perform(action: string, task: () => Promise<void>) {
    if (busy.current) return
    busy.current = true; setPending(action); setError(''); setNotice('')
    try { await task() } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。') }
    finally { busy.current = false; setPending('') }
  }
  useEffect(() => {
    try { if (activeCode) sessionStorage.setItem('xiangqi-room', activeCode); else sessionStorage.removeItem('xiangqi-room') } catch { /* Storage may be disabled. */ }
    if (activeCode && !uid) void getPlayer().then(player => setUid(player.uid)).catch(() => setError('恢复身份失败，请返回首页重试。'))
  }, [activeCode, uid])
  useEffect(() => {
    if (!activeCode || !uid) return
    return subscribeRoom(activeCode, setRoom, () => setError('房间连接失败，请稍后重新进入。'))
  }, [activeCode, uid])
  const playerColor = useMemo(() => room && uid ? roleFor(room, uid) : null, [room, uid])
  useEffect(() => {
    if (!activeCode || !playerColor) return
    void setPresence(activeCode, playerColor, true).catch(() => setError('在线状态更新失败，请检查网络。'))
    return () => { void setPresence(activeCode, playerColor, false).catch(() => {}) }
  }, [activeCode, playerColor])
  useEffect(() => { setSelected(null) }, [room?.version, mode])
  const snapshot: Snapshot = mode === 'online' ? room ? { ...room, moves: room.moves || [] } : { ...fresh(), status: 'waiting' } : local
  const request = activeRequest(snapshot, clock)
  const actor = mode === 'local' ? snapshot.turn : playerColor
  const actionable = canMove(snapshot.status) && (mode === 'local' || !!(room?.blackUid && playerColor))
  const playable = !pending && !request && !resigning && canMove(snapshot.status) && (mode === 'local' || Boolean(room && playerColor === snapshot.turn))
  useEffect(() => { const timer = window.setInterval(() => setClock(serverNow()), 200); return () => window.clearInterval(timer) }, [])
  useEffect(() => { setResigning(null) }, [snapshot.gameId, mode, activeCode])
  useEffect(() => { if (!canMove(snapshot.status)) setResigning(null) }, [snapshot.status])
  useEffect(() => {
    if (mode === 'home' || !snapshot.request || activeRequest(snapshot, clock) || !canMove(snapshot.status)) return
    const id = snapshot.request.id
    setNotice('对方未在 10 秒内同意，请求已拒绝')
    if (pending || busy.current || (expiryAttempt.current.id === id && clock - expiryAttempt.current.at < 2000)) return
    expiryAttempt.current = { id, at: clock }
    if (mode === 'local') setLocal(current => {
      try { return actMatch(current, current.turn, 'local', { type: 'expire', id }, serverNow()) } catch { return current }
    })
    else if (activeCode && uid) void submitAction(activeCode, uid, { type: 'expire', id }, snapshot.version).catch(() => {})
  }, [clock, mode, snapshot.request, snapshot.status, snapshot.version, activeCode, uid, pending])
  useEffect(() => {
    const outcome = snapshot.resolution?.outcome
    if (outcome) setNotice({ accepted: '对方已同意请求', rejected: '对方已拒绝请求', cancelled: '请求已取消', expired: '对方未在 10 秒内同意，请求已拒绝' }[outcome])
  }, [snapshot.resolution?.id, snapshot.resolution?.outcome])
  const targets = selected && playable ? legalMoves(snapshot.board, selected) : []
  const noticeBlock = <div className="feedback" aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : notice ? <p>{notice}</p> : null}</div>

  async function play(from: Pos, to: Pos) {
    if (!playable || busy.current) return
    setSelected(null)
    if (mode === 'online' && activeCode && uid && room) {
      await perform('move', async () => { await submitMove(activeCode, uid, from, to, room.version) })
    } else {
      try {
        setLocal(moveMatch(local, from, to, serverNow()))
        setError(''); setNotice('')
      } catch (e) { setError(e instanceof Error ? e.message : '走棋失败') }
    }
  }
  function onCell(p: Pos) {
    if (!playable) return
    if (selected && targets.some(t => posKey(t) === posKey(p))) { void play(selected, p); return }
    setSelected(snapshot.board[p.row][p.col]?.color === snapshot.turn ? p : null)
  }
  function newLocal() { setLocal(previous => ({ ...fresh(), gameId: (previous.gameId || 0) + 1 })); setResigning(null); setMode('local'); setActiveCode(null); setRoom(null); setSelected(null); setError(''); setNotice('') }
  function leave() { setActiveCode(null); setRoom(null); setMode('home'); setSelected(null); setError(''); setNotice('') }
  async function openRoom(join: boolean) {
    if (!firebaseReady) return
    if (join && !/^\d{6}$/.test(roomCode)) { setError('请输入 6 位数字房间号。'); return }
    await perform(join ? 'join' : 'create', async () => {
      const playerUid = uid ?? (await getPlayer()).uid
      setUid(playerUid)
      const code = join ? roomCode : await createRoom(playerUid)
      if (join) setRoom(await joinRoom(code, playerUid)); else setRoom(null)
      setActiveCode(code); setRoomCode(code); setMode('online')
    })
  }
  async function restart() {
    setSelected(null)
    if (mode === 'local') { newLocal(); return }
    if (activeCode && uid && playerColor === 'red') await perform('restart', async () => { await restartRoom(activeCode, uid) })
  }
  async function action(value: MatchAction, localActor: Color = snapshot.turn) {
    await perform(value.type, async () => {
      if (mode === 'online' && activeCode && uid) await submitAction(activeCode, uid, value, snapshot.version)
      else setLocal(actMatch(local, localActor, 'local-' + localActor, value, serverNow()))
      setSelected(null)
      if (value.type === 'resign') setResigning(null)
    })
  }
  function ask(kind: 'undo' | 'draw') {
    void action({ type: 'request', kind, id: crypto.randomUUID() }, kind === 'undo' ? other(snapshot.turn) : snapshot.turn)
  }
  const requesting = mode === 'online' && request?.by === playerColor
  function respond(type: 'accept' | 'reject' | 'cancel') {
    if (request) void action({ type, id: request.id }, type === 'cancel' ? request.by : other(request.by))
  }
  function confirmResign() { if (actor) { setError(''); setResigning({ color: actor, gameId: snapshot.gameId || 0 }) } }

  if (mode === 'home') return <main className="landing">
    <header className="site-header"><div className="brand"><span className="seal">弈</span>楚汉弈局</div><span className="header-note">中国象棋 · 与友对弈</span></header>
    <div className="landing-layout"><section className="intro-panel"><p className="eyebrow">一方棋盘，两位棋友</p><h1>隔河相望，<br />落子有声。</h1><p className="intro">从一盘棋开始。和身边的朋友切磋，<br className="desktop-break" />也为远方的好友留一席。</p>
      <div className="preview-board"><BoardView board={preview} /></div>
      <p className="preview-caption">楚河汉界 · 红先黑后</p>
    </section><section className="entry-panel panel"><p className="eyebrow">开始一局</p><h2>今天，和谁下棋？</h2>
      <div className="entry-option"><div className="option-heading"><span className="option-number">01</span><h3>同屏切磋</h3></div><p>共用一台设备，红黑双方轮流落子。</p><button className="button primary" disabled={!!pending} onClick={newLocal}>本地双人对弈 <span aria-hidden="true">↗</span></button></div>
      <div className="entry-option"><div className="option-heading"><span className="option-number">02</span><h3>邀请远方棋友</h3></div><p>创建房间，把 6 位房间号分享给朋友。</p><button className="button secondary" onClick={() => void openRoom(false)} disabled={!firebaseReady || !!pending}>{pending === 'create' ? '正在创建房间…' : '创建联网房间'}</button></div>
      <form className="join-form" onSubmit={e => { e.preventDefault(); void openRoom(true) }}><label htmlFor="room-code">已有房间号？</label><div className="join-row"><input id="room-code" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="输入 6 位房间号" value={roomCode} onChange={e => { setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} /><button className="button secondary" type="submit" disabled={!firebaseReady || !!pending}>{pending === 'join' ? '加入中…' : '加入对战'}</button></div></form>
      {!firebaseReady && <p className="availability"><span aria-hidden="true">○</span> 联网暂未开放，可先体验本地对弈。</p>}{noticeBlock}
    </section></div><footer>车行直路，马踏斜日。落子之前，多想一步。</footer>
  </main>

  return <main className="game-page"><header className="site-header"><button className="brand" onClick={leave} disabled={!!pending}><span className="seal">弈</span>楚汉弈局</button><span className="mode-badge">{mode === 'online' ? '好友房间 · ' + activeCode : '本地双人'}</span><button className="button quiet" onClick={leave} disabled={!!pending}>返回首页</button></header>
    {resigning && actionable && resigning.gameId === (snapshot.gameId || 0) && <ActionDialog title={colorText(resigning.color) + '认输'} pending={!!pending} onClose={() => setResigning(null)}>
      <p>确定认输吗？要不要再考虑一下？</p><p>确认前不会通知对方。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="result-actions"><button className="button secondary" autoFocus disabled={!!pending} onClick={() => setResigning(null)}>再考虑一下</button><button className="button primary" disabled={!!pending} onClick={() => void action({ type: 'resign', gameId: resigning.gameId }, resigning.color)}>{pending ? '正在提交…' : '不考虑，认输'}</button></div>
    </ActionDialog>}
    {request && !resigning && <ActionDialog key={request.id} title={colorText(request.by) + (request.kind === 'undo' ? '申请悔棋一步' : '申请和棋')} pending={!!pending} onClose={() => respond(requesting ? 'cancel' : 'reject')}>
      <p>{mode === 'local' ? '请交由' + colorText(other(request.by)) + '确认。' : requesting ? '等待对方回应。' : '是否同意对方的请求？'}</p>
      <p>剩余 {Math.min(10, Math.max(0, Math.ceil((request.createdAt + REQUEST_MS - clock) / 1000)))} 秒 · 超时默认不同意</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="result-actions">{requesting ? <button autoFocus className="button secondary" disabled={!!pending} onClick={() => respond('cancel')}>取消请求</button> : <><button autoFocus className="button secondary" disabled={!!pending} onClick={() => respond('reject')}>拒绝</button><button className="button primary" disabled={!!pending} onClick={() => respond('accept')}>同意</button></>}</div>
      <button className="button quiet" disabled={!!pending} onClick={confirmResign}>{actor ? colorText(actor) : ''}认输</button>
    </ActionDialog>}
    {(snapshot.status === 'red-won' || snapshot.status === 'black-won' || snapshot.status === 'draw') && <ResultDialog
      key={mode + ':' + activeCode + ':' + snapshot.status}
      winner={snapshot.status === 'draw' ? null : snapshot.status === 'red-won' ? 'red' : 'black'} reason={snapshot.reason} online={mode === 'online'} playerColor={playerColor}
      pending={!!pending} error={error} onRestart={() => void restart()} />}
    <div className="game-layout"><section className="board-section"><div className="player-strip"><span><i className="side-dot black" />黑方</span><span>{mode === 'online' ? room?.presence?.black?.online ? '在线' : room?.blackUid ? '离线 · 等待重连' : '等待入座' : '执黑后行'}</span></div>
      <div className="board-frame"><BoardView board={snapshot.board} selected={selected} targets={targets} onCell={onCell} disabled={!playable} /></div>
      <div className="player-strip"><span><i className="side-dot red" />红方</span><span>{mode === 'online' ? room?.presence?.red?.online ? '在线' : '离线 · 等待重连' : '执红先行'}</span></div>
      <p className="board-help">点击棋子，再点击落点；圆点表示可走位置。</p>
    </section><aside className="panel game-panel"><section className="turn-section" aria-live="polite"><p className="eyebrow">当前局面</p><h1 id="game-status" tabIndex={-1}><i className={'side-dot ' + (snapshot.status === 'red-won' ? 'red' : snapshot.status === 'black-won' ? 'black' : snapshot.turn)} />{pending === 'move' ? '正在提交走棋…' : statusText(snapshot.status, snapshot.turn)}</h1><p>{mode === 'online' ? playerColor ? '你执' + colorText(playerColor) + (playerColor === 'red' ? ' · 房主' : '') : '正在连接房间…' : '双人轮流操作，请落子。'}</p></section>
      {mode === 'online' && <div className="room-number"><div><span>邀请房间号</span><strong>{activeCode}</strong></div><button className="button secondary" onClick={() => void perform('copy', async () => { await navigator.clipboard.writeText(activeCode || ''); setNotice('房间号已复制。') })} disabled={!!pending}>复制</button></div>}
      <div className="controls"><button className="button secondary" disabled={!actionable || !!request || !!pending || !snapshot.history?.length || (mode === 'online' && playerColor !== other(snapshot.turn))} onClick={() => ask('undo')}>申请悔棋</button>
        <button className="button secondary" disabled={!actionable || !!request || !!pending} onClick={() => ask('draw')}>求和</button>
        <button className="button secondary" disabled={!actionable || !!pending} onClick={confirmResign}>{actor ? colorText(actor) : ''}认输</button>
        <button className="button secondary" onClick={() => void restart()} disabled={!!pending || (mode === 'online' && playerColor !== 'red')}>{pending === 'restart' ? '重新开始中…' : mode === 'online' ? '房主重开' : '重新开始'}</button></div>
      {noticeBlock}<MoveList moves={snapshot.moves} />
      <div className="panel-note">观棋不语，落子有度。<br />将死或无合法走法时，该方判负。</div>
    </aside></div>
  </main>
}
