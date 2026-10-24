import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAlert, formatBalance, lowFingerprint, lowRows, planAlerts } from './barcodeApp.js';

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

test('сообщение делит базы и не ломает HTML', () => {
  const text = formatBalance(snap, 5000);
  assert.match(text, /Остаток штрихкодов/);
  assert.match(text, /База БВД/);
  assert.match(text, /База БМК/);
  assert.match(text, /🔴 Номинал 1: <b>4 000<\/b>/);
  assert.match(text, /🟢 Номинал 1: 5 000/);
  const alert = formatAlert(snap, 5000);
  assert.match(alert, /НИЗКИЙ ОСТАТОК ШТРИХКОДОВ/);
  assert.match(alert, /Требуется пополнение/);
  assert.equal(formatAlert({ bases: [{ id: 'bvd', title: 'A<B&', items: [] }] }, 5000).includes('A&lt;B&amp;'), true);
});

test('тревога по базе один раз, пока остаток ниже порога', () => {
  const first = planAlerts(snap.bases, 5000, {});
  assert.deepEqual(first.entered, ['bvd']);
  assert.equal(first.proposed.bvd.status, 'alarm');
  assert.equal(first.proposed.bmk.status, 'ok');
  assert.equal(first.committed.bvd.status, 'ok');

  const again = planAlerts(
    [
      { id: 'bvd', title: 'БВД', items: [{ nominal: 1, free: 1000 }] },
      { id: 'bmk', title: 'БМК', items: [{ nominal: 1, free: 5000 }] },
    ],
    5000,
    first.proposed,
  );
  assert.deepEqual(again.entered, []);
  assert.equal(again.proposed.bvd.status, 'alarm');

  const bmkFalls = planAlerts(
    [
      { id: 'bvd', title: 'БВД', items: [{ nominal: 1, free: 1000 }] },
      { id: 'bmk', title: 'БМК', items: [{ nominal: 1, free: 100 }] },
    ],
    5000,
    again.proposed,
  );
  assert.deepEqual(bmkFalls.entered, ['bmk']);

  const recovered = planAlerts(snap.bases.map((base) => ({
    ...base,
    items: base.items.map((item) => ({ ...item, free: 9000 })),
  })), 5000, bmkFalls.proposed);
  assert.deepEqual(recovered.entered, []);
  assert.equal(recovered.proposed.bvd.status, 'ok');
  assert.equal(recovered.proposed.bmk.status, 'ok');
});
