import React from 'react';
import { APP_VERSION } from '@noclue/shared';

const built = typeof __BUILD_TIME__ === 'string' ? new Date(__BUILD_TIME__) : undefined;
const pad = (n: number) => String(n).padStart(2, '0');
export const buildLabel = built
  ? `${built.getDate()}.${built.getMonth() + 1}. ${pad(built.getHours())}:${pad(built.getMinutes())}`
  : 'dev';

/** Fixed bottom-right version label. */
export function VersionBadge() {
  return (
    <div
      className="app-version"
      data-testid="app-version"
      title={`noclue v${APP_VERSION}, built ${built?.toLocaleString() ?? 'in development'}`}
    >
      v{APP_VERSION}
      <span className="app-version-build"> · {buildLabel}</span>
    </div>
  );
}
