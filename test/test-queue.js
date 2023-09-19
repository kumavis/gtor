import test from 'ava';
import { makeQueue } from '../src/index.js';

test('queue multiple writes', async t => {
  const q = makeQueue();
  q.put(1);
  q.put(2);
  const p1 = q.get();
  q.put(3);
  const v1 = await p1;
  t.is(v1, 1);
});

// test('queue multiple readers', async t => {
//   const q = queue();
//   const p1 = q.get();
//   const p2 = q.get();
//   q.put(1);
//   const [v1, v2] = await Promise.all([p1, p2])
//   t.is(v1, 1);
//   t.is(v2, 1);
// });