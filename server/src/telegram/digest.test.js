import assert from 'node:assert/strict';
import test from 'node:test';
import { digestPeriod, formatDigestMessage } from './digest.js';

test('сводка делит общий блок и сектор и экранирует HTML', () => {
  const text = formatDigestMessage({
    ok: true,
    empty: false,
    date: '27.10.2026',
    general: { text: 'Нагрузка A<B&', fresh: 4, work: 1 },
    spp: { name: 'СПП', text: 'Только доступ', fresh: 2, work: 0 },
  });
  assert.match(text, /СВОДКА ЗА 27\.10\.2026/);
  assert.match(text, /ОБЩИЙ \(Все сектора УИТ\)/);
  assert.match(text, /A&lt;B&amp;/);
  assert.match(text, /Новых заявок: 4/);
  assert.match(text, /СПП \(только сектор СПП\)/);
  assert.match(text, /Новых заявок: 2/);
  assert.ok(text.length <= 4000);
});

test('пустой период и сбой модели', () => {
  assert.equal(formatDigestMessage({ ok: true, empty: true }), 'За выбранный период заявок не найдено');
  assert.match(formatDigestMessage({ ok: false }), /Не удалось получить сводку/);
  assert.match(formatDigestMessage({
    ok: true,
    date: '26.10.2026',
    fallback: true,
    general: { text: 'по правилам', fresh: 1, work: 0 },
    spp: { name: 'СПП', text: 'сектор', fresh: 1, work: 0 },
  }), /разбор по правилам/);
  assert.equal(digestPeriod('digest:today'), 'today');
  assert.equal(digestPeriod('digest:yesterday'), 'yesterday');
  assert.equal(digestPeriod('barcode:balance'), '');
});
