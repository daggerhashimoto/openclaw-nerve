import { describe, expect, it } from 'vitest';
import { getLanguageExtension, resolveLanguageExtensionKey } from './languageMap';

describe('resolveLanguageExtensionKey', () => {
  it('maps ts-node shebangs to TypeScript', () => {
    expect(resolveLanguageExtensionKey('tool', '#!/usr/bin/env ts-node\nconsole.log(1);')).toBe('.ts');
  });

  it('maps tsx shebangs to TSX', () => {
    expect(resolveLanguageExtensionKey('tool', '#!/usr/bin/env tsx\nconsole.log(1);')).toBe('.tsx');
  });

  it('maps ruby shebangs to Ruby', () => {
    expect(resolveLanguageExtensionKey('tool', '#!/usr/bin/env ruby\nputs 1')).toBe('.rb');
  });

  it('maps perl shebangs to Perl', () => {
    expect(resolveLanguageExtensionKey('tool', '#!/usr/bin/env perl\nprint 1')).toBe('.pl');
  });
});

describe('getLanguageExtension', () => {
  it('loads Ruby highlighting for .rb files', async () => {
    await expect(getLanguageExtension('script.rb')).resolves.toBeTruthy();
  });

  it('loads Perl highlighting for .pl files', async () => {
    await expect(getLanguageExtension('script.pl')).resolves.toBeTruthy();
  });
});
