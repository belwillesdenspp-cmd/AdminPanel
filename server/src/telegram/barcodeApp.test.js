import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAlert, formatBalance, lowFingerprint, lowRows } from './barcodeApp.js';

const snap = {
  updatedAt: '2026-10-24T15:00:00.000Z',
  bases: [
    { id: 'bvd', title: 'БВД', items: [{ nominal: 1, free: 4000 }, { nominal: 2, free: 8000 }] },
    { id: 'bmk', title: 'БМК', items: [{ nominal: 1, free: 5000 }] },
  ],
};

test('ниже порога только free < threshold', () => {
  const rows = lowRows(snap.bases, 5000);
  assert.deepEqual(rows, [{ title: 'БВД', nominal: 1, free: 4000 }]);
  assert.equal(lowFingerprint(rows), 'БВД:1:4000');
  assert.equal(lowRows(snap.bases, 4000).length, 0);
});

test('текст остатка и предупреждение', () => {
  const text = formatBalance(snap, 5000);
  assert.match(text, /Текущий остаток штрихкодов/);
  assert.match(text, /БВД: 1 — 4000/);
  assert.match(text, /Порог: 5000/);
  assert.match(text, /Ниже порога/);
  const alert = formatAlert(snap, 5000, lowRows(snap.bases, 5000));
  assert.match(alert, /Низкий остаток штрихкодов/);
  assert.match(alert, /Требуется пополнение/);
});
