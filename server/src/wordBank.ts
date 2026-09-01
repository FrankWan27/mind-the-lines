/**
 * A bank of common, easily-drawable single nouns used for prompts and decoys.
 * Kept intentionally concrete (things with a recognizable silhouette).
 */
export const WORD_BANK: readonly string[] = [
  // animals
  'cat', 'dog', 'fish', 'bird', 'snake', 'frog', 'bee', 'spider', 'turtle', 'rabbit',
  'horse', 'cow', 'pig', 'sheep', 'duck', 'owl', 'fox', 'bear', 'whale', 'shark',
  'octopus', 'crab', 'butterfly', 'snail', 'ant', 'elephant', 'giraffe', 'penguin', 'dolphin', 'mouse',
  // food
  'apple', 'banana', 'cherry', 'grapes', 'carrot', 'pizza', 'burger', 'donut', 'cake', 'egg',
  'bread', 'cheese', 'icecream', 'lollipop', 'cookie', 'pretzel', 'mushroom', 'corn', 'pepper', 'strawberry',
  // vehicles
  'car', 'truck', 'bus', 'bike', 'boat', 'ship', 'plane', 'rocket', 'train', 'tractor',
  'helicopter', 'scooter', 'sailboat', 'submarine', 'wagon',
  // objects / household
  'house', 'door', 'window', 'chair', 'table', 'lamp', 'clock', 'key', 'book', 'pencil',
  'scissors', 'hammer', 'ladder', 'umbrella', 'bucket', 'broom', 'candle', 'bottle', 'cup', 'spoon',
  'fork', 'knife', 'plate', 'kettle', 'mirror', 'comb', 'toothbrush', 'glasses', 'watch', 'ring',
  // nature / outdoors
  'tree', 'flower', 'leaf', 'cactus', 'sun', 'moon', 'star', 'cloud', 'rainbow', 'mountain',
  'volcano', 'island', 'river', 'wave', 'snowman', 'fire', 'lightning', 'anchor', 'shell', 'feather',
  // misc icons
  'heart', 'crown', 'balloon', 'kite', 'guitar', 'drum', 'trumpet', 'bell', 'flag', 'tent',
  'sword', 'shield', 'arrow', 'bomb', 'ghost', 'robot', 'crown2', 'diamond', 'wrench', 'magnet',
];

// De-duplicate defensively (a couple of themed near-dupes above kept distinct on purpose).
const UNIQUE_WORDS: string[] = Array.from(new Set(WORD_BANK));

/**
 * Return `count` distinct random words from the bank, excluding any in `exclude`.
 * Throws if the bank cannot satisfy the request.
 */
export function drawWords(count: number, exclude: Iterable<string> = []): string[] {
  const excludeSet = new Set(exclude);
  const pool = UNIQUE_WORDS.filter((w) => !excludeSet.has(w));
  if (count > pool.length) {
    throw new Error(`drawWords: requested ${count} words but only ${pool.length} available`);
  }
  // Fisher-Yates partial shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
