export type EnginePiece = { type: string; color: 'r' | 'b' }
export type EngineMove = { from: string; to: string }
export class Xiangqi {
  constructor(fen?: string)
  load(fen: string): boolean
  fen(): string
  board(): (EnginePiece | null)[][]
  moves(options: { square?: string; verbose: true }): EngineMove[]
  move(move: EngineMove): EngineMove | null
  in_check(): boolean
}
