import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fonts.js', () => ({
  getDefaultFontPairing: vi.fn(() => ({
    heading: 'system-ui, sans-serif',
    body: 'system-ui, sans-serif',
    mono: 'monospace',
  })),
}));

vi.mock('./isolines.js', () => ({
  clearIsolineCache: vi.fn(),
  generateIsolineConfigFromDid: vi.fn(() => ({})),
  getIsolineSVGStringForDid: vi.fn((did: string, _colors: Record<string, string>, w: number, h: number) =>
    `<svg data-did="${did}" width="${w}" height="${h}"></svg>`
  ),
}));

function setViewportSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.();
    });
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

describe('theme engine isoline state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    let blobCounter = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${++blobCounter}`) as any;
    URL.revokeObjectURL = vi.fn() as any;
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    setViewportSize(1200, 800);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  it('does not regenerate pattern on resize after isolines are disabled', async () => {
    const { applyTheme } = await import('./engine');
    const isolines = await import('./isolines.js');
    const getIsolineSVGStringForDid = vi.mocked(isolines.getIsolineSVGStringForDid);

    const themeConfig = {
      colors: { background: '#ffffff', text: '#111111', muted: '#666666' },
      isolines: true,
    };

    await applyTheme(themeConfig, { did: 'did:plc:alice', waitForFonts: false });
    getIsolineSVGStringForDid.mockClear();

    await applyTheme({ ...themeConfig, isolines: false }, { did: 'did:plc:alice', waitForFonts: false });

    setViewportSize(1700, 1000);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(450);

    expect(getIsolineSVGStringForDid).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--pattern-bg-1')).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--pattern-bg-2')).toBe('none');
    expect(document.documentElement.classList.contains('has-pattern')).toBe(false);
  });

  it('regenerates pattern when isolines are re-enabled after disable', async () => {
    const { applyTheme } = await import('./engine');
    const isolines = await import('./isolines.js');
    const getIsolineSVGStringForDid = vi.mocked(isolines.getIsolineSVGStringForDid);

    const themeConfig = {
      colors: { background: '#f2f2f2', text: '#222222', muted: '#777777' },
      isolines: true,
    };

    await applyTheme(themeConfig, { did: 'did:plc:bob', waitForFonts: false });
    const initialPatternCalls = getIsolineSVGStringForDid.mock.calls.length;

    await applyTheme({ ...themeConfig, isolines: false }, { did: 'did:plc:bob', waitForFonts: false });
    await applyTheme(themeConfig, { did: 'did:plc:bob', waitForFonts: false });

    expect(getIsolineSVGStringForDid.mock.calls.length).toBe(initialPatternCalls + 1);
    expect(document.documentElement.classList.contains('has-pattern')).toBe(true);
  });
});
