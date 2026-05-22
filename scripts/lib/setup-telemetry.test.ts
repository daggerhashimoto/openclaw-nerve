// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveFreshInstallDisposition, resolveSetupInstallMethod } from './setup-telemetry.js';

describe('setup telemetry helpers', () => {
  describe('resolveSetupInstallMethod', () => {
    it('maps release installs to release', () => {
      expect(resolveSetupInstallMethod('release')).toBe('release');
    });

    it('defaults unknown inputs to source', () => {
      expect(resolveSetupInstallMethod(undefined)).toBe('source');
      expect(resolveSetupInstallMethod('source')).toBe('source');
      expect(resolveSetupInstallMethod('bogus')).toBe('source');
    });
  });

  describe('resolveFreshInstallDisposition', () => {
    it('never treats existing installs as fresh', () => {
      expect(resolveFreshInstallDisposition({
        hasExisting: true,
        envFreshInstall: true,
        cliFreshInstall: true,
        invokedFromInstaller: false,
        defaultsMode: false,
        hasTty: true,
      })).toBe(false);
    });

    it('treats explicit fresh-install signals as fresh', () => {
      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: true,
        cliFreshInstall: false,
        invokedFromInstaller: false,
        defaultsMode: false,
        hasTty: false,
      })).toBe(true);

      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: false,
        cliFreshInstall: true,
        invokedFromInstaller: false,
        defaultsMode: false,
        hasTty: false,
      })).toBe(true);
    });

    it('does not infer fresh installs from installer reruns or defaults mode alone', () => {
      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: false,
        cliFreshInstall: false,
        invokedFromInstaller: true,
        defaultsMode: false,
        hasTty: true,
      })).toBe(false);

      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: false,
        cliFreshInstall: false,
        invokedFromInstaller: false,
        defaultsMode: true,
        hasTty: false,
      })).toBe(false);
    });

    it('prompts only for ambiguous first-run interactive setup', () => {
      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: false,
        cliFreshInstall: false,
        invokedFromInstaller: false,
        defaultsMode: false,
        hasTty: true,
      })).toBe('prompt');
    });

    it('fails safe for ambiguous non-interactive runs', () => {
      expect(resolveFreshInstallDisposition({
        hasExisting: false,
        envFreshInstall: false,
        cliFreshInstall: false,
        invokedFromInstaller: false,
        defaultsMode: false,
        hasTty: false,
      })).toBe(false);
    });
  });
});
