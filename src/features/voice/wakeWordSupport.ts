export interface WakeWordSupportEnv {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface WakeWordSupportResult {
  supported: boolean;
  reason: 'mobile-web' | null;
}

function getNavigatorEnv(): WakeWordSupportEnv {
  if (typeof navigator === 'undefined') {
    return {
      userAgent: '',
      platform: '',
      maxTouchPoints: 0,
    };
  }

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

export function getWakeWordSupport(env: WakeWordSupportEnv = getNavigatorEnv()): WakeWordSupportResult {
  const userAgent = (env.userAgent || '').toLowerCase();
  const platform = (env.platform || '').toLowerCase();
  const maxTouchPoints = typeof env.maxTouchPoints === 'number' ? env.maxTouchPoints : 0;

  const isAndroid = /android/.test(userAgent);
  const isiPhoneOrIPod = /iphone|ipod/.test(userAgent);
  const isiPad = /ipad/.test(userAgent);
  const isMacLikeTouchTablet = platform === 'macintel' && maxTouchPoints > 1;
  const isMobileOrTabletKeyword = /mobile|tablet/.test(userAgent);

  const isMobileWeb = isAndroid || isiPhoneOrIPod || isiPad || isMacLikeTouchTablet || isMobileOrTabletKeyword;

  return {
    supported: !isMobileWeb,
    reason: isMobileWeb ? 'mobile-web' : null,
  };
}

export function isWakeWordSupportedEnvironment(env?: WakeWordSupportEnv): boolean {
  return getWakeWordSupport(env).supported;
}
