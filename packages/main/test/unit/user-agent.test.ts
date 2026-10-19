import { describe, expect, it } from 'vitest';

import { anonymizeUserAgent } from '../../src/shared/user-agent.js';

describe('the browser user agent', () => {
  it('drops the Electron token and keeps Chrome', () => {
    expect(
      anonymizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/152.0.7977.167 Electron/44.9.0 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/152.0.7977.167 Safari/537.36',
    );
  });

  it('drops the application token some builds add', () => {
    expect(
      anonymizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'akagi-ng-desktop/1.0.0 Chrome/152.0.7977.167 Electron/44.9.0 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/152.0.7977.167 Safari/537.36',
    );
  });

  it('drops the product token a packaged build adds', () => {
    expect(
      anonymizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Akagi-NG/1.1.0 Chrome/152.0.7977.167 Electron/44.9.0 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/152.0.7977.167 Safari/537.36',
    );
  });

  it('drops the scoped package token development builds add', () => {
    expect(
      anonymizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          '@akagi-ng/main/1.1.0 Chrome/152.0.7977.167 Electron/44.9.0 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/152.0.7977.167 Safari/537.36',
    );
  });

  it('leaves a clean Chrome agent untouched', () => {
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

    expect(anonymizeUserAgent(chrome)).toBe(chrome);
  });
});
