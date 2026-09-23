// Generate expanded RTDB rules: RuleDataSnapshot.val() cannot compare objects.
// Keep this source and database.rules.json in sync; node scripts/database-rules.mjs prints JSON.
const d = path => `data.child('${path}').val()`
const n = path => `newData.child('${path}').val()`
const exists = path => `data.child('${path}').exists()`
const eq = path => `${n(path)} === ${d(path)}`
const and = (...terms) => '(' + terms.join(' && ') + ')'
const or = (...terms) => '(' + terms.join(' || ') + ')'
const op = type => `${n('operation/type')} === '${type}'`
const red = `${d('redUid')} === auth.uid`
const black = `${d('blackUid')} === auth.uid`
const member = or(red, black)
const owner = `(!${exists('ownerUid')} ? ${red} : ${d('ownerUid')} === auth.uid)`
const ownerSeat = `(${exists('ownerSeat')} ? ${d('ownerSeat')} : 'red')`
const sameOwnership = and(
  `(${exists('ownerUid')} ? ${n('ownerUid')} === ${d('ownerUid')} : !newData.child('ownerUid').exists())`,
  `(${exists('ownerSeat')} ? ${n('ownerSeat')} === ${d('ownerSeat')} : !newData.child('ownerSeat').exists())`,
)
const playing = or(`${d('status')} === 'playing'`, `${d('status')} === 'check'`)
const expired = `now >= ${d('request/createdAt')} + 10000`
const noRequest = or(`!${exists('request')}`, expired)
const turnOwner = or(and(`${d('turn')} === 'red'`, red), and(`${d('turn')} === 'black'`, black))
const ownRequest = `${d('request/uid')} === auth.uid`
const noNewRequest = "!newData.child('request').exists()"
// Firebase may serialize an empty JavaScript array as an existing zero-child
// node. Treat both representations as an intentionally cleared collection.
const noNewHistory = or("!newData.child('history').exists()", "!newData.child('history').hasChildren()")
const noNewMoves = or("!newData.child('moves').exists()", "!newData.child('moves').hasChildren()")
const samePosition = and(eq('turn'), eq('status'), eq('reason'))
const undo = and(op('accept'), `${d('request/kind')} === 'undo'`)
const changesPosition = or(op('move'), op('restart'), undo)
const changesHistory = or(changesPosition, op('join'))
const response = and(exists('request'), `${d('request/version')} === ${d('version')}`, noNewRequest, `${n('resolution/id')} === ${d('request/id')}`)
const nextGame = `${n('gameId')} === (${exists('gameId')} ? ${d('gameId')} : 0) + 1`
const sameGame = eq('gameId')
const variantValid = or(`${n('variant')} === 'standard'`, `${n('variant')} === 'jieqi-mixed'`)
const sameVariant = `(!${exists('variant')} ? ${n('variant')} === 'standard' : ${eq('variant')})`
const openSeat = side => or(`!${exists(side + 'Uid')}`, and(`${d('presence/' + side + '/online')} === false`, `now - ${d('presence/' + side + '/lastSeen')} > 120000`))
const joinSeat = side => and(op('join'), `${n(side + 'Uid')} === auth.uid`, `!(${red})`, `!(${black})`,
  openSeat(side), `${n(side === 'red' ? 'blackUid' : 'redUid')} === ${d(side === 'red' ? 'blackUid' : 'redUid')}`,
  `${n('status')} === (${d('status')} === 'waiting' ? 'playing' : ${d('status')})`, eq('turn'), eq('reason'), noNewRequest,
  noNewHistory, nextGame)
const join = or(and(`${ownerSeat} === 'red'`, joinSeat('black')), and(`${ownerSeat} === 'black'`, joinSeat('red')))
const request = and(op('request'), playing, exists('blackUid'), noRequest, sameGame, samePosition,
  "newData.child('request').hasChildren(['id', 'kind', 'by', 'uid', 'version', 'createdAt'])",
  "newData.child('request/id').isString()", `${n('request/uid')} === auth.uid`,
  `${n('request/by')} === (${red} ? 'red' : 'black')`, `${n('request/version')} === ${n('version')}`,
  `${n('request/createdAt')} === now`,
  or(`${n('request/kind')} === 'draw'`, and(`${n('request/kind')} === 'undo'`, `!(${turnOwner})`, exists('history/0'))))
const accept = and(op('accept'), playing, response, `!(${ownRequest})`, `!(${expired})`, sameGame,
  `${n('resolution/outcome')} === 'accepted'`,
  or(and(`${d('request/kind')} === 'draw'`, `${n('status')} === 'draw'`, `${n('reason')} === 'agreement'`, eq('turn')),
    and(`${d('request/kind')} === 'undo'`, exists('history/0'), `${n('turn')} === ${d('request/by')}`,
      or(`${n('status')} === 'playing'`, `${n('status')} === 'check'`), "!newData.child('reason').exists()")))
const finishRequest = or(...[['reject', 'rejected', `!(${ownRequest})`, `!(${expired})`], ['cancel', 'cancelled', ownRequest, `!(${expired})`], ['expire', 'expired', 'true', expired]].map(([type, outcome, identity, time]) =>
  and(op(type), playing, response, identity, time, sameGame, samePosition, `${n('resolution/outcome')} === '${outcome}'`)))
const resign = and(op('resign'), playing, exists('blackUid'), sameGame, noNewRequest, eq('turn'), `${n('reason')} === 'resign'`, `${n('status')} === (${red} ? 'black-won' : 'red-won')`)
const move = and(op('move'), playing, exists('blackUid'), turnOwner, noRequest, noNewRequest, sameGame,
  `${n('turn')} === (${d('turn')} === 'red' ? 'black' : 'red')`, "!newData.child('reason').exists()",
  or(`${n('status')} === 'playing'`, `${n('status')} === 'check'`, `${n('status')} === (${red} ? 'red-won' : 'black-won')`))
const restart = and(op('restart'), owner, nextGame, noNewRequest, noNewHistory, noNewMoves, "!newData.child('reason').exists()", `${n('turn')} === 'red'`, `${n('status')} === (${exists('redUid')} && ${exists('blackUid')} ? 'playing' : 'waiting')`)
const create = and('!data.exists()', `${n('ownerUid')} === auth.uid`, or(`${n('ownerSeat')} === 'red'`, `${n('ownerSeat')} === 'black'`),
  or(and(`${n('ownerSeat')} === 'red'`, `${n('redUid')} === auth.uid`, "!newData.child('blackUid').exists()"), and(`${n('ownerSeat')} === 'black'`, `${n('blackUid')} === auth.uid`, "!newData.child('redUid').exists()")),
  variantValid, `${n('status')} === 'waiting'`, `${n('version')} === 0`, `${n('turn')} === 'red'`, noNewRequest, noNewHistory, "!newData.child('reason').exists()")
const update = and(eq('createdAt'), sameOwnership, sameVariant, `${n('version')} === ${d('version')} + 1`, `${n('operation/uid')} === auth.uid`,
  or(join, and(member, eq('redUid'), eq('blackUid'), or(request, accept, finishRequest, resign, move, restart))))
const room = {
  '.read': 'auth != null',
  '.write': and('auth != null', 'newData.exists()', or(create, update)),
  '.validate': "newData.hasChildren(['board', 'turn', 'version', 'status', 'presence']) && (newData.child('redUid').exists() || newData.child('blackUid').exists()) && (!data.exists() ? (newData.child('ownerUid').exists() && (newData.child('ownerSeat').val() === 'red' || newData.child('ownerSeat').val() === 'black')) : (!data.child('ownerUid').exists() ? (!newData.child('ownerUid').exists() && !newData.child('ownerSeat').exists()) : (newData.child('ownerUid').val() === data.child('ownerUid').val() && newData.child('ownerSeat').val() === data.child('ownerSeat').val()))) && newData.child('version').isNumber() && ((!data.child('variant').exists() && !newData.child('variant').exists()) || newData.child('variant').val() === 'standard' || newData.child('variant').val() === 'jieqi-mixed')",
}
// Deletion bypasses .validate. Check parent-level existence as well as leaf values.
const mutableAt = (depth, expression) => expression.replaceAll('newData.', 'newData' + '.parent()'.repeat(depth) + '.').replaceAll('data.', 'data' + '.parent()'.repeat(depth) + '.')
const allowed = (depth, expression) => or(`!data${'.parent()'.repeat(depth)}.exists()`, mutableAt(depth, expression))
room.board = { '.validate': or(allowed(1, changesPosition), and(...Array.from({ length: 10 }, (_, i) => `newData.child('${i}').exists() === data.child('${i}').exists()`))) }
const cellShape = and("newData.hasChildren(['kind', 'color'])",
  or(...['general', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'soldier'].map(kind => `newData.child('kind').val() === '${kind}'`)),
  or("newData.child('color').val() === 'red'", "newData.child('color').val() === 'black'"),
  or("!newData.child('cover').exists()", and("newData.child('cover').hasChildren(['kind', 'color'])",
    or(...['advisor', 'elephant', 'horse', 'rook', 'cannon', 'soldier'].map(kind => `newData.child('cover/kind').val() === '${kind}'`)),
    or("newData.child('cover/color').val() === 'red'", "newData.child('cover/color').val() === 'black'"))))
for (let row = 0; row < 10; row++) {
  room.board[row] = { '.validate': or(allowed(2, changesPosition), and(...Array.from({ length: 9 }, (_, col) => ['kind', 'color', 'cover/kind', 'cover/color'].map(field => eq(`${col}/${field}`))).flat())) }
  for (let col = 0; col < 9; col++) room.board[row][col] = {
    '.validate': and(or('!newData.exists()', cellShape), or(allowed(3, changesPosition), and(...['kind', 'color', 'cover/kind', 'cover/color'].map(eq)))),
  }
}
for (const [field, change] of [['moves', changesPosition], ['history', changesHistory]]) {
  // Parent validation runs for all operations, including deleting the whole collection.
  room['.validate'] += ` && (${or('!data.exists()', change, `newData.child('${field}').exists() === data.child('${field}').exists()`)})`
  room[field] = { '.validate': or(allowed(1, change), and(...Array.from({ length: 80 }, (_, i) => `newData.child('${i}').exists() === data.child('${i}').exists()`))) }
  room[field].$index = { '.validate': field === 'history'
    ? and('newData.isString()', or(allowed(2, change), 'newData.val() === data.val()'))
    : or(allowed(2, change), and(...['from/row', 'from/col', 'to/row', 'to/col', 'captured/kind', 'captured/color', 'captured/cover/kind', 'captured/cover/color', 'label'].map(eq))) }
}
room.presence = { '.validate': "newData.hasChildren(['red', 'black'])" }
for (const side of ['red', 'black']) room.presence[side] = {
  '.write': `auth != null && data.parent().parent().child('${side}Uid').val() === auth.uid && newData.exists()`,
  '.validate': and("newData.hasChildren(['online', 'lastSeen'])", "newData.child('online').isBoolean()", "newData.child('lastSeen').isNumber()",
    or('!data.parent().parent().exists()', `newData.parent().parent().child('${side}Uid').val() === auth.uid`, and(eq('online'), eq('lastSeen')))),
}
const rules = { rules: { rooms: { $roomId: room } } }
export default rules
console.log(JSON.stringify(rules, null, 2))
