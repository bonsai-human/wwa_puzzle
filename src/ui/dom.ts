/** DOM 組み立ての下請け。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** ラベル付きの数値入力。 */
export function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  options: { readonly min?: number; readonly max?: number } = {},
): HTMLElement {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label));

  const input = el('input', 'field-input');
  input.type = 'number';
  input.value = String(value);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);

  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(Math.round(parsed));
  });

  wrapper.append(input);
  return wrapper;
}

/** ラベル付きの文字入力。 */
export function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label));

  const input = el('input', 'field-input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));

  wrapper.append(input);
  return wrapper;
}
