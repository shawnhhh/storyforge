// A linear, bounded single-span comparison; unchanged interior islands may be
// included in the change span. Code points keep emoji/surrogate pairs intact.
export function compareText(before: string, after: string) {
  const left = Array.from(before), right = Array.from(after)
  let start = 0, suffix = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  while (suffix < left.length - start && suffix < right.length - start && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++
  return { prefix: left.slice(0, start).join(''), removed: left.slice(start, left.length - suffix).join(''), added: right.slice(start, right.length - suffix).join(''), suffix: suffix ? left.slice(-suffix).join('') : '', identical: before === after }
}
