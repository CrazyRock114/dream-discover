import { Fragment, useEffect, type ReactNode } from 'react';
import { ColorSchemeName, Platform } from 'react-native';
import { Uniwind } from 'uniwind'

// system: 跟随系统变化
// light: 固定为 light 主题
// dark: 固定为 dark 主题
const DEFAULT_THEME: 'system' | 'light' | 'dark' = 'dark'

const WebOnlyColorSchemeUpdater = function ({ children }: { children?: ReactNode }) {
  useEffect(() => {
    Uniwind.setTheme(DEFAULT_THEME);
  }, []);

  // Theme is fixed to dark mode; no external theme switching needed

  return <Fragment>
    {children}
  </Fragment>
};

export {
  WebOnlyColorSchemeUpdater,
}
