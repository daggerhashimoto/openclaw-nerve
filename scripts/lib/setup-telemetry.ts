export function resolveSetupInstallMethod(value: string | undefined | null): 'release' | 'source' {
  return value === 'release' ? 'release' : 'source';
}

export function resolveFreshInstallDisposition(options: {
  hasExisting: boolean;
  envFreshInstall: boolean;
  cliFreshInstall: boolean;
  invokedFromInstaller: boolean;
  defaultsMode: boolean;
  hasTty: boolean;
}): boolean | 'prompt' {
  if (options.hasExisting) {
    return false;
  }

  if (options.envFreshInstall || options.cliFreshInstall) {
    return true;
  }

  if (options.invokedFromInstaller) {
    return false;
  }

  if (options.defaultsMode) {
    return false;
  }

  if (!options.hasTty) {
    return false;
  }

  return 'prompt';
}
