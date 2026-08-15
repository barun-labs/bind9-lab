import { parseQuery, toSearch } from './query';
test('defaults', () => { expect(parseQuery('')).toEqual({ page:1, size:50 }); });
test('round-trips', () => {
  const s = { type:'A' as const, status:'PENDING' as const, q:'ns', page:2, size:25, sort:'name:asc', recordId:'rec-3' };
  expect(parseQuery(toSearch(s))).toEqual(s);
});
test('omits defaults from search', () => { expect(toSearch({page:1,size:50})).toBe(''); });
