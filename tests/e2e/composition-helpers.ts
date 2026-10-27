import { expect, type Locator, type Page } from '@playwright/test'

// fill() uses the browser's insertText command, which can commit an IME session.
// Send an intermediate IME input without implicitly ending that session. The
// native setter bypasses React's value tracker so its real onChange still runs.
export async function updateComposition(field: Locator, value: string) {
  await field.evaluate((element, text) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('Expected an editable form control')
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text)
    element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }))
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }))
  }, value)
  await expect(field).toHaveValue(value)
}

// Compare the old fill-based simulation on a disposable control outside the
// React root. No application fields or data are changed by this diagnostic.
export async function inspectFillComposition(page: Page) {
  const probe = await page.evaluateHandle(() => {
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Isolated composition diagnostic')
    input.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647'
    const events: { type: string; trusted: boolean; composing?: boolean }[] = []
    for (const type of ['focus', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) input.addEventListener(type, event => {
      events.push({ type: event.type, trusted: event.isTrusted, ...('isComposing' in event ? { composing: Boolean(event.isComposing) } : {}) })
      input.dataset.events = JSON.stringify(events)
    })
    document.body.append(input)
    return input
  })
  try {
    const control = probe.asElement()!
    await control.dispatchEvent('compositionstart', { data: '' })
    await control.fill('lin')
    console.info('IME_FILL_DIAGNOSTIC ' + JSON.stringify(await control.evaluate(input => JSON.parse(input.dataset.events ?? '[]'))))
  } finally { await probe.evaluate(input => input.remove()); await probe.dispose() }
}
