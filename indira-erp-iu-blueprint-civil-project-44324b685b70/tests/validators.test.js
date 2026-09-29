import { describe, it, expect } from 'vitest';
import { isNonEmpty, isEmail, isTenDigitPhone, digitsOnly, validate } from '../src/lib/validators.js';

describe('isNonEmpty', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['x', true],
    [null, false],
    [undefined, false],
    [123, false],
  ])('%s -> %s', (v, expected) => expect(isNonEmpty(v)).toBe(expected));
});

describe('isEmail', () => {
  it.each([
    ['user@example.com', true],
    ['first.last+tag@sub.example.com', true],
    ['no-at-sign', false],
    ['missing@dot', false],
    ['@nodomain.com', false],
    ['spaces in@name.com', false],
    ['', false],
    [null, false],
  ])('%s -> %s', (v, expected) => expect(isEmail(v)).toBe(expected));
});

describe('isTenDigitPhone', () => {
  it.each([
    ['9812345678', true],
    ['1234567890', true],
    ['123456789', false],
    ['12345678901', false],
    ['981234567a', false],
    ['(981) 234-5678', false],
    ['', false],
  ])('%s -> %s', (v, expected) => expect(isTenDigitPhone(v)).toBe(expected));
});

describe('digitsOnly', () => {
  it('strips non-digits', () => {
    expect(digitsOnly('+91 98 (123) 45-678')).toBe('919812345678');
    expect(digitsOnly('abc')).toBe('');
    expect(digitsOnly('')).toBe('');
    expect(digitsOnly(undefined)).toBe('');
  });
});

describe('validate', () => {
  const rules = {
    email: [{ test: isEmail, message: 'Invalid email.' }],
    name: [{ test: isNonEmpty, message: 'Name required.' }],
    phone: [{ test: (v) => v === '' || isTenDigitPhone(v), message: '10 digits.' }],
  };

  it('returns empty when all valid', () => {
    expect(validate(rules, { email: 'a@b.co', name: 'x', phone: '9812345678' })).toEqual({});
  });

  it('returns per-field first failure', () => {
    expect(validate(rules, { email: 'bad', name: '', phone: '' })).toEqual({
      email: 'Invalid email.',
      name: 'Name required.',
    });
  });

  it('short-circuits on first rule failure per field', () => {
    const rules2 = { x: [
      { test: isNonEmpty, message: 'required' },
      { test: () => false, message: 'other' },
    ]};
    expect(validate(rules2, { x: '' })).toEqual({ x: 'required' });
  });
});
