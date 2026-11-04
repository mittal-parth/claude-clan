import { describe, expect, it } from 'vitest';
import { isLoginCommand } from '@/lib/app-utils';

describe('Login command interception', () => {
  it('recognizes various login command formats', () => {
    expect(isLoginCommand('/login')).toBe(true);
    expect(isLoginCommand('  /login  ')).toBe(true);
    expect(isLoginCommand('/LOGIN')).toBe(true);
    expect(isLoginCommand('claude login')).toBe(true);
    expect(isLoginCommand('claude auth login')).toBe(true);
    expect(isLoginCommand('/login claude')).toBe(true);

    expect(isLoginCommand('hi')).toBe(false);
    expect(isLoginCommand('/help')).toBe(false);
    expect(isLoginCommand('please login to my server')).toBe(false);
  });
});
