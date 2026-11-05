export function validateBoard(board) {
  for (const key of ['width', 'height', 'fps', 'duration']) {
    if (!Number.isFinite(board[key]) || board[key] <= 0) throw new Error(`Invalid ${key}`);
  }
  if (board.width !== 1080 || board.height !== 1920) throw new Error('This prototype uses a fixed 1080 x 1920 board');
  if (!Number.isInteger(board.fps) || board.fps > 60) throw new Error('FPS must be an integer from 1 to 60');
  if (board.duration > 300) throw new Error('Prototype duration limit is 300 seconds');
  if (!board.paper || !Array.isArray(board.items) || !board.items.length) throw new Error('Missing paper or items');
  const ids = new Set();
  for (const item of board.items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or missing id: ${item.id}`);
    ids.add(item.id);
    if (!Number.isFinite(item.at) || item.at < 0 || Math.round(item.at * board.fps) >= Math.round(board.duration * board.fps)) throw new Error(`Invalid time: ${item.id}`);
    if (item.kind === 'text') {
      if (typeof item.text !== 'string' || !item.text.trim()) throw new Error(`Missing text: ${item.id}`);
      for (const k of ['x','y','size']) if (!Number.isFinite(item[k])) throw new Error(`Invalid ${k}: ${item.id}`);
      if (item.size <= 0) throw new Error(`Invalid font size: ${item.id}`);
    } else if (item.kind === 'path') {
      if (typeof item.path !== 'string' || !item.path.trim() || !Number.isInteger(item.seed)) throw new Error(`Invalid path: ${item.id}`);
    } else throw new Error(`Unsupported item kind: ${item.kind}`);
  }
}

export function checkpoints(board) {
  const last = Math.round(board.duration * board.fps) - 1;
  const events = [...new Set([0, ...board.items.map(i => Math.round(i.at * board.fps))])].sort((a,b) => a-b);
  const holds = events.map((start,i) => ({start, middle: Math.floor((start + (events[i+1] ?? last + 1) - 1) / 2)}));
  return {events, holds, frames: [...new Set([last, ...events, ...events.filter(x => x > 0).map(x => x-1), ...holds.map(h=>h.middle)])].sort((a,b)=>a-b)};
}
