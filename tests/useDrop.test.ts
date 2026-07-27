import type { Ship } from '@shipstatic/ship';
import { FileValidationStatus } from '@shipstatic/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type DropOptions, useDrop } from '../src/useDrop';
import {
  builtSite,
  fileAt,
  GENEROUS_LIMITS,
  PLATFORM_LIMITS,
  shipStub,
  zipOf,
} from './fixtures/builders';

/**
 * The `ship` instance is hoisted out of the render callback deliberately: an
 * inline `shipStub()` would be a NEW object every render, invalidating every
 * `useCallback` that depends on it. Consumers pass a stable client, so the tests
 * do too.
 */
const setup = (options: Partial<DropOptions> = {}) => {
  const ship = options.ship ?? shipStub();
  return renderHook(() => useDrop({ ...options, ship }));
};

/**
 * A Ship whose `getLimits()` blocks until released — the seam that makes the
 * transient `processing` phase observable. Without it, `act()` flushes the whole
 * async run and a render-tracking callback only ever sees idle → ready.
 */
function gatedShip(limits = GENEROUS_LIMITS) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ship = {
    getLimits: async () => {
      await gate;
      return limits;
    },
  } as unknown as Ship;
  return { ship, release };
}

describe('useDrop — initial state', () => {
  it('starts idle and interactive with nothing held', () => {
    const { result } = setup();

    expect(result.current.phase).toBe('idle');
    expect(result.current.isDragging).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isInteractive).toBe(true);
    expect(result.current.hasError).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(result.current.validFiles).toEqual([]);
    expect(result.current.sourceName).toBe('');
    expect(result.current.status).toBeNull();
    expect(result.current.needsBuild).toBe(false);
  });
});

describe('useDrop — processing a set', () => {
  it('lands in ready with files, source name and status', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isInteractive).toBe(true);
    expect(result.current.files).toHaveLength(2);
    expect(result.current.validFiles).toHaveLength(2);
    expect(result.current.sourceName).toBe('dist');
    expect(result.current.status?.title).toBe('Ready');
  });

  it('lands in error when validation fails', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.hasError).toBe(true);
    expect(result.current.isInteractive).toBe(false);
    expect(result.current.status?.title).toBe('Validation Failed');
  });

  it('is processing, and not interactive, while the run is in flight', async () => {
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles(builtSite());
    });

    expect(result.current.phase).toBe('processing');
    expect(result.current.isProcessing).toBe(true);
    expect(result.current.isInteractive).toBe(false);
    expect(result.current.status?.title).toBe('Processing...');

    await act(async () => {
      release();
      await run;
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.isProcessing).toBe(false);
  });

  it('clears any previous files the moment processing starts', async () => {
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles(builtSite('dist'));
    });

    expect(result.current.files).toEqual([]);
    expect(result.current.sourceName).toBe('');

    await act(async () => {
      release();
      await run;
    });
  });

  it('clears a previous set before processing a new one', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('first'));
    });
    await act(async () => {
      await result.current.processFiles([fileAt('second/index.html', '<html>', 'text/html')]);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.sourceName).toBe('second');
  });

  it('ignores an empty file list', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([]);
    });

    expect(result.current.phase).toBe('idle');
  });
});

describe('useDrop — re-entry guard', () => {
  it('ignores a second call while the first is in flight', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => {
      await Promise.all([
        result.current.processFiles(builtSite('first')),
        result.current.processFiles(builtSite('second')),
      ]);
    });

    expect(warn).toHaveBeenCalledWith(
      'File processing already in progress. Ignoring duplicate call.',
    );
    expect(result.current.sourceName).toBe('first');
  });

  it('releases the guard after a failure, so a retry works', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });
    expect(result.current.phase).toBe('error');

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    expect(result.current.phase).toBe('ready');
  });
});

describe('useDrop — limits come from the Ship instance', () => {
  it('validates against the limits the client reports', async () => {
    const { result } = setup({ ship: shipStub({ ...PLATFORM_LIMITS, maxFileSize: 10 }) });

    await act(async () => {
      await result.current.processFiles([
        fileAt('index.html', '<html>', 'text/html'),
        fileAt('big.txt', 'x'.repeat(50)),
      ]);
    });

    expect(result.current.phase).toBe('error');
  });

  it('fetches limits on every run, so a plan change is picked up', async () => {
    const getLimits = vi.fn().mockResolvedValue(GENEROUS_LIMITS);
    const { result } = setup({ ship: { getLimits } as never });

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    await act(async () => {
      await result.current.processFiles(builtSite());
    });

    expect(getLimits).toHaveBeenCalledTimes(2);
  });
});

describe('useDrop — needsBuild', () => {
  it('surfaces the signal for an unbuilt project', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        fileAt('app/package.json', '{}'),
        fileAt('app/index.html', '<html>', 'text/html'),
      ]);
    });

    expect(result.current.needsBuild).toBe(true);
    expect(result.current.phase).toBe('ready');
  });

  it('is false for a built site', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    expect(result.current.needsBuild).toBe(false);
  });
});

describe('useDrop — helpers', () => {
  it('validFiles holds only READY files', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        fileAt('index.html', '<html>', 'text/html'),
        fileAt('empty.txt', ''),
      ]);
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.validFiles.map((f) => f.path)).toEqual(['index.html']);
    expect(result.current.validFiles.every((f) => f.status === FileValidationStatus.READY)).toBe(
      true,
    );
  });

  it('getFilesForUpload returns the raw File objects of the valid set', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });

    const forUpload = result.current.getFilesForUpload();
    expect(forUpload).toHaveLength(2);
    expect(forUpload.every((f) => f instanceof File)).toBe(true);
    // The stripped deploy path rides on the File, which is what the SDK reads
    expect(forUpload.map((f) => f.webkitRelativePath).sort()).toEqual(['app.js', 'index.html']);
  });

  it('getFilesForUpload is empty before anything is processed', () => {
    expect(setup().result.current.getFilesForUpload()).toEqual([]);
  });
});

describe('useDrop — reset', () => {
  it('returns to the initial state', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });
    act(() => result.current.reset());

    expect(result.current.phase).toBe('idle');
    expect(result.current.files).toEqual([]);
    expect(result.current.sourceName).toBe('');
    expect(result.current.status).toBeNull();
    expect(result.current.needsBuild).toBe(false);
  });

  it('clears an error state', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });
    act(() => result.current.reset());

    expect(result.current.hasError).toBe(false);
    expect(result.current.isInteractive).toBe(true);
  });

  it('allows processing again afterwards', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    act(() => result.current.reset());
    await act(async () => {
      await result.current.processFiles(builtSite('again'));
    });

    await waitFor(() => expect(result.current.sourceName).toBe('again'));
  });
});

describe('useDrop — deploy paths', () => {
  it('strips the shared root folder from every path', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('my-site'));
    });

    expect(result.current.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });
});

describe('useDrop — ZIP input', () => {
  it('extracts a dropped archive and surfaces its contents', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        zipOf({ 'dist/index.html': '<html>hi</html>', 'dist/app.js': 'x' }, 'my-site.zip'),
      ]);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('my-site');
    expect(result.current.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('shows the pipeline’s extraction status while inflating', async () => {
    // The hook forwards `onStatus` into state; extraction is the only step that
    // reports, so this is what wires the two together.
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });
    const titles: string[] = [];

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles([zipOf({ 'index.html': '<html>' }, 'site.zip')]);
    });
    titles.push(result.current.status?.title ?? '');

    await act(async () => {
      release();
      await run;
    });

    expect(titles).toEqual(['Processing...']);
    expect(result.current.phase).toBe('ready');
  });
});
