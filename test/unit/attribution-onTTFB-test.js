import {describe, it, before, beforeEach} from 'node:test';
import assert from 'node:assert';

class PerformanceNavigationTiming {}
class PerformanceSoftNavigation {
  getLargestInteractionContentfulPaint() {}
}

const observers = [];
const listeners = [];

const stubGlobals = ({referrer = ''} = {}) => {
  observers.length = 0;
  listeners.length = 0;
  globalThis.PerformanceNavigationTiming = PerformanceNavigationTiming;
  globalThis.PerformanceSoftNavigation = PerformanceSoftNavigation;
  globalThis.PerformanceObserver = class {
    static supportedEntryTypes = ['navigation', 'soft-navigation'];
    constructor(cb) {
      this.cb = cb;
      this.types = [];
      observers.push(this);
    }
    observe(o) {
      this.types.push(o.type);
    }
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  const navEntry = Object.assign(
    Object.create(PerformanceNavigationTiming.prototype),
    {
      entryType: 'navigation',
      name: 'https://example.com/page',
      type: 'navigate',
      navigationId: 1,
      activationStart: 0,
      fetchStart: 10,
      domainLookupStart: 20,
      connectStart: 30,
      connectEnd: 40,
      responseStart: 100,
    },
  );
  globalThis.performance = {
    now: () => 1000,
    getEntriesByType: (t) => (t === 'navigation' ? [navEntry] : []),
  };
  globalThis.location = {origin: 'https://example.com'};
  globalThis.document = {
    referrer,
    readyState: 'complete',
    prerendering: false,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.addEventListener = (type, cb) => listeners.push({type, cb});
  globalThis.removeEventListener = () => {};
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('TTFB attribution sameOriginNavigation', () => {
  let onTTFB;

  before(async () => {
    stubGlobals();
    ({onTTFB} = await import('../../dist/modules/attribution/onTTFB.js'));
  });

  beforeEach(() => stubGlobals());

  it('is true when the referrer has the same origin', async () => {
    stubGlobals({referrer: 'https://example.com/other'});
    const reports = [];
    onTTFB((metric) => reports.push(metric));
    await flush();

    assert.strictEqual(reports.length, 1);
    assert.strictEqual(reports[0].attribution.sameOriginNavigation, true);
  });

  it('is false when the referrer has a different origin', async () => {
    stubGlobals({referrer: 'https://other.example/'});
    const reports = [];
    onTTFB((metric) => reports.push(metric));
    await flush();

    assert.strictEqual(reports.length, 1);
    assert.strictEqual(reports[0].attribution.sameOriginNavigation, false);
  });

  it('is undefined when there is no referrer', async () => {
    const reports = [];
    onTTFB((metric) => reports.push(metric));
    await flush();

    assert.strictEqual(reports.length, 1);
    assert.strictEqual(reports[0].attribution.sameOriginNavigation, undefined);
  });

  it('is undefined for soft navigations', async () => {
    stubGlobals({referrer: 'https://example.com/other'});
    const reports = [];
    onTTFB((metric) => reports.push(metric), {reportSoftNavs: true});
    await flush();

    const softNavEntry = Object.assign(
      Object.create(PerformanceSoftNavigation.prototype),
      {
        entryType: 'soft-navigation',
        name: 'https://example.com/next',
        navigationId: 2,
        interactionId: 5,
        startTime: 500,
      },
    );
    observers
      .find((o) => o.types.includes('soft-navigation'))
      .cb({getEntries: () => [softNavEntry]});
    await flush();

    assert.strictEqual(reports.length, 2);
    assert.strictEqual(reports[0].attribution.sameOriginNavigation, true);
    assert.strictEqual(reports[1].navigationType, 'soft-navigation');
    assert.strictEqual(reports[1].attribution.sameOriginNavigation, undefined);
  });

  // Keep last: a bfcache restore sets module state that later tests would see.
  it('is undefined after a bfcache restore', async () => {
    stubGlobals({referrer: 'https://example.com/other'});
    const reports = [];
    onTTFB((metric) => reports.push(metric));
    await flush();

    listeners
      .filter((l) => l.type === 'pageshow')
      .forEach((l) => l.cb({persisted: true, timeStamp: 2000}));
    await flush();

    assert.strictEqual(reports.length, 2);
    assert.strictEqual(reports[0].attribution.sameOriginNavigation, true);
    assert.strictEqual(reports[1].navigationType, 'back-forward-cache');
    assert.strictEqual(reports[1].attribution.sameOriginNavigation, undefined);
  });
});
