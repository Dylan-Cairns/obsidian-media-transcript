import { describe, it, expect } from 'vitest';
import { parseTimeFragment, timeFragment } from '../src/utils/timeFragment';

describe('parseTimeFragment', () => {
  it('reads plain and fractional seconds', () => {
    expect(parseTimeFragment('#t=83')).toBe(83);
    expect(parseTimeFragment('#t=83.5')).toBe(83.5);
  });

  it('reads clock forms', () => {
    expect(parseTimeFragment('#t=1:23')).toBe(83);
    expect(parseTimeFragment('#t=1:02:03')).toBe(3723);
  });

  it('takes the start of a range and tolerates npt: and other params', () => {
    expect(parseTimeFragment('#t=10,20')).toBe(10);
    expect(parseTimeFragment('#t=npt:10')).toBe(10);
    expect(parseTimeFragment('#foo=1&t=7')).toBe(7);
  });

  it('returns null when there is no usable time', () => {
    expect(parseTimeFragment('')).toBeNull();
    expect(parseTimeFragment(undefined)).toBeNull();
    expect(parseTimeFragment('#Heading')).toBeNull();
    expect(parseTimeFragment('#t=')).toBeNull();
    expect(parseTimeFragment('#t=1::2')).toBeNull();
  });
});

describe('timeFragment', () => {
  it('writes whole seconds that round-trip', () => {
    expect(timeFragment(83.9)).toBe('#t=83');
    expect(parseTimeFragment(timeFragment(3723))).toBe(3723);
  });
});
