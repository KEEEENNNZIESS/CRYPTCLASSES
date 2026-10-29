'use strict';

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isBlank = value => value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isPlainObject(value) && Object.keys(value).length === 0);

/** Validate participant input against the public shape of a question before saving it. */
function validateAnswer(type, options, answer) {
  if (isBlank(answer)) return { valid: true, value: answer };
  const fail = message => ({ valid: false, message });
  const opts = options || {};

  if (type === 'single') {
    const validIds = new Set((Array.isArray(opts) ? opts : []).map(o => String(o.id)));
    return typeof answer === 'string' && validIds.has(answer)
      ? { valid: true, value: answer }
      : fail('Pilihan jawaban tidak valid.');
  }
  if (type === 'multi') {
    if (!Array.isArray(answer)) return fail('Jawaban pilihan jamak harus berupa daftar pilihan.');
    const validIds = new Set((Array.isArray(opts) ? opts : []).map(o => String(o.id)));
    const values = answer.map(String);
    if (values.length > 5 || values.some(id => !validIds.has(id)) || new Set(values).size !== values.length) {
      return fail('Daftar pilihan jamak tidak valid.');
    }
    return { valid: true, value: values };
  }
  if (type === 'truefalse') {
    return typeof answer === 'boolean' ? { valid: true, value: answer }
      : fail('Jawaban Benar/Salah tidak valid.');
  }
  if (type === 'matching') {
    if (!isPlainObject(answer)) return fail('Jawaban mencocokkan harus berupa pasangan item.');
    const left = new Set((opts.left || []).map(o => String(o.id)));
    const right = new Set((opts.right || []).map(o => String(o.id)));
    const entries = Object.entries(answer).map(([k, v]) => [String(k), String(v)]);
    const rightUsed = entries.map(([, v]) => v);
    if (entries.some(([k, v]) => !left.has(k) || !right.has(v)) || new Set(rightUsed).size !== rightUsed.length) {
      return fail('Pasangan jawaban tidak valid.');
    }
    return { valid: true, value: Object.fromEntries(entries) };
  }
if (type === 'ordering') {
    if (!Array.isArray(answer)) {
      return fail('Jawaban urutan harus berupa daftar elemen.');
    }

    // Mendukung format options lama (array) dan format baru ({ items: [...] })
    const items = Array.isArray(opts)
      ? opts
      : Array.isArray(opts.items)
        ? opts.items
        : [];

    const validIds = new Set(
      items.map(o => String(o?.id))
    );
    const values = answer.map(String);

    if (
      values.length > validIds.size ||
      values.some(id => !validIds.has(id)) ||
      new Set(values).size !== values.length
    ) {
      return fail('Daftar urutan tidak valid.');
    }

    return { valid: true, value: values };
  }

  return fail('Jenis soal tidak dikenal.');
}

module.exports = { validateAnswer };
